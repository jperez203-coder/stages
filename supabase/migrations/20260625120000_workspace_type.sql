-- ============================================================================
-- Stages — workspace_type (WT-1 + WT-2)
-- ============================================================================
-- Adds the workspaces.type column + extends the create_workspace_with_owner
-- RPC to accept and write it.
--
-- Two values:
--   * 'agency'   — full Stages feature set: team members, client portals,
--                  pipelines with client-visible content, Solo OR Team plan.
--                  Default for every existing workspace.
--   * 'personal' — solo-only workspace: no team-member invites, no client
--                  invites, no client portal surface, Solo plan only.
--                  Created from the workspace-type selector on
--                  /onboarding/create-workspace (WT-3 ships the selector).
--
-- Existing rows: all become 'agency' automatically via the NOT NULL DEFAULT
-- 'agency'. No backfill needed; no observable behavior change to current
-- flows until WT-3 (UI selector), WT-4 (API gates), WT-5 (UI gates), and
-- WT-6 (RLS hardening) ship. The 'personal' type is creatable as soon as
-- this migration applies and a caller supplies the new parameter to the
-- RPC, but no UI currently exposes that path.
--
-- ── WHY ONE MIGRATION, NOT TWO ──────────────────────────────────────────
-- The column add and the RPC update are one logical unit: the RPC must be
-- able to write the column the moment the column exists, so the form
-- (which doesn't yet pass the new parameter) keeps producing correctly-
-- typed rows from the first request after apply. Splitting into two
-- migrations would leave a window where the column exists but the RPC
-- body still ignores it — every workspace created in that window would
-- still land at type='agency' (which is correct), but a tooling-level
-- assumption ("each migration is atomic and independently consistent")
-- would be subtly violated. Bundling keeps the invariants tight.
--
-- ┌─ DOWN PLAN (manual rollback recipe)
-- │
-- │   -- 1. Restore the prior RPC body (no workspace_type parameter).
-- │   --    Copy create_workspace_with_owner verbatim from
-- │   --    supabase/migrations/20260605120000_block_pure_clients_from_create_workspace.sql
-- │   --    and CREATE OR REPLACE.
-- │
-- │   -- 2. Drop the column.
-- │   alter table public.workspaces drop column type;
-- │
-- │   -- Order matters: restore the RPC first, then drop the column. If
-- │   -- the column is dropped while the new RPC body still references
-- │   -- public.workspaces.type, the RPC errors at next invocation.
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Add the column ────────────────────────────────────────────────────
-- text + CHECK pattern (matches workspace_billing.subscription_status,
-- workspace_billing.plan, pipeline_memberships.role, channel_memberships.role,
-- and every other enum-like column in the schema). PG enums create migration
-- friction and the codebase has deliberately avoided them.
--
-- NOT NULL DEFAULT 'agency' backfills every existing row in a single
-- statement — no separate UPDATE pass needed. Default = 'agency' means
-- the current behavior (full feature set) is preserved for everything
-- that exists today, AND for any future caller that doesn't supply the
-- new RPC parameter (e.g., direct PostgREST callers, dev SQL).
alter table public.workspaces
  add column type text not null default 'agency'
  constraint workspaces_type_check check (type in ('agency', 'personal'));

comment on column public.workspaces.type is
  'Workspace category. agency = full Stages feature set with team members + client portals + Solo OR Team plan; personal = solo-only, no member invites, no client invites, no client portal, Solo plan only. Set at workspace creation via the create_workspace_with_owner RPC. Existing pre-migration rows backfilled to agency by the NOT NULL DEFAULT. Feature gates that branch on this value land in WT-4 (API) and WT-5 (UI); RLS hardening lands in WT-6.';


-- ─── 2. Update create_workspace_with_owner RPC ────────────────────────────
-- New parameter `workspace_type text default 'agency'`. Validates the
-- value against the same allowlist the column CHECK enforces, then writes
-- it into the workspace insert.
--
-- All other behavior — auth check, C1 pure-client block, name validation,
-- duplicate-name check, atomic membership insert, security-definer +
-- search_path setup, return shape — is byte-for-byte unchanged from the
-- 20260605120000 version. Only the additions are:
--   (a) the new parameter on the signature,
--   (b) `cleaned_type` declared in the DECLARE block,
--   (c) one new validation block (placed AFTER name validation, BEFORE
--       duplicate-name check — ordering is documented inline),
--   (d) `type` added to the workspaces INSERT column list + values list.
--
-- Existing callers (the form at CreateWorkspaceForm.tsx that supplies
-- only `workspace_name`) keep working bit-for-bit because the new
-- parameter defaults to 'agency'. WT-3 updates the form to pass the
-- selector value explicitly.
--
-- Parameter name `workspace_type` was chosen to match the existing
-- `workspace_name` parameter's naming pattern (object_attribute) and to
-- read clearly at call sites (`workspace_type => 'personal'` is
-- self-documenting at the supabase.rpc(...) call).
create or replace function public.create_workspace_with_owner(
  workspace_name text,
  workspace_type text default 'agency'
)
returns json language plpgsql security definer
set search_path = ''
as $$
declare
  new_workspace_id   uuid;
  new_workspace_slug text;
  cleaned_name       text;
  cleaned_type       text;   -- NEW (WT-2): validated workspace_type value
  actor              uuid := (select auth.uid());
  has_agency         boolean;
  has_client         boolean;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- C1 paywall bypass guard (carried verbatim from 20260605120000). Block
  -- pure clients — callers with at least one client pipeline_membership
  -- AND zero agency contexts. Zero-context callers (brand-new signups)
  -- and agency callers pass through unchanged. See 20260605120000 header
  -- for the full three-case rule and rationale.
  has_agency := exists (
    select 1 from public.workspace_memberships where user_id = actor
  ) or exists (
    select 1 from public.pipeline_memberships
    where user_id = actor and role in ('owner', 'admin', 'member')
  );
  has_client := exists (
    select 1 from public.pipeline_memberships
    where user_id = actor and role = 'client'
  );
  if has_client and not has_agency then
    raise exception 'Clients cannot create workspaces; agency upgrade flow not yet available'
      using errcode = '42501';
  end if;

  -- Workspace name validation (unchanged).
  cleaned_name := trim(coalesce(workspace_name, ''));
  if cleaned_name = '' then
    raise exception 'Workspace name cannot be empty'
      using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Workspace name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  -- NEW (WT-2): workspace_type validation. Same allowlist as the column
  -- CHECK constraint above. Defensive — protects against direct-RPC
  -- callers passing arbitrary values; the column CHECK would reject the
  -- INSERT regardless, but raising here gives a clean SQLSTATE 22023 +
  -- explanatory message rather than a constraint-violation surface.
  -- Placed after name validation so a caller fixing both a bad name AND
  -- a bad type sees the name error first (consistent with the pre-
  -- migration flow's error ordering — name was the first user-facing
  -- field validated, and it still is).
  cleaned_type := lower(trim(coalesce(workspace_type, '')));
  if cleaned_type not in ('agency', 'personal') then
    raise exception 'Workspace type must be agency or personal (got: %)', workspace_type
      using errcode = '22023';
  end if;

  -- Per-user duplicate-name check (unchanged from 20260605120000).
  if exists (
    select 1
    from public.workspace_memberships wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = actor
      and wm.role = 'owner'
      and lower(trim(w.name)) = lower(cleaned_name)
  ) then
    raise exception 'You already have a workspace named "%". Pick a different name.', cleaned_name
      using errcode = '23505';
  end if;

  -- Insert workspace WITH the new type column. Slug is auto-generated by
  -- the workspaces_auto_slug trigger (20260509150000).
  insert into public.workspaces (name, type)
  values (cleaned_name, cleaned_type)
  returning id, slug into new_workspace_id, new_workspace_slug;

  -- Owner membership — same transaction as the workspace insert (so if
  -- this fails the workspace insert rolls back too).
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new_workspace_id, actor, 'owner');

  return json_build_object(
    'id',   new_workspace_id,
    'slug', new_workspace_slug,
    'name', cleaned_name
  );
