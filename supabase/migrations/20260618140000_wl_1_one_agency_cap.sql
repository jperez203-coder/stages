-- ============================================================================
-- Stages — WL-1: one-agency-per-user cap (server-side floor)
-- ============================================================================
-- First slice of the workspace-limits (WL) sprint. Enforces a hard cap of
-- ONE agency workspace_membership per user, server-side, in both code
-- paths that grant agency-workspace access:
--
--   1. create_workspace_with_owner — blocks creation of a 2nd agency by
--      the calling user. Predicate: count of caller's existing
--      workspace_memberships rows joined on workspaces.type = 'agency'.
--      If ≥ 1, raise 23505 with explanatory message. Placed inside the
--      cleaned_type = 'agency' branch, parallel to the existing
--      1-personal cap (20260626120000:204-215).
--
--   2. accept_workspace_invite — blocks accepting an invite to a 2nd
--      agency workspace. Predicate: invite's target workspace is
--      type='agency' AND caller already has a workspace_memberships row
--      on any OTHER agency workspace. Placed at the end of the
--      validation chain, after already-a-member + workspace-existence,
--      before the membership INSERT.
--
-- PREDICATE SHAPE
-- ───────────────
-- Counts ANY role (owner, admin, member) in workspace_memberships
-- joined on workspaces.type = 'agency'. The product rule is "you can
-- be part of at most one agency at a time" — not just "you can own at
-- most one agency." Joining a teammate's agency consumes the slot too.
--
-- HARD FLOOR AT 1
-- ───────────────
-- Cap is `>= 1`. If a user ever drops below 1 (workspace deletion
-- removes their membership), they cannot re-add to get back to 1.
-- Locked product decision per WL-sprint audit (option "hard floor"
-- over "cap at 1 with re-add allowed").
--
-- GRANDFATHERING — FUTURE-ONLY ENFORCEMENT
-- ────────────────────────────────────────
-- No allowlist, no timestamp cutoff, no backfill. The check fires only
-- on new INSERTs in create_workspace_with_owner and accept_workspace_-
-- invite. Pre-WL-1 workspace_memberships rows are structurally
-- untouched. Jordan's two existing agency memberships (test-workspace-4b
-- + salesedge, user f3d54a29-ad84-4de5-a727-5af825be3206) survive in
-- place; he simply can't add a 3rd. Anyone else with 2+ pre-existing
-- agency memberships (none known) is grandfathered the same way.
--
-- NO APP-CODE CHANGES THIS SLICE
-- ──────────────────────────────
-- The RPCs are the security floor. UI gates (hiding the agency option
-- in the workspace-type selector once capped, pre-flight check on the
-- accept-invite page) land in WL-3. Until then the user sees the raw
-- error message from the RPC raise; that's intentional for the first
-- ship — confirms the floor is doing real work without UI hiding the
-- evidence.
--
-- IDEMPOTENCY
-- ───────────
-- CREATE OR REPLACE FUNCTION on both RPCs. Same signatures, same return
-- shapes, same SECURITY DEFINER + search_path. Re-applying this
-- migration yields the same end state. No DROP — both RPCs are called
-- from prod code paths and a DROP-then-CREATE would briefly break them.
--
-- ┌─ DOWN PLAN
-- │
-- │   Re-apply the pre-WL-1 RPC bodies by CREATE OR REPLACE-ing both
-- │   functions with their definitions from
-- │   supabase/migrations/20260626120000_workspace_type_gates.sql
-- │   (sections 2 and 4). No data needs to revert; the cap is purely
-- │   a function-body predicate, not a column or constraint.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. create_workspace_with_owner — add 1-agency cap branch ─────────────
-- All other behavior carried verbatim from 20260626120000:138-244. The
-- only additions are:
--   (a) `agency_count` declared in the DECLARE block,
--   (b) one new validation block placed inside the cleaned_type =
--       'agency' branch, structurally parallel to the existing
--       cleaned_type = 'personal' cap. Ordering: the type-validation
--       block fires first; the type-specific caps (personal, agency)
--       fire next as type-conditional branches; the per-user
--       duplicate-name check is unchanged and runs after both.
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
  cleaned_type       text;
  actor              uuid := (select auth.uid());
  has_agency         boolean;
  has_client         boolean;
  personal_count     int;
  agency_count       int;  -- WL-1: per-user agency-workspace count
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- C1 paywall bypass guard (carried verbatim from 20260605120000).
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

  -- Workspace type validation (carried from 20260625120000).
  cleaned_type := lower(trim(coalesce(workspace_type, '')));
  if cleaned_type not in ('agency', 'personal') then
    raise exception 'Workspace type must be agency or personal (got: %)', workspace_type
      using errcode = '22023';
  end if;

  -- WT-4: per-user personal-workspace limit. Flat 1-per-user cap.
  -- 23505 (unique_violation) is the right SQLSTATE: this IS a
  -- uniqueness constraint, just enforced functionally because Postgres
  -- has no native "one row per group per user" expressible as CHECK or
  -- UNIQUE.
  if cleaned_type = 'personal' then
    select count(*) into personal_count
    from public.workspace_memberships wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = actor
      and wm.role = 'owner'
      and w.type = 'personal';
    if personal_count >= 1 then
      raise exception 'You can only have one personal workspace. Delete your existing personal workspace to create a new one.'
        using errcode = '23505';
    end if;
  end if;

  -- WL-1: per-user agency-workspace limit. Mirrors the WT-4 personal
  -- cap above. Difference: scope is ANY role (owner/admin/member), not
  -- just role='owner' — being a teammate in someone else's agency
  -- consumes the slot too, per the locked product rule "you can be
  -- part of at most one agency at a time."
  if cleaned_type = 'agency' then
    select count(*) into agency_count
    from public.workspace_memberships wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = actor
      and w.type = 'agency';
    if agency_count >= 1 then
      raise exception 'You already have an agency workspace. Each user is limited to one.'
        using errcode = '23505';
    end if;
  end if;

  -- Per-user duplicate-name check (carried verbatim).
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

  -- Insert workspace WITH the chosen type column.
  insert into public.workspaces (name, type)
  values (cleaned_name, cleaned_type)
  returning id, slug into new_workspace_id, new_workspace_slug;

  -- Owner membership in the same transaction.
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new_workspace_id, actor, 'owner');

  return json_build_object(
    'id',   new_workspace_id,
    'slug', new_workspace_slug,
    'name', cleaned_name
  );
