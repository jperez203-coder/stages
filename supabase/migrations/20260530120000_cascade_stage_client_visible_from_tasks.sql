-- ============================================================================
-- Phase 4b-2-a fix: cascade stages.client_visible from sibling tasks
-- ============================================================================
-- BUG it closes:
--   stages.client_visible defaults to false and no UI exists to flip it.
--   The agency TaskDetailPanel has a client_visible toggle on TASKS only.
--   Marking a task client_visible=true does nothing for clients because
--   the chain-visibility rule in tasks_select RLS requires BOTH
--   tasks.client_visible=true AND stages.client_visible=true. The parent
--   stage stays hidden → RLS chain-blocks every "visible" task → clients
--   see the canvas empty state.
--
-- POLICY (locked, Jordan 2026-05-25):
--   A stage's client_visible is the OR of its tasks' client_visible:
--     true  → at least one task in this stage has client_visible=true
--     false → no tasks in this stage have client_visible=true
--                 (includes the empty-stage case — stage with zero tasks
--                  has no visible tasks, so it stays hidden)
--   The agency toggles task visibility; the stage's visibility is
--   derived. No separate stage-level UI needed.
--
-- IMPLEMENTATION:
--   AFTER trigger on tasks (INSERT / UPDATE OF client_visible, stage_id /
--   DELETE) that recomputes the affected stage(s) and writes back only
--   when the value changes. One-time backfill brings existing data into
--   consistency.
--
-- NON-RECURSIVE BY CONSTRUCTION:
--   * Cascade fires only on tasks.client_visible or tasks.stage_id changes
--     (the `UPDATE OF cols` filter); done-flips, title edits, etc. don't
--     fire it.
--   * Cascade writes ONLY stages.client_visible.
--   * No triggers exist on public.stages today, so the cascade write
--     cannot re-fire any other trigger.
--
--   FUTURE-MAINTAINER WARNING: if you add a trigger on public.stages
--   that updates tasks AND changes tasks.client_visible or
--   tasks.stage_id, you MUST analyze whether it can loop with this
--   cascade. Postgres has no built-in recursion detection here.
--
-- INTERACTION WITH OTHER TASK TRIGGERS:
--   * tasks_enforce_client_update_scope (BEFORE) — rejects client
--     attempts to change client_visible. Cascade never sees client
--     attempts.
--   * tasks_enforce_member_update_scope (BEFORE) — rejects member
--     attempts. Same.
--   * set_task_completion_metadata (BEFORE OF done) — only writes the
--     task's own completed_at/completed_by; doesn't bait cascade.
--   * tasks_auto_advance_stage (AFTER OF done) — only baited by `done`
--     changes; doesn't bait cascade.
--
-- ┌─ DOWN PLAN
-- │
-- │   drop trigger if exists tasks_cascade_stage_client_visible
-- │     on public.tasks;
-- │   drop function if exists public.cascade_stage_client_visible();
-- │   -- Note: the down plan does NOT revert stages.client_visible to
-- │   --   the pre-backfill state (that data is lost). If you need to
-- │   --   unwind the backfill specifically, restore from a pre-apply
-- │   --   snapshot rather than running an inverse UPDATE.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Trigger function ───────────────────────────────────────────────────
-- security definer to bypass stages_update RLS (can_edit_pipeline).
-- search_path locked. The function determines which stage(s) need
-- recomputation based on the operation, then writes only when the
-- value actually changes — avoiding noise on stages that already had
-- the correct value.
create or replace function public.cascade_stage_client_visible()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_stage_ids uuid[];
begin
  -- Collect affected stage(s) based on operation.
  if TG_OP = 'INSERT' then
    affected_stage_ids := array[NEW.stage_id];
  elsif TG_OP = 'DELETE' then
    affected_stage_ids := array[OLD.stage_id];
  elsif TG_OP = 'UPDATE' then
    -- The trigger's `UPDATE OF client_visible, stage_id` filter already
    -- restricts firing to relevant changes. Inside, if stage_id changed,
    -- BOTH old and new stage need recomputation (task moved across).
    if NEW.stage_id = OLD.stage_id then
      affected_stage_ids := array[NEW.stage_id];
    else
      affected_stage_ids := array[NEW.stage_id, OLD.stage_id];
    end if;
  end if;

  -- Recompute client_visible for each affected stage and write back
  -- only when the value differs (avoids unnecessary WAL writes +
  -- avoids waking up any future stage-side downstream we don't know
  -- about yet).
  update public.stages s
  set client_visible = sub.has_visible_task
  from (
    select s2.id as stage_id,
           exists (
             select 1 from public.tasks t
             where t.stage_id = s2.id
               and t.client_visible = true
           ) as has_visible_task
    from public.stages s2
    where s2.id = any(affected_stage_ids)
  ) sub
  where s.id = sub.stage_id
    and s.client_visible is distinct from sub.has_visible_task;

  return coalesce(NEW, OLD);
