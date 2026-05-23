-- ============================================================================
-- 4b-1 follow-up: profiles_select — branch 6 (workspace owner visible to
-- pipeline members of any pipeline in their workspace)
-- ============================================================================
-- BUG SURFACED: a pipeline_client (Casey) opens the portal chat and sees
-- "Deleted user" on messages authored by the workspace owner (Jordan).
-- Trace:
--
--   * Jordan (workspace_owner) has access to the pipeline via the
--     workspace_memberships(role='owner') branch of is_pipeline_agency_member.
--   * He has a channel_memberships row in the client channel (seeded by
--     create_pipeline_with_channels' step 5 — the RPC seeds the creator
--     into both channels). So he CAN post messages there.
--   * But he has NO pipeline_memberships row on this pipeline.
--   * users_share_pipeline(Casey, Jordan) — added in 20260527120000 —
--     evaluates "do both have pipeline_memberships rows on the same
--     pipeline?" → false (Jordan has none).
--   * No other branch of profiles_select matches:
--       1 (self): no, different user
--       2 (shared workspace_memberships): no, Casey has none
--       3 (shared pipeline_memberships): no, Casey can only see own
--       4 (workspace owner → pipeline_member): no, Casey isn't owner
--       5 (users_share_pipeline): no, see above
--   * Result: Casey's chat-data server fetch can't read Jordan's profile
--     row. message.author resolves to null. MessageThread renders
--     "Deleted user" (the branch designed for FK-set-null deleted
--     accounts, which also catches profile-not-readable).
--
-- FIX: add a 6th branch — the symmetric counterpart of branch 4.
-- Branch 4 lets workspace owners/admins see pipeline_members in their
-- workspace; branch 6 lets pipeline_members see workspace owners of
-- their workspace.
--
-- SECURITY EVALUATION:
--   * The new branch only widens visibility to workspace OWNERS of a
--     workspace where the caller is a pipeline_member. Workspace owners
--     already have full administrative access to every pipeline in
--     their workspace — they can read every message, every file, every
--     stage of that pipeline. Making them visible to clients of their
--     pipelines doesn't widen trust; it just makes the existing trust
--     relationship visible (Casey already trusts Jordan because he can
--     act on her data; she should be able to see his name).
--   * Scoped strictly to role='owner' — workspace admins are NOT
--     added by this branch. Admins reach pipelines via explicit
--     pipeline_memberships rows, which means branches 3 and 5 already
--     cover them.
--   * Does NOT leak across workspaces. The join requires the caller's
--     pipeline_memberships row's workspace to match the target's
--     workspace_memberships row's workspace.
--
-- ┌─ DOWN PLAN
-- │
-- │   -- Revert profiles_select to the 5-branch version from
-- │   -- 20260527120000_portal_visibility_rls.sql
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
-- │     or public.users_share_pipeline(
-- │       (select auth.uid()), public.profiles.id
-- │     )
-- │   );
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================

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

  -- 5. shared-pipeline via security-definer helper (works for any two
  --    users with pipeline_memberships rows on the same pipeline,
  --    bypasses internal RLS so client→agency direction works)
  or public.users_share_pipeline(
    (select auth.uid()),
    public.profiles.id
  )

  -- 6. NEW: workspace OWNERS are visible to pipeline_members (any role,
  --    incl. clients) of any pipeline in their workspace. Inverse of
  --    branch 4. Covers the case where a workspace owner accesses a
  --    pipeline via workspace ownership only (no explicit
  --    pipeline_memberships row) — they can author messages via
  --    channel_memberships seeded at pipeline creation, but their
  --    profile is invisible to clients on those pipelines without
  --    this branch.
  --
  --    Scoped strictly to role='owner'. Admins reach pipelines via
  --    explicit pipeline_memberships rows → covered by branches 3
  --    and 5; not added here.
  or exists (
    select 1
    from public.pipeline_memberships my
    join public.pipelines p on p.id = my.pipeline_id
    join public.workspace_memberships theirs
      on theirs.workspace_id = p.workspace_id
    where my.user_id = (select auth.uid())
      and theirs.user_id = public.profiles.id
      and theirs.role = 'owner'
  )
);


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. profiles_select has 6 branches now (look for two 'role = ''owner'''
--    mentions — one from branch 4 with the workspace_memberships path,
--    one from branch 6 with the inverse path; note Postgres may
--    normalize quoting/formatting):
--   select polqual::text
--   from pg_policy
--   where polrelid = 'public.profiles'::regclass
--     and polname = 'profiles_select';
--
-- 2. Functional — Casey (pipeline_client) can read Jordan (workspace_owner)
--    after applying:
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims to
--     '{"sub":"<casey-uuid>","role":"authenticated"}';
--
--   select id, display_name, email from public.profiles
--   where id = '<jordan-uuid>';
--   -- Expected post-migration: 1 row with Jordan's real display_name
--   -- + email. Pre-migration: 0 rows (the bug).
--
--   rollback;
--
-- 3. Negative — confirm workspace admins are NOT pulled in by branch 6
--    (branch 6 is owner-only). Pick a workspace_admin who has no
--    pipeline_memberships row on Casey's pipeline; Casey looks them
--    up:
--
--   set local request.jwt.claims to
--     '{"sub":"<casey-uuid>","role":"authenticated"}';
--   select id from public.profiles where id = '<workspace-admin-uuid>';
--   -- Expected: 0 rows (admin is unreachable for Casey if they have
--   -- no pipeline_memberships on her pipeline). In practice admins
--   -- typically DO have a pipeline_memberships row since that's how
--   -- they get pipeline access; this query just verifies branch 6
--   -- isn't accidentally widening to admins.
--
-- 4. Negative — cross-workspace isolation. Pick a workspace owner of
--    a DIFFERENT workspace where Casey has no pipeline_memberships:
--
--   select id from public.profiles where id = '<other-workspace-owner-uuid>';
--   -- Expected: 0 rows. Confirms branch 6 is workspace-scoped, not
--   -- a blanket "all workspace owners are visible to all clients."
--
-- 5. End-to-end (after re-test in the UI): re-open /portal/<7a-id>/chat
--    as Casey. Jordan's messages now show with his real display_name
--    + avatar (or his email-prefix fallback if no display_name set),
--    not "Deleted user."
-- ============================================================================
