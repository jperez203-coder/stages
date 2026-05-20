-- ============================================================================
-- Phase 4a (step 4 prep, hotfix) — fix ambiguous stage_id ref in create_task
-- ============================================================================
-- The previous migration (20260520130000_create_task_rpc) shipped a function
-- body with an ambiguous column reference. In the line
--
--   select coalesce(max(position), 0) + 1 into new_position
--   from public.tasks where stage_id = create_task.stage_id;
--
-- PostgreSQL couldn't decide whether the left-hand `stage_id` referred to
-- the table column or the function parameter (both share the name). Caught
-- during smoke-test runs of the prior migration. Fix: alias the table so
-- the column reference is unambiguous.
--
-- CREATE OR REPLACE keeps the existing grants intact — no need to re-issue
-- the revoke/grant block.
--
-- ┌─ DOWN PLAN
-- │   Restore the function body from 20260520130000 (with the ambiguous ref).
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================

create or replace function public.create_task(
  stage_id     uuid,
  title        text,
  assignee_id  uuid default null,
  deadline     timestamptz default null
)
returns json
language plpgsql security definer
set search_path = ''
as $$
declare
  actor             uuid := (select auth.uid());
  cleaned_title     text;
  parent_pipeline   uuid;
  resolved_assignee uuid;
  new_position      int;
  new_task_id       uuid;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  cleaned_title := trim(coalesce(title, ''));
  if cleaned_title = '' then
    raise exception 'Task title cannot be empty' using errcode = '22023';
  end if;
  if length(cleaned_title) > 200 then
    raise exception 'Task title cannot exceed 200 characters'
      using errcode = '22023';
  end if;

  -- Stage lookup. `id` is unambiguous (no function param with that name).
  select pipeline_id into parent_pipeline
  from public.stages s where s.id = create_task.stage_id;
  if parent_pipeline is null then
    raise exception 'Stage not found' using errcode = '22023';
  end if;
  if not public.can_edit_pipeline(parent_pipeline) then
    raise exception 'You don''t have permission to add tasks to this pipeline'
      using errcode = '42501';
  end if;

  -- Assignee defaults to the caller (quick-add self-assigns); explicit
  -- assignment + unassign handled in task detail (step 6).
  resolved_assignee := coalesce(assignee_id, actor);

  -- Position = max(position) + 1 in the target stage. Table aliased so the
  -- left-hand stage_id is unambiguously the column, not the function param.
  select coalesce(max(t.position), 0) + 1 into new_position
  from public.tasks t where t.stage_id = create_task.stage_id;

  insert into public.tasks (stage_id, position, title, assignee_id, deadline)
  values (create_task.stage_id, new_position, cleaned_title, resolved_assignee, deadline)
  returning id into new_task_id;

  return json_build_object(
    'id',          new_task_id,
    'stage_id',    create_task.stage_id,
    'title',       cleaned_title,
    'position',    new_position,
    'assignee_id', resolved_assignee,
    'deadline',    deadline,
    'created_at',  now()
  );
end;
$$;