end;
$$;


-- ─── 2. Trigger binding ───────────────────────────────────────────────────
-- AFTER INSERT, AFTER UPDATE OF (client_visible | stage_id), AFTER DELETE.
-- The `UPDATE OF` filter is performance + correctness: title/description/
-- deadline/done edits don't fire this trigger, so the agency canvas's
-- frequent done-toggles and inline-rename edits don't pay the cost.
drop trigger if exists tasks_cascade_stage_client_visible on public.tasks;

create trigger tasks_cascade_stage_client_visible
after insert or update of client_visible, stage_id or delete
on public.tasks
for each row
execute function public.cascade_stage_client_visible();


-- ─── 3. One-time backfill ─────────────────────────────────────────────────
-- Brings every existing stage into consistency with the cascade rule.
-- Stages with ≥1 client-visible task get flipped to true; stages with
-- zero client-visible tasks (including empty stages) stay/become false.
-- Idempotent: re-running the migration is a no-op since the WHERE clause
-- only writes when the value differs.
--
-- Runs as the migration applier (service_role / postgres), bypassing
-- RLS naturally — no security-definer wrapper needed.
update public.stages s
set client_visible = sub.has_visible_task
from (
  select s2.id as stage_id,
         exists (
           select 1 from public.tasks t
           where t.stage_id = s2.id
             and t.client_visible = true
         ) as has_visible_task
  from public.stages s2
) sub
where s.id = sub.stage_id
  and s.client_visible is distinct from sub.has_visible_task;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Trigger function exists, is security definer, search_path locked:
--   select proname, prosecdef, provolatile,
--          (proconfig::text)::text as cfg
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'cascade_stage_client_visible';
--   Expected: 1 row, prosecdef=true, cfg contains 'search_path='.
--
-- 2. Trigger bound to tasks with the right column-of filter:
--   select tgname, pg_get_triggerdef(oid) as def
--   from pg_trigger
--   where tgname = 'tasks_cascade_stage_client_visible'
--     and tgrelid = 'public.tasks'::regclass;
--   Expected: 1 row. def contains "AFTER INSERT OR UPDATE OF
--   client_visible, stage_id OR DELETE" and "FOR EACH ROW".
--
-- 3. Backfill brought 7a stages into consistency:
--   select s.name, s.client_visible,
--          (select count(*) from public.tasks t
--           where t.stage_id = s.id and t.client_visible = true)
--             as visible_task_count
--   from public.stages s
--   where s.pipeline_id = 'e21260d2-e358-44b6-b453-740dcf30a8bc'
--   order by s.position;
--   Expected: every row's client_visible matches (visible_task_count > 0).
--   Specifically: the "Quick Test" stage (or whichever stage Casey has
--   visible tasks under) is now true.
--
-- 4. Forward cascade — flip a task on, stage should flip on:
--   begin;
--   -- Pick a stage currently client_visible=false with all tasks hidden.
--   update public.tasks set client_visible = true
--     where id = '<some-task-id-on-a-hidden-stage>';
--   select client_visible from public.stages
--     where id = (select stage_id from public.tasks
--                 where id = '<same-task-id>');
--   -- Expected: true.
--   rollback;
--
-- 5. Reverse cascade — flip the last visible task off, stage should
--    flip off:
--   begin;
--   -- Pick a stage currently client_visible=true with exactly one
--   -- visible task; flip that task off.
--   update public.tasks set client_visible = false
--     where id = '<the-only-visible-task-on-some-stage>';
--   select client_visible from public.stages
--     where id = (select stage_id from public.tasks
--                 where id = '<same-task-id>');
--   -- Expected: false.
--   rollback;
--
-- 6. Cross-stage move cascade — moving a visible task should update
--    both source AND destination stages:
--   begin;
--   -- Pick a visible task that's currently the ONLY visible task on
--   -- its source stage. Move it to a destination stage that has no
--   -- visible tasks.
--   update public.tasks set stage_id = '<destination-stage-id>'
--     where id = '<visible-task-id>';
--   -- Source stage should now be false (lost its only visible task)
--   -- AND destination stage should now be true (gained one).
--   select id, name, client_visible from public.stages
--     where id in ('<source-stage-id>', '<destination-stage-id>');
--   rollback;
--
-- 7. End-to-end UI: reload /portal/<7a-id>/canvas as Casey. The stages
--    containing her visible tasks now render (with the visible tasks
--    underneath); empty/hidden-only stages stay collapsed out by the
--    PortalCanvas's filtering rule.
-- ============================================================================