end;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- (a) Confirm the column exists with the right type + default + constraint.
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'workspaces'
--     and column_name = 'type';
--   -- Expected: data_type='text', is_nullable='NO', column_default contains 'agency'.
--
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'workspaces_type_check';
--   -- Expected: CHECK (type IN ('agency', 'personal'))
--
-- (b) Confirm all existing rows backfilled to 'agency'.
--   select type, count(*) from public.workspaces group by type order by type;
--   -- Expected: one row, type='agency', count = total existing workspaces.
--   --           Zero rows with type='personal' until WT-3 ships.
--
-- (c) Confirm the RPC accepts the new parameter (function signature).
--   select pg_get_function_arguments(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'create_workspace_with_owner';
--   -- Expected: workspace_name text, workspace_type text DEFAULT 'agency'::text
--
-- (d) Confirm grants survived the CREATE OR REPLACE (function-body changes
--     preserve existing grants, but defensive to verify).
--   select has_function_privilege('authenticated', oid, 'EXECUTE') as auth_can_call
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'create_workspace_with_owner';
--   -- Expected: auth_can_call = true.
--
-- (e) Smoke test — invalid type raises a clean error (don't actually run
--     this against prod data; spin a throwaway workspace name for the test).
--   select public.create_workspace_with_owner('TestType', 'enterprise');
--   -- Expected: ERROR 22023 'Workspace type must be agency or personal (got: enterprise)'
--
-- (f) Smoke test — default (no second arg) lands as 'agency'.
--     Run AS A LOGGED-IN USER (not service role) so auth.uid() resolves.
--   select public.create_workspace_with_owner('TestDefault');
--   -- Then:
--   select type from public.workspaces
--   where id = (
--     -- substitute the id from the previous return value's `id` field
--     '<id-returned-above>'::uuid
--   );
--   -- Expected: 'agency'
--   -- CLEANUP: delete public.workspaces where id = '<id-returned-above>';
-- ============================================================================
