-- ============================================================================
-- Phase 4b-1 — portal-visibility RLS additions
-- ============================================================================
-- Two RLS gaps surfaced during 4b-1 client-portal scoping. Both block
-- pure pipeline_clients (Casey: pipeline_memberships.role='client', no
-- workspace_memberships) from reading data they need for the portal UX:
--
--   GAP 1 — profiles_select: clients can't read agency-member profiles.
--   ─────────────────────────────────────────────────────────────────
--   The existing branch 3 ("shared pipeline_memberships") joins through
--   pipeline_memberships, which is itself RLS-restricted:
--
--     create policy pipeline_memberships_select on pipeline_memberships
--     for select using (
--       is_pipeline_agency_member(pipeline_id)
--       or user_id = auth.uid()
--     );
--
--   For a client, is_pipeline_agency_member returns false → they can
--   only SELECT their own pipeline_memberships row. The subquery's JOIN
--   to `theirs` can only match their own row, so theirs.user_id never
--   equals an agency member's id → the branch always returns false for
--   clients. Result: chat messages from agency authors render with
--   author=null ("Pending member" + "?" avatar) for client viewers.
--
--   GAP 2 — workspaces_select: clients can't read the workspace row.
--   ─────────────────────────────────────────────────────────────────
--   The existing policy is gated solely on is_workspace_member, which
--   only checks workspace_memberships. Pure clients have no row there
--   → can't SELECT the workspace. Result: the portal chrome can't
--   display "by ACME Agency" because workspace.name is invisible.
--
-- Both fixes are added here as a single migration:
--
--   1. New security-definer helper `users_share_pipeline(a, b)` that
--      bypasses internal RLS to evaluate "do these two users have any
--      pipeline in common?" — used as the basis of GAP-1's fix.
--
--   2. New branch on profiles_select (clause 5) using that helper. A
--      user can read another user's profile if they share any pipeline,
--      regardless of either user's role. Covers client → agency
--      direction that existing clauses miss.
--
--   3. New branch on workspaces_select for clients of any pipeline in
--      the workspace. Lets the portal chrome render the agency name.
--
-- SECURITY EVALUATION:
--   * The new profiles branch only widens visibility to "users on the
--     same pipeline" — same conceptual scope as the existing branch 3,
--     but expressible for client viewers. Does NOT leak profiles of
--     users on different pipelines or different workspaces.
--   * The new workspaces branch only fires for users with an explicit
--     pipeline_memberships(role='client') row on some pipeline in the
--     target workspace. Clients see the workspace name only for
--     workspaces whose pipelines they're a member of.
--   * users_share_pipeline is security-definer + stable + search_path
--     locked. Same hygiene as every other RLS helper in this schema
--     (is_pipeline_agency_member, can_edit_pipeline, etc.).
--
-- ┌─ DOWN PLAN
-- │
-- │   -- Revert workspaces_select to is_workspace_member only:
-- │   drop policy if exists workspaces_select on public.workspaces;
-- │   create policy workspaces_select on public.workspaces
-- │   for select using (public.is_workspace_member(id));
-- │
-- │   -- Revert profiles_select to the 4-branch version from
-- │   -- 20260524120000_profiles_select_workspace_owner_pipeline_members.sql
-- │   drop policy if exists profiles_select on public.profiles;
-- │   create policy profiles_select on public.profiles
-- │   for select using (
-- │     id = (select auth.uid())
-- │     or exists (
-- │       select 1 from public.workspace_memberships my
-- │       join public.workspace_memberships theirs
-- │         on theirs.workspace_id = my.workspace_id
-- │       where my.user_id = (select auth.uid())
-- │         and theirs.user_id = public.profiles.id
-- │     )
-- │     or exists (
-- │       select 1 from public.pipeline_memberships my
-- │       join public.pipeline_memberships theirs
-- │         on theirs.pipeline_id = my.pipeline_id
-- │       where my.user_id = (select auth.uid())
-- │         and theirs.user_id = public.profiles.id
-- │     )
-- │     or exists (
-- │       select 1 from public.workspace_memberships my
-- │       join public.pipelines p on p.workspace_id = my.workspace_id
-- │       join public.pipeline_memberships pm on pm.pipeline_id = p.id
-- │       where my.user_id = (select auth.uid())
-- │         and my.role in ('owner', 'admin')
-- │         and pm.user_id = public.profiles.id
-- │     )
-- │   );
-- │
-- │   drop function if exists public.users_share_pipeline(uuid, uuid);
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Helper: users_share_pipeline ───────────────────────────────────────
-- Security-definer so the internal `pipeline_memberships` reads bypass
-- the calling user's RLS (otherwise a client caller would see only
-- their own row and the join would never match agency members).
-- search_path locked per the standard pattern for security-definer
-- functions.
create or replace function public.users_share_pipeline(
  user_a uuid,
  user_b uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.pipeline_memberships pa
    join public.pipeline_memberships pb
      on pb.pipeline_id = pa.pipeline_id
    where pa.user_id = user_a
      and pb.user_id = user_b
  );