end;
$$;


-- ─── 2. accept_workspace_invite — add 1-agency cap gate ───────────────────
-- All other behavior carried verbatim from 20260626120000:273-366. The
-- only additions are:
--   (a) `agency_count` declared in the DECLARE block,
--   (b) one new validation block placed at the end of the existing
--       chain — AFTER already-a-member and workspace-existence checks,
--       BEFORE the atomic membership insert. Rationale: the
--       already-a-member check should catch any case where the actor is
--       already in this specific workspace (returning the cleaner
--       "you are already a member" error), so the cap check fires only
--       when the actor is moving cross-workspace into a NEW agency.
--       The defensive `workspace_id != inv.workspace_id` clause is
--       belt-and-suspenders in case ordering changes.
create or replace function public.accept_workspace_invite(invite_token uuid)
returns json language plpgsql security definer
set search_path = ''
as $$
declare
  inv          public.workspace_invites%rowtype;
  ws_name      text;
  ws_slug      text;
  ws_type      text;
  actor        uuid := (select auth.uid());
  actor_email  text;
  agency_count int;  -- WL-1: per-user agency-workspace count
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select email into actor_email from auth.users where id = actor;
  if actor_email is null then
    raise exception 'Authenticated user not found' using errcode = '42501';
  end if;

  -- Fetch invite. Security definer bypasses workspace_invites RLS — the
  -- invitee isn't yet a member of the workspace and so couldn't read this
  -- row directly. The token in the URL is what authorises the read.
  select * into inv from public.workspace_invites where token = invite_token;
  if not found then
    raise exception 'Invite not found or has been revoked'
      using errcode = '22023';
  end if;

  -- WT-4: personal-workspace gate. Resolve target workspace's type and
  -- reject before the validation chain. Personal workspaces don't accept
  -- member invites.
  select type into ws_type from public.workspaces where id = inv.workspace_id;
  if ws_type = 'personal' then
    raise exception 'Personal workspaces do not accept member invites.'
      using errcode = '42501';
  end if;

  -- Single-use enforcement.
  if inv.accepted_at is not null then
    raise exception 'This invite has already been accepted'
      using errcode = '23505';
  end if;

  -- Expiry check.
  if inv.expires_at <= now() then
    raise exception 'This invite has expired'
      using errcode = '22023';
  end if;

  -- Email match (case-insensitive). The security gate against a forwarded
  -- link being accepted by someone other than the intended recipient.
  if lower(inv.email) != lower(actor_email) then
    raise exception 'This invite was sent to a different email address'
      using errcode = '42501';
  end if;

  -- Already-a-member check.
  if exists (
    select 1 from public.workspace_memberships
    where workspace_id = inv.workspace_id and user_id = actor
  ) then
    raise exception 'You are already a member of this workspace'
      using errcode = '23505';
  end if;

  -- Defensive: workspace still exists. (Cascade-delete on workspace
  -- removes the invite, so reaching this state should be impossible —
  -- but the check is cheap and the alternative is an FK violation later.)
  select name, slug into ws_name, ws_slug
  from public.workspaces where id = inv.workspace_id;
  if ws_name is null then
    raise exception 'Workspace no longer exists' using errcode = '22023';
  end if;

  -- WL-1: per-user agency-workspace cap. Only relevant if the invite's
  -- target is an agency workspace (personal workspaces were already
  -- rejected by the WT-4 gate above). Counts any existing
  -- workspace_memberships row joined on workspaces.type = 'agency'
  -- excluding the target workspace itself — the !=-target clause is
  -- defensive, since the already-a-member check above should fire first
  -- in that case.
  if ws_type = 'agency' then
    select count(*) into agency_count
    from public.workspace_memberships wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = actor
      and w.type = 'agency'
      and wm.workspace_id != inv.workspace_id;
    if agency_count >= 1 then
      raise exception 'You already belong to an agency workspace. You can only be part of one at a time.'
        using errcode = '23505';
    end if;
  end if;

  -- Atomic: insert membership + mark invite accepted in one transaction.
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (inv.workspace_id, actor, inv.role);

  update public.workspace_invites
  set accepted_at = now(), accepted_by = actor
  where token = invite_token;

  return json_build_object(
    'workspace_id',   inv.workspace_id,
    'workspace_slug', ws_slug,
    'workspace_name', ws_name,
    'role',           inv.role
  );
