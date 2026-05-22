-- ============================================================================
-- Phase 4a step 5e (backend) — edit-pipeline RPCs
-- ============================================================================
-- Four security-definer RPCs that comprise the entire write surface for the
-- edit-pipeline mode shipping in 5e UI:
--
--   create_stage(pipeline_id, name, after_stage_id default null)
--                                  → append (after_stage_id null) OR insert
--                                    between (after_stage_id set; subsequent
--                                    positions shift +1)
--
--   reorder_stages(pipeline_id, ordered_stage_ids[])
--                                  → atomic rewrite of all stage positions;
--                                    rejects partial arrays
--
--   reorder_tasks_in_stage(stage_id, ordered_task_ids[])
--                                  → atomic rewrite of all task positions in
--                                    one stage; rejects partial arrays
--
--   move_task(task_id, target_stage_id, target_position)
--                                  → cross-stage AND within-stage move; clamps
--                                    target_position inclusive-end (within-
--                                    stage [1,count]; cross-stage [1,count+1])
--
-- Rename + delete stage are NOT new RPCs:
--   * stage rename = direct UPDATE stages SET name = … WHERE id = …
--   * stage delete = direct DELETE FROM stages WHERE id = …
--                    (tasks cascade via existing tasks_stage_id_fkey
--                     ON DELETE CASCADE from the initial schema)
-- Both gated by existing RLS — no RPC needed.
--
-- All four RPCs:
--   * security definer, search_path = '' (caller schema isolation)
--   * gate on auth.uid() not null + can_edit_pipeline(pipeline_id)
--     — mirrors RLS for direct UPDATE/DELETE rename + delete paths
--   * bump pipelines.last_edited_at = now() on success
--   * validate input (non-empty arrays, name length ≤ 80, stage/task
--     ownership of parent pipeline, target_position ≥ 1)
--   * raise SQLSTATE 42501 (insufficient_privilege) for auth/perms
--           SQLSTATE 22023 (invalid_parameter_value)   for input/validation
--
-- No unique constraint on (pipeline_id, position) exists on either `stages`
-- or `tasks` — verified live:
--   select conname from pg_constraint where conrelid='public.stages'::regclass
--   and contype='u' → 0 rows; same for `tasks`. The position-shift logic in
--   create_stage and the two-step shift-and-move in move_task are therefore
--   safe as-is — no mid-shift uniqueness violation, no need for DEFERRABLE
--   constraints or two-pass shift trick. If a future migration adds
--   UNIQUE(pipeline_id, position), it must be DEFERRABLE INITIALLY IMMEDIATE
--   with `set constraints all deferred` inside these RPCs, OR these bodies
--   must be rewritten to two-pass (shift to negative temp values → final).
--
-- The bodies below are verbatim from the live DB via pg_get_functiondef;
-- the migration file landed AFTER the RPCs were already in production
-- (previous session ended before commit), so this migration syncs the repo
-- to the DB rather than applying a fresh change.
--
-- ┌─ DOWN PLAN
-- │   drop function if exists public.create_stage(uuid, text, uuid);
-- │   drop function if exists public.reorder_stages(uuid, uuid[]);
-- │   drop function if exists public.reorder_tasks_in_stage(uuid, uuid[]);
-- │   drop function if exists public.move_task(uuid, uuid, integer);
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── create_stage ───────────────────────────────────────────────────────────

create or replace function public.create_stage(pipeline_id uuid, name text, after_stage_id uuid default null)
returns json language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  cleaned_name text;
  new_position int;
  new_stage_id uuid;
  after_position int;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.can_edit_pipeline(create_stage.pipeline_id) then raise exception 'Permission denied' using errcode = '42501'; end if;
  cleaned_name := trim(coalesce(create_stage.name, ''));
  if cleaned_name = '' then raise exception 'Stage name cannot be empty' using errcode = '22023'; end if;
  if length(cleaned_name) > 80 then raise exception 'Stage name too long (max 80 chars)' using errcode = '22023'; end if;
  if create_stage.after_stage_id is null then
    select coalesce(max(s.position), 0) + 1 into new_position from public.stages s where s.pipeline_id = create_stage.pipeline_id;
  else
    select s.position into after_position from public.stages s where s.id = create_stage.after_stage_id and s.pipeline_id = create_stage.pipeline_id;
    if after_position is null then raise exception 'after_stage_id does not belong to this pipeline' using errcode = '22023'; end if;
    update public.stages s set position = s.position + 1 where s.pipeline_id = create_stage.pipeline_id and s.position > after_position;
    new_position := after_position + 1;
  end if;
  insert into public.stages (pipeline_id, name, position) values (create_stage.pipeline_id, cleaned_name, new_position) returning id into new_stage_id;
  update public.pipelines set last_edited_at = now() where id = create_stage.pipeline_id;
  return json_build_object('id', new_stage_id, 'pipeline_id', create_stage.pipeline_id, 'name', cleaned_name, 'position', new_position);