$$;


-- ─── 2. profiles_select — replace with 5-branch version ────────────────────
-- Adds branch 5 (users_share_pipeline). Branches 1-4 are preserved
-- verbatim from 20260524120000_profiles_select_workspace_owner_pipeline_members.sql
-- so the existing access patterns (self, shared workspace, shared
-- pipeline directly-visible-membership, workspace owner/admin → pipeline
-- members) all continue to work. Branch 5 is the new client-friendly
-- path.
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
for select using (
  -- 1. self
  id = (select auth.uid())

  -- 2. shared workspace_memberships
  or exists (
    select 1
    from public.workspace_memberships my
    join public.workspace_memberships theirs
      on theirs.workspace_id = my.workspace_id
    where my.user_id = (select auth.uid())
      and theirs.user_id = public.profiles.id
  )

  -- 3. shared pipeline_memberships (visible-via-RLS variant)
  or exists (
    select 1
    from public.pipeline_memberships my
    join public.pipeline_memberships theirs
      on theirs.pipeline_id = my.pipeline_id
    where my.user_id = (select auth.uid())
      and theirs.user_id = public.profiles.id
  )

  -- 4. workspace owner/admin → any pipeline_member in their workspace
  or exists (
    select 1
    from public.workspace_memberships my
    join public.pipelines p on p.workspace_id = my.workspace_id
    join public.pipeline_memberships pm on pm.pipeline_id = p.id
    where my.user_id = (select auth.uid())
      and my.role in ('owner', 'admin')
      and pm.user_id = public.profiles.id
  )

  -- 5. NEW: users who share any pipeline can see each other's profiles.
  --    Uses the security-definer helper to bypass internal RLS so
  --    client → agency direction works (clients can't SELECT agency
  --    pipeline_memberships rows directly, but the helper can see both
  --    rows to evaluate the join). Critical for client portal: lets
  --    Casey see Jordan/Taylor/Alex's display_name + avatar in chat
  --    messages instead of "Pending member" + "?" placeholders.
  or public.users_share_pipeline(
    (select auth.uid()),
    public.profiles.id
  )
);


-- ─── 3. workspaces_select — replace with 2-branch version ──────────────────
-- Adds a client-pipeline-membership branch so clients of any pipeline
-- in the workspace can read the workspace row. Lets the portal chrome
-- render "by ACME Agency."
drop policy if exists workspaces_select on public.workspaces;

create policy workspaces_select on public.workspaces
for select using (
  public.is_workspace_member(id)

  -- NEW: clients of any pipeline in this workspace can see the workspace
  -- row. Scoped strictly to role='client' — does not widen visibility
  -- for any other relationship.
  or exists (
    select 1
    from public.pipelines p
    join public.pipeline_memberships pm on pm.pipeline_id = p.id
    where p.workspace_id = public.workspaces.id
      and pm.user_id = (select auth.uid())
      and pm.role = 'client'
  )
);


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Helper exists with the right security context:
--   select proname, prosecdef, provolatile,
--          pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'users_share_pipeline';
--   Expected: 1 row, prosecdef=true, provolatile='s' (stable),
--   args='user_a uuid, user_b uuid'.
--
-- 2. profiles_select has 5 branches (look for users_share_pipeline):
--   select polqual::text
--   from pg_policy
--   where polrelid = 'public.profiles'::regclass
--     and polname = 'profiles_select';
--   Expected: 1 row. polqual contains 'users_share_pipeline'.
--
-- 3. workspaces_select has the new client branch:
--   select polqual::text
--   from pg_policy
--   where polrelid = 'public.workspaces'::regclass
--     and polname = 'workspaces_select';
--   Expected: 1 row. polqual contains 'role = ''client''' (or similar).
--
-- 4. Functional — impersonating Casey (pure client, no workspace_memberships):
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims to
--     '{"sub":"<casey-uuid>","role":"authenticated"}';
--
--   -- 4a. Casey can now SELECT Jordan's profile:
--   select id, display_name, email from public.profiles
--   where id = '<jordan-uuid>';
--   -- Expected: 1 row with Jordan's real name + email.
--
--   -- 4b. Casey can SELECT the workspace row:
--   select id, name, slug from public.workspaces
--   where id = '<test-workspace-4b-uuid>';
--   -- Expected: 1 row with workspace name = 'Test Workspace 4b'.
--
--   -- 4c. Casey STILL cannot see profiles on workspaces she's not in.
--   --     (Pick any user_id from a workspace where Casey has no
--   --      pipeline_memberships and check the result is empty.)
--   select id from public.profiles where id = '<unrelated-user-uuid>';
--   -- Expected: 0 rows.
--
--   rollback;
--
-- 5. Functional — impersonating an unrelated user (negative test):
--   Casey is a client on pipeline P (workspace W). Some user U has no
--   relationship to either. U queries for Casey's workspace + profile
--   → both should return 0 rows.
-- ============================================================================
