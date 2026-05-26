-- ============================================================================
-- Block pure clients from create_workspace_with_owner RPC (paywall bypass)
-- ============================================================================
-- Defense-in-depth pair to the page-level gate added in
-- src/app/onboarding/create-workspace/page.tsx (2026-05-26, C1 in the
-- agency↔client boundary cleanup).
--
-- Before this migration: a pure client (someone with one or more
-- pipeline_memberships of role='client' but ZERO agency contexts —
-- i.e., no workspace_memberships, no agency-role pipeline_memberships)
-- could call create_workspace_with_owner via the page form OR direct
-- PostgREST and become a workspace owner. That's a paywall bypass:
-- they'd get free agency functionality (pipelines, channels, team
-- invites, etc.) when they were only ever supposed to consume their
-- agency's portal as a client.
--
-- ── THE THREE-CASE RULE (locked) ────────────────────────────────────
--
--   BLOCK iff `hasClient AND NOT hasAgency`  ← pure client
--   ALLOW  if  zero contexts                  ← brand-new signup (CRITICAL)
--   ALLOW  if  any agency context             ← adding more workspaces
--
-- The zero-contexts allow is the legitimate first-time-agency
-- onboarding path. WorkspaceSelector auto-routes brand-new signups
-- here via resolveDestination's `create_workspace` branch — breaking
-- this case means we can't onboard ANY paying agency. The check
-- below is explicitly written so a user with both
-- `has_workspace_membership = false` AND `has_agency_pipeline = false`
-- AND `has_client_pipeline = false` falls through to the existing
-- logic unchanged.
--
-- ── WHAT THIS MIGRATION CHANGES ────────────────────────────────────
--
-- CREATE OR REPLACE on public.create_workspace_with_owner. Function
-- body is byte-for-byte identical to the version in
-- supabase/migrations/20260512120000_block_duplicate_workspace_names.sql
-- EXCEPT for one new check block inserted right after the `actor is
-- null` raise — a pure additive addition, no edits to any existing
-- line. Signature, return shape, security context, search_path,
-- grants, every existing validation/raise/insert are unchanged.
--
-- Added:
--   declare:
--     has_agency boolean;
--     has_client boolean;
--   block (after the auth check, before name validation):
--     has_agency := exists (
--       select 1 from public.workspace_memberships where user_id = actor
--     ) or exists (
--       select 1 from public.pipeline_memberships
--       where user_id = actor and role in ('owner','admin','member')
--     );
--     has_client := exists (
--       select 1 from public.pipeline_memberships
--       where user_id = actor and role = 'client'
--     );
--     if has_client and not has_agency then
--       raise exception 'Clients cannot create workspaces; agency upgrade flow not yet available'
--         using errcode = '42501';
--     end if;
--
-- Order matters: this check runs BEFORE name validation. A blocked
-- pure client gets the clear "Clients cannot create workspaces" error
-- regardless of whether their name was valid — they never reach the
-- name-trim / length / duplicate-name checks.
--
-- ── DEFENSE IN DEPTH (mirrors the existing project pattern) ─────────
--
-- The page-level gate (page.tsx) and this RPC check enforce the same
-- three-case rule. Mirrors `enforce_client_pipeline_link_insert_scope`
-- + the pipeline_links_insert policy WITH CHECK (migration
-- 20260601120000) — each layer enforces independently. If a future
-- maintainer accidentally drops the page gate (e.g., reverting the
-- server-component refactor), this RPC check continues to block
-- pure-client callers with a named SQL error.
--
-- DO NOT remove this check thinking the page gate is sufficient.
-- DO NOT remove the page gate thinking this check is sufficient.
-- The pair protects against different threat models.
--
-- ── ZERO-CONTEXT BRAND-NEW SIGNUP — explicit allow trace ────────────
--
-- New user signs up → has zero workspace_memberships, zero
-- pipeline_memberships. The boolean assignments evaluate:
--   has_agency = false OR false = false
--   has_client = false
-- The `if has_client and not has_agency then` clause is `false and
-- true = false` → no raise → falls through to existing name
-- validation and insert. Identical behavior to pre-migration for the
-- zero-context case.
--
-- ── ROLE OVERLAP EDGE CASE (existing pattern) ──────────────────────
--
-- A user with BOTH agency AND client memberships (rare — e.g., an
-- agency owner who added themselves as a client of their own
-- pipeline for testing) evaluates to:
--   has_agency = true (they have workspace_memberships)
--   has_client = true
-- Clause: `true and not true = false` → no raise → allowed. Matches
-- the design: agency status takes precedence when overlap exists,
-- consistent with the enforce_client_pipeline_link_insert_scope
-- pattern.
--
-- ┌─ DOWN PLAN
-- │   Re-apply the original create_workspace_with_owner from migration
-- │   20260512120000_block_duplicate_workspace_names.sql via
-- │   CREATE OR REPLACE. The added DECLARE lines and check block
-- │   simply disappear; no schema state to revert; no data to clean
-- │   up (any workspaces a pure client somehow created under the new
-- │   rule shouldn't exist — but if they do, they're indistinguishable
-- │   from legitimate agency workspaces post-revert, queryable by
-- │   joining workspace_memberships to pipeline_memberships).
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


create or replace function public.create_workspace_with_owner(workspace_name text)
returns json language plpgsql security definer
set search_path = ''
as $$
declare
  new_workspace_id   uuid;
  new_workspace_slug text;
  cleaned_name       text;
  actor              uuid := (select auth.uid());
  has_agency         boolean;  -- NEW: presence-of-agency-context flag
  has_client         boolean;  -- NEW: presence-of-client-context flag
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- NEW: C1 paywall bypass guard (2026-05-26). Block pure clients —
  -- callers with at least one client pipeline_membership AND zero
  -- agency contexts. Zero-context callers (brand-new signups) and
  -- agency callers pass through unchanged. See migration header for
  -- the three-case rule and rationale.
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

  cleaned_name := trim(coalesce(workspace_name, ''));
  if cleaned_name = '' then
    raise exception 'Workspace name cannot be empty'
      using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Workspace name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  -- Per-user duplicate check. Comparison is case-insensitive (both sides
  -- lower()-ed) and trim-applied (both sides trimmed) so "Acme" / "acme" /
  -- "  Acme  " all collide. Scoped to workspaces the user owns
  -- (role='owner'); workspaces they're a member-of-without-owning don't
  -- count, since those were named by their actual owner.
  --
  -- SQLSTATE 23505 is unique_violation. Not a true DB-level unique
  -- constraint violation (we don't have one — schema-level uniqueness
  -- across users would be wrong), but the semantic fit is right and
  -- gives clients a recognisable code.
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

  -- Insert workspace. Slug is auto-generated by workspaces_auto_slug
  -- trigger (20260509150000) — still useful for the cross-user case
  -- where two different owners independently pick the same name.
  insert into public.workspaces (name)
  values (cleaned_name)
  returning id, slug into new_workspace_id, new_workspace_slug;

  -- Same transaction as the workspace insert — if this fails the workspace
  -- insert rolls back too.
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
-- (a) Confirm the function definition includes the new guard.
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'create_workspace_with_owner';
--   -- Expected: body contains "has_client and not has_agency"
--   -- AND "Clients cannot create workspaces"
--   -- AND still contains the original duplicate-name and length checks.
--
-- (b) Confirm grants survived the CREATE OR REPLACE (function-body
--     change preserves existing grants).
--   select proname,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth_can_call
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'create_workspace_with_owner';
--   -- Expected: 1 row, auth_can_call = true.
-- ============================================================================