end;
$function$;


-- ─── reorder_stages ─────────────────────────────────────────────────────────

create or replace function public.reorder_stages(pipeline_id uuid, ordered_stage_ids uuid[])
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  expected_count int;
  matched_count int;
  total_count int;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if not public.can_edit_pipeline(reorder_stages.pipeline_id) then raise exception 'Permission denied' using errcode = '42501'; end if;
  expected_count := array_length(reorder_stages.ordered_stage_ids, 1);
  if expected_count is null or expected_count = 0 then raise exception 'ordered_stage_ids cannot be empty' using errcode = '22023'; end if;
  select count(distinct s.id) into matched_count from public.stages s where s.pipeline_id = reorder_stages.pipeline_id and s.id = any(reorder_stages.ordered_stage_ids);
  if matched_count != expected_count then raise exception 'ordered_stage_ids contains stages not in this pipeline OR duplicates (matched %, expected %)', matched_count, expected_count using errcode = '22023'; end if;
  select count(*) into total_count from public.stages s where s.pipeline_id = reorder_stages.pipeline_id;
  if total_count != expected_count then raise exception 'ordered_stage_ids must contain ALL stages in the pipeline (got %, pipeline has %)', expected_count, total_count using errcode = '22023'; end if;
  update public.stages s set position = new_pos.ord::int from (select id_val, ord from unnest(reorder_stages.ordered_stage_ids) with ordinality as t(id_val, ord)) new_pos where s.id = new_pos.id_val and s.pipeline_id = reorder_stages.pipeline_id;
  update public.pipelines set last_edited_at = now() where id = reorder_stages.pipeline_id;
end;
$function$;


-- ─── reorder_tasks_in_stage ─────────────────────────────────────────────────

create or replace function public.reorder_tasks_in_stage(stage_id uuid, ordered_task_ids uuid[])
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  parent_pipeline uuid;
  expected_count int;
  matched_count int;
  total_count int;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select s.pipeline_id into parent_pipeline from public.stages s where s.id = reorder_tasks_in_stage.stage_id;
  if parent_pipeline is null then raise exception 'Stage not found' using errcode = '22023'; end if;
  if not public.can_edit_pipeline(parent_pipeline) then raise exception 'Permission denied' using errcode = '42501'; end if;
  expected_count := array_length(reorder_tasks_in_stage.ordered_task_ids, 1);
  if expected_count is null or expected_count = 0 then raise exception 'ordered_task_ids cannot be empty' using errcode = '22023'; end if;
  select count(distinct t.id) into matched_count from public.tasks t where t.stage_id = reorder_tasks_in_stage.stage_id and t.id = any(reorder_tasks_in_stage.ordered_task_ids);
  if matched_count != expected_count then raise exception 'ordered_task_ids contains tasks not in this stage OR duplicates (matched %, expected %)', matched_count, expected_count using errcode = '22023'; end if;
  select count(*) into total_count from public.tasks t where t.stage_id = reorder_tasks_in_stage.stage_id;
  if total_count != expected_count then raise exception 'ordered_task_ids must contain ALL tasks in the stage (got %, stage has %)', expected_count, total_count using errcode = '22023'; end if;
  update public.tasks t set position = new_pos.ord::int from (select id_val, ord from unnest(reorder_tasks_in_stage.ordered_task_ids) with ordinality as tt(id_val, ord)) new_pos where t.id = new_pos.id_val and t.stage_id = reorder_tasks_in_stage.stage_id;
  update public.pipelines set last_edited_at = now() where id = parent_pipeline;
end;
$function$;


-- ─── move_task ──────────────────────────────────────────────────────────────

