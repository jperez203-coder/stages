-- ============================================================================
-- Phase 4a (post-5c sync) — tighten tasks_update: members → assignee-only
-- ============================================================================
-- This migration was APPLIED LIVE during 5c (2026-05-22) via the Supabase SQL
-- editor but never landed in supabase/migrations/. Documented in PROGRESS.md
-- under the 5c section. Bringing it into the repo now as part of the step 6
-- back-end work so the migrations folder reflects live DB state.
--
-- WHAT IT DOES: replaces the original tasks_update policy from
-- 20260509120000_rls_policies.sql with a tightened version. The previous
-- member branch was:
--   `can_check_pipeline_task(s.pipeline_id)`  — any member with the flag
--                                                could UPDATE ANY task in
--                                                the pipeline server-side
-- The new member branch is:
--   `can_check_pipeline_task(s.pipeline_id)
--      AND tasks.assignee_id = (select auth.uid())`
--                                              — members can only UPDATE
--                                                their own assigned tasks
--
-- The WITH CHECK clause is identical to USING (mirroring the existing
-- pattern from the initial policy), which ALSO prevents members from
-- reassigning a task off themselves mid-update — the post-update row would
-- have a different assignee_id, failing WITH CHECK. Owner/admin and client
-- branches are unchanged.
--
-- APPLYING THIS TO THE LIVE DB IS A NO-OP: the policy with this exact
-- expression already exists in production. Re-running the DROP + CREATE
-- produces a byte-for-byte identical policy. Verified via:
--   SELECT polqual::text, polwithcheck::text FROM pg_policy
--   WHERE polname = 'tasks_update';
--
-- ┌─ DOWN PLAN
-- │   (Revert to the original member branch from
-- │    20260509120000_rls_policies.sql — drop the assignee_id check.)
-- │   drop policy if exists tasks_update on public.tasks;
-- │   create policy tasks_update on public.tasks
-- │   for update using (
-- │     exists (select 1 from public.stages s where s.id = tasks.stage_id
-- │       and (public.can_edit_pipeline(s.pipeline_id)
-- │            or (public.is_pipeline_client(s.pipeline_id)
-- │                and tasks.client_visible = true and s.client_visible = true)
-- │            or public.can_check_pipeline_task(s.pipeline_id))))
-- │   with check ( /* identical */ );
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================

drop policy if exists tasks_update on public.tasks;

create policy tasks_update on public.tasks
for update using (
  exists (
    select 1 from public.stages s
    where s.id = tasks.stage_id
      and (
        public.can_edit_pipeline(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and tasks.client_visible = true
          and s.client_visible = true
        )
        or (
          public.can_check_pipeline_task(s.pipeline_id)
          and tasks.assignee_id = (select auth.uid())
        )
      )
  )
)
with check (
  exists (
    select 1 from public.stages s
    where s.id = tasks.stage_id
      and (
        public.can_edit_pipeline(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and tasks.client_visible = true
          and s.client_visible = true
        )
        or (
          public.can_check_pipeline_task(s.pipeline_id)
          and tasks.assignee_id = (select auth.uid())
        )
      )
  )
);


-- ============================================================================
-- Verification (run manually after apply — should be a no-op vs live state)
-- ============================================================================
-- 1. Policy exists + has the new member branch with assignee_id check:
--   select polname, polqual::text, polwithcheck::text from pg_policy
--   where polrelid = 'public.tasks'::regclass and polname = 'tasks_update';
--   Expected: 1 row. Both columns contain the substring
--   "tasks.assignee_id = ( SELECT auth.uid() AS uid)".
--
-- 2. Functional (member is NOT assignee of task X):
--   set local request.jwt.claims to '{"sub":"<member-uuid>","role":"authenticated"}';
--   update public.tasks set done = true where id = '<task-not-assigned-to-them>';
--   Expected: 0 rows updated (USING hides the row).
--
-- 3. Functional (member IS assignee):
--   update public.tasks set done = true where id = '<task-they-own>';
--   Expected: 1 row updated.
--
-- 4. Functional (member tries to reassign their task to someone else):
--   update public.tasks set assignee_id = '<other-user>' where id = '<their-task>';
--   Expected: ERROR 42501 (WITH CHECK rejects — post-update assignee_id != caller).
-- ============================================================================
