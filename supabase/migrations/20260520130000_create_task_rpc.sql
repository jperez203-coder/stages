-- ============================================================================
-- Phase 4a (step 4 prep) — create_task RPC
-- ============================================================================
-- Atomic task creation for the quick-add UX on /w/[slug]/my-tasks. Direct
-- INSERT into tasks would pass RLS (tasks_insert allows agency editors of
-- the parent pipeline), but tasks.position is NOT NULL with no default —
-- so the position needs to be computed as max(position)+1 in the target
-- stage, which is race-prone if done client-side. An RPC bundles the
-- position compute + INSERT in one transaction.
--
-- ┌─ DOWN PLAN
-- │   drop function if exists public.create_task(uuid, text, uuid, timestamptz);
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

  -- Title validation: trim + non-empty + 200-char cap. Length cap is
  -- intentionally higher than pipeline/workspace name (80) — task titles
  -- in the wild ("Send Q3 progress report to Acme stakeholders…") run
  -- longer than entity names.
  cleaned_title := trim(coalesce(title, ''));
  if cleaned_title = '' then
    raise exception 'Task title cannot be empty' using errcode = '22023';
  end if;
  if length(cleaned_title) > 200 then
    raise exception 'Task title cannot exceed 200 characters'
      using errcode = '22023';
  end if;

  -- Permission gate — same rule as the tasks_insert RLS policy. Resolves
  -- via stage → pipeline → can_edit_pipeline (workspace member OR pipeline
  -- agency role).
  select pipeline_id into parent_pipeline
  from public.stages where id = create_task.stage_id;
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

  -- Position = max(position) + 1 in the target stage, atomic with the
  -- INSERT below since this is one PL/pgSQL function = one transaction.
  select coalesce(max(position), 0) + 1 into new_position
  from public.tasks where stage_id = create_task.stage_id;

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


-- Grants
revoke execute on function
  public.create_task(uuid, text, uuid, timestamptz)
  from public;

grant execute on function
  public.create_task(uuid, text, uuid, timestamptz)
  to authenticated;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Function exists + grants right:
--   select p.proname, p.prosecdef,
--          pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and p.proname='create_task';
--   Expected: 1 row, prosecdef=true,
--   args = 'stage_id uuid, title text, assignee_id uuid DEFAULT NULL::uuid,
--           deadline timestamp with time zone DEFAULT NULL::timestamp with time zone'.
--
-- 2. Functional smoke (workspace owner, valid stage, defaults):
--   set local request.jwt.claims to '{"sub":"<UUID>","role":"authenticated"}';
--   select public.create_task('<stage-uuid>'::uuid, 'Smoke test task');
--   Expected: returned json with id, position=N+1, assignee_id=caller, deadline=null.
--
-- 3. Empty title rejected:
--   select public.create_task('<stage-uuid>'::uuid, '   ');
--   Expected: ERROR 22023 'Task title cannot be empty'.
--
-- 4. Too-long title rejected:
--   select public.create_task('<stage-uuid>'::uuid, repeat('x', 201));
--   Expected: ERROR 22023 'Task title cannot exceed 200 characters'.
--
-- 5. Permission denied for non-member:
--   (impersonate a user who has no membership on the workspace)
--   select public.create_task('<stage-uuid>'::uuid, 'x');
--   Expected: ERROR 42501 'You don't have permission to add tasks to this pipeline'.
-- ============================================================================