create or replace function public.move_task(task_id uuid, target_stage_id uuid, target_position integer)
returns json language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  source_stage_id uuid;
  source_pipeline uuid;
  target_pipeline uuid;
  source_position int;
  task_count_target int;
  clamped_position int;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select t.stage_id, t.position into source_stage_id, source_position from public.tasks t where t.id = move_task.task_id;
  if source_stage_id is null then raise exception 'Task not found' using errcode = '22023'; end if;
  select s.pipeline_id into source_pipeline from public.stages s where s.id = source_stage_id;
  select s.pipeline_id into target_pipeline from public.stages s where s.id = move_task.target_stage_id;
  if target_pipeline is null then raise exception 'Target stage not found' using errcode = '22023'; end if;
  if source_pipeline != target_pipeline then raise exception 'Cannot move task across pipelines' using errcode = '22023'; end if;
  if not public.can_edit_pipeline(source_pipeline) then raise exception 'Permission denied' using errcode = '42501'; end if;
  if move_task.target_position < 1 then raise exception 'target_position must be >= 1' using errcode = '22023'; end if;
  select count(*) into task_count_target from public.tasks t where t.stage_id = move_task.target_stage_id;
  if source_stage_id = move_task.target_stage_id then
    clamped_position := least(move_task.target_position, task_count_target);
  else
    clamped_position := least(move_task.target_position, task_count_target + 1);
  end if;
  if source_stage_id = move_task.target_stage_id then
    if clamped_position > source_position then
      update public.tasks t set position = position - 1 where t.stage_id = source_stage_id and t.position > source_position and t.position <= clamped_position and t.id != move_task.task_id;
    elsif clamped_position < source_position then
      update public.tasks t set position = position + 1 where t.stage_id = source_stage_id and t.position >= clamped_position and t.position < source_position and t.id != move_task.task_id;
    end if;
    update public.tasks t set position = clamped_position where t.id = move_task.task_id;
  else
    update public.tasks t set position = position - 1 where t.stage_id = source_stage_id and t.position > source_position;
    update public.tasks t set position = position + 1 where t.stage_id = move_task.target_stage_id and t.position >= clamped_position;
    update public.tasks t set stage_id = move_task.target_stage_id, position = clamped_position where t.id = move_task.task_id;
  end if;
  update public.pipelines set last_edited_at = now() where id = source_pipeline;
  return json_build_object('id', move_task.task_id, 'stage_id', move_task.target_stage_id, 'position', clamped_position);
end;
$function$;


-- ─── Grants ─────────────────────────────────────────────────────────────────

revoke execute on function public.create_stage(uuid, text, uuid) from public;
grant  execute on function public.create_stage(uuid, text, uuid) to authenticated;

revoke execute on function public.reorder_stages(uuid, uuid[]) from public;
grant  execute on function public.reorder_stages(uuid, uuid[]) to authenticated;

revoke execute on function public.reorder_tasks_in_stage(uuid, uuid[]) from public;
grant  execute on function public.reorder_tasks_in_stage(uuid, uuid[]) to authenticated;

revoke execute on function public.move_task(uuid, uuid, integer) from public;
grant  execute on function public.move_task(uuid, uuid, integer) to authenticated;


-- ============================================================================
-- Verification (run manually after apply — already verified live in the
-- session that originally applied these RPCs; queries kept here for
-- regression checks and for future maintainers running the migration
-- against a fresh DB)
-- ============================================================================
-- 1. All four functions exist + security definer + correct args:
--   select p.proname, p.prosecdef,
--          pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public'
--     and p.proname in ('create_stage','reorder_stages',
--                       'reorder_tasks_in_stage','move_task');
--   Expected: 4 rows, all prosecdef=true.
--
-- 2. Grants correct (executable by authenticated, not public):
--   select n.nspname, p.proname,
--          array_agg(distinct r.rolname) filter (where has_function_privilege(r.oid, p.oid, 'execute')) as can_execute
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   join pg_roles r on r.rolname in ('authenticated','anon','public')
--   where n.nspname='public'
--     and p.proname in ('create_stage','reorder_stages',
--                       'reorder_tasks_in_stage','move_task')
--   group by 1,2;
--   Expected: 'authenticated' present, 'anon' / 'public' NOT present
--   in can_execute for each function.
--
-- 3. No unique constraint on (pipeline_id, position) for stages or tasks:
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid in ('public.stages'::regclass, 'public.tasks'::regclass)
--     and contype='u';
--   Expected: 0 rows. If this changes, see the comment at the top of this
--   file about DEFERRABLE constraint or two-pass shift rewrite.
--
-- 4. Functional smoke (workspace owner of a pipeline with ≥2 stages):
--   set local request.jwt.claims to '{"sub":"<UUID>","role":"authenticated"}';
--   -- append:
--   select public.create_stage('<pipeline-uuid>'::uuid, 'Smoke append');
--   -- insert-between:
--   select public.create_stage('<pipeline-uuid>'::uuid, 'Smoke between',
--                              '<existing-stage-uuid>'::uuid);
--   -- reorder (must include ALL stage ids):
--   select public.reorder_stages('<pipeline-uuid>'::uuid,
--                                array['<s2>','<s1>','<s3>']::uuid[]);
--   Expected: rows reflect the new positions; pipelines.last_edited_at bumped.
--
-- 5. Permission denied for non-editor:
--   (impersonate a pipeline 'member' role — has read access but not edit)
--   select public.create_stage('<pipeline-uuid>'::uuid, 'x');
--   Expected: ERROR 42501 'Permission denied'.
--
-- 6. Partial reorder_stages array rejected:
--   (pipeline has 3 stages; pass only 2 ids)
--   select public.reorder_stages('<pipeline-uuid>'::uuid,
--                                array['<s1>','<s2>']::uuid[]);
--   Expected: ERROR 22023 'ordered_stage_ids must contain ALL stages…'.
-- ============================================================================
