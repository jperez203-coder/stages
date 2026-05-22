-- ============================================================================
-- profiles_select — extend to cover workspace-owner ↔ pipeline-only members
-- ============================================================================
-- BUG: workspace owner (or admin) who does NOT have a pipeline_memberships
-- row in a given pipeline could not read the profiles of pipeline-only
-- members of that pipeline. Surfaced in the canvas TaskDetailPanel's
-- assignee picker (Phase 4a step 6): members invited at the pipeline level
-- only (Taylor, Alex) rendered as "Pending member" because the server-side
-- profiles fetch in fetchCanvasChromeData returned 0 rows for their ids.
-- Same gap silently breaks the pipeline header member popover (it just
-- wasn't noticed because pipeline-only members tend to sit below the fold
-- of the 3-avatar cluster).
--
-- ROOT CAUSE: the original profiles_select policy
-- (20260509120000_rls_policies.sql) had three branches:
--   1. caller's own profile (`id = auth.uid()`)
--   2. caller shares a workspace_memberships with the target user
--   3. caller shares a pipeline_memberships with the target user
--
-- A workspace owner of WS-A who is NOT explicitly in
-- pipeline_memberships of pipeline P (P ∈ WS-A) hits none of these for a
-- user U who is pipeline-only on P (no workspace_memberships row).
-- Workspace owners conventionally do NOT have a pipeline_memberships row
-- — they inherit edit access via workspace_memberships.role='owner' (see
-- is_pipeline_agency_member / can_edit_pipeline). This is consistent with
-- every other policy in the schema; profiles_select was the outlier.
--
-- FIX: add a 4th branch — workspace owner OR admin can read the profile
-- of any user who has a pipeline_memberships row in any pipeline that
-- belongs to a workspace where the caller is owner/admin.
--
-- SECURITY: the new branch is gated to workspace owner/admin roles
-- (workspace_memberships.role in ('owner','admin')). It does NOT widen
-- visibility for:
--   * plain workspace members (still need a shared workspace_memberships
--     or pipeline_memberships row — branches 2 & 3)
--   * clients (have no workspace_memberships row → branch 4 never fires)
--   * cross-workspace queries (workspace_id of the caller's
--     workspace_memberships must match the pipeline's workspace_id)
--
-- The new clause references workspace_memberships, pipelines, and
-- pipeline_memberships — all of which the caller can already read for
-- the rows we're joining (workspace_memberships_select lets a member see
-- their own row; pipelines_select lets a workspace member see workspace
-- pipelines; pipeline_memberships_select lets is_pipeline_agency_member
-- — which includes workspace owners — see all pipeline_memberships of
-- the pipeline). No new helpers, no recursion risk (profiles isn't
-- referenced inside profiles' own policy).
--
-- ┌─ DOWN PLAN
-- │   (Revert to the 3-branch profiles_select from
-- │    20260509120000_rls_policies.sql.)
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
-- │   );
-- └──────────────────────────────────────────────────────────────────────────
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

  -- 3. shared pipeline_memberships
  or exists (
    select 1
    from public.pipeline_memberships my
    join public.pipeline_memberships theirs
      on theirs.pipeline_id = my.pipeline_id
    where my.user_id = (select auth.uid())
      and theirs.user_id = public.profiles.id
  )

  -- 4. NEW: caller is owner/admin of a workspace whose pipelines contain
  --    the target user as a pipeline_member. Closes the pipeline-only
  --    member visibility gap for workspace owners/admins.
  or exists (
    select 1
    from public.workspace_memberships my
    join public.pipelines p
      on p.workspace_id = my.workspace_id
    join public.pipeline_memberships pm
      on pm.pipeline_id = p.id
    where my.user_id = (select auth.uid())
      and my.role in ('owner', 'admin')
      and pm.user_id = public.profiles.id
  )
);


-- ============================================================================
-- Verification — run manually after applying
-- ============================================================================
-- 1. Policy exists and contains the new 4th branch (look for the
--    workspace_memberships ↔ pipelines ↔ pipeline_memberships join):
--
--   select polname, polqual::text
--   from pg_policy
--   where polrelid = 'public.profiles'::regclass
--     and polname = 'profiles_select';
--
--   Expected: 1 row. polqual contains "pipeline_memberships" AND
--   "workspace_memberships" AND "pipelines" AND "role = ANY (ARRAY['owner',
--   'admin']" (Postgres normalizes `in ('owner','admin')` to the ANY form).
--
-- 2. Functional — Jordan (workspace owner of WS-A, NO pipeline_memberships
--    row in pipeline P) can now see Taylor + Alex (pipeline-only members
--    of P, no workspace_memberships row):
--
--   set local role authenticated;
--   set local request.jwt.claims to
--     '{"sub":"f3d54a29-ad84-4de5-a727-5af825be3206","role":"authenticated"}';
--
--   select id, display_name, email
--   from public.profiles
--   where id in (
--     '69d33d11-...',          -- Taylor
--     '<alex-user-id>',        -- Alex
--     'f3d54a29-ad84-4de5-a727-5af825be3206'  -- Jordan (sanity: self via branch 1)
--   );
--
--   Expected: 3 rows. Taylor's row has display_name = 'Taylor Teammate',
--   Alex's row has display_name = 'Alex Agency'. Pre-migration this query
--   returned only Jordan's row.
--
-- 3. Negative — confirm the new branch does NOT leak across workspaces.
--    Pick any user_id who is a pipeline_member of a pipeline in a
--    DIFFERENT workspace where Jordan is NOT a member:
--
--   set local request.jwt.claims to '{"sub":"<jordan>","role":"authenticated"}';
--   select id from public.profiles where id = '<some-other-workspace-user>';
--
--   Expected: 0 rows.
--
-- 4. Negative — confirm clients cannot use the new branch (clients have
--    no workspace_memberships row, so the join never produces matches):
--
--   set local request.jwt.claims to '{"sub":"<client-user-id>","role":"authenticated"}';
--   select id from public.profiles
--   where id = '<some-pipeline-agency-member-not-shared-with-client>';
--
--   Expected: 0 rows (client visibility is unchanged).
-- ============================================================================