end;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) Confirm the WL-1 cap is present in both RPC bodies. The text match
--     looks for the distinctive error-message strings introduced above;
--     a missing match means the new branch never landed (e.g., a
--     re-applied older migration silently reverted it).
--   select
--     proname,
--     position('You already have an agency workspace. Each user is limited to one.'
--              in pg_get_functiondef(oid)) > 0       as create_has_cap,
--     position('You already belong to an agency workspace. You can only be part of one at a time.'
--              in pg_get_functiondef(oid)) > 0       as accept_has_cap
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('create_workspace_with_owner', 'accept_workspace_invite')
--   order by proname;
--   -- Expected: two rows.
--   --   accept_workspace_invite     | NULL  | true
--   --   create_workspace_with_owner | true  | NULL
--
-- (b) Jordan's current agency-workspace membership count. Should be 2
--     (test-workspace-4b + salesedge), grandfathered structurally.
--   select count(*)
--   from public.workspace_memberships wm
--   join public.workspaces w on w.id = wm.workspace_id
--   where wm.user_id = 'f3d54a29-ad84-4de5-a727-5af825be3206'
--     and w.type = 'agency';
--   -- Expected: 2
--
-- (c) Jordan's current personal-workspace membership count. Should be 0.
--   select count(*)
--   from public.workspace_memberships wm
--   join public.workspaces w on w.id = wm.workspace_id
--   where wm.user_id = 'f3d54a29-ad84-4de5-a727-5af825be3206'
--     and w.type = 'personal';
--   -- Expected: 0
--
-- (d) Cross-check that the existing 1-personal cap is still intact in
--     create_workspace_with_owner — same text-match shape. If this drops
--     to false the migration accidentally regressed the WT-4 cap.
--   select
--     proname,
--     position('You can only have one personal workspace.'
--              in pg_get_functiondef(oid)) > 0       as personal_cap_intact
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'create_workspace_with_owner';
--   -- Expected: personal_cap_intact = true
--
-- (e) Function signatures unchanged. Re-applying WL-1 should leave the
--     create + accept signatures byte-identical to their WT-4 forms.
--   select proname, pg_get_function_arguments(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('create_workspace_with_owner', 'accept_workspace_invite')
--   order by proname;
--   -- Expected:
--   --   accept_workspace_invite     | invite_token uuid
--   --   create_workspace_with_owner | workspace_name text, workspace_type text DEFAULT 'agency'::text
-- ============================================================================
