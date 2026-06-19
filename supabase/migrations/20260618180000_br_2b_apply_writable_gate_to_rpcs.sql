-- ============================================================================
-- BR-2b: apply is_workspace_writable gate to the 9 user-callable write RPCs
-- ============================================================================
-- Closes the SECURITY DEFINER bypass identified in the BR-0 audit: until
-- this slice, RPCs invoked via supabase.rpc() succeeded regardless of
-- workspace_billing.subscription_status. Honest users saw the BR-1 banner
-- urging upgrade; determined users (or anyone bypassing the API routes)
-- could create pipelines, tasks, stages, and messages indefinitely
-- post-trial via direct PostgREST.
--
-- Each RPC body now invokes public.is_workspace_writable(<workspace_id>)
-- right after auth check + workspace_id resolution, before existing
-- validation / permission gates / writes. The helper is the same one
-- shipped by BR-2a, mirroring billing-guard.ts's 5-gate evaluation.
--
-- ORDER PER RPC (spec-locked)
-- ──────────────────────────
--   1. Auth check (existing — preserved verbatim)
--   2. Workspace_id resolution (re-using existing lookups where present,
--      adding a minimal SELECT only when the body doesn't already
--      resolve workspace_id for other reasons)
--   3. BR-2b subscription gate (new):
--        if not public.is_workspace_writable(<id>) then
--          raise exception 'subscription_required'
--            using errcode = '42501';
--        end if;
--   4. Existing validation + write logic (preserved verbatim)
--
-- WHY GATE 3 LANDS BEFORE EXISTING PERMISSION CHECKS
-- ──────────────────────────────────────────────────
-- A workspace in 'past_due' / 'canceled' / etc. is in a "broken state"
-- that any user (owner, admin, member, client) experiences the same
-- way — billing is the workspace's problem, not the caller's. Raising
-- the billing error before the permission error gives clearer
-- diagnosis. The existing permission gates remain as defense in depth
-- AFTER the new gate.
--
-- For RPCs that ALREADY resolve workspace_id (save_pipeline_as_template
-- has v_workspace_id at line 121-124, send_channel_message has
-- resolved_workspace_id at line 126-127), the gate is inserted right
-- after the existing resolution — no duplicate SELECT.
--
-- For RPCs that resolve to an intermediate (parent_pipeline / source_-
-- pipeline), a one-line lookup is added: select workspace_id into
-- resolved_workspace_id from public.pipelines where id = <pipeline>.
--
-- For create_pipeline_with_channels, the workspace_id is already an
-- input arg — no lookup needed; the gate calls is_workspace_writable
-- on the arg directly.
--
-- BACKWARD COMPATIBLE
-- ───────────────────
-- Every function signature is byte-identical to its pre-BR-2b form.
-- Return shapes unchanged. Existing API routes that call assertSubscript-
-- ionWritable in TS continue working (defense in depth — both layers
-- fire for invite/member-add routes). Existing PostgREST callers see
-- the new 42501 raise on bad billing; everything else passes through.
--
-- IDEMPOTENT
-- ──────────
-- Every CREATE OR REPLACE FUNCTION can be re-applied — same body, same
-- signature, same grants preserved (CREATE OR REPLACE does not drop
-- grants). The 9 statements are independent and order-insensitive among
-- themselves; the ordering below mirrors the BR-0 RPC inventory.
--
-- DEPENDENCY: requires BR-2a's public.is_workspace_writable(uuid)
-- function to exist. Migrations apply in timestamp order so this is
-- structurally guaranteed (20260618170000 < 20260618180000), but
-- verify before applying via Dashboard.
--
-- ┌─ DOWN PLAN
-- │
-- │   CREATE OR REPLACE each of the 9 functions back to its pre-BR-2b
-- │   body. Copies live at the migrations referenced in each section
-- │   header below. The is_workspace_writable helper from BR-2a stays
-- │   in place — it has no other downstream dependencies after BR-2b
-- │   reverts (BR-3 will add some).
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1/9: create_pipeline_with_channels ────────────────────────────────────
-- Pre-BR-2b body: 20260609120000_create_pipeline_with_channels_template_id.sql:73-227
-- Workspace_id source: input arg `workspace_id` (no lookup needed)
-- Gate inserted: after auth check, before is_workspace_owner_or_admin
create or replace function public.create_pipeline_with_channels(
  workspace_id     uuid,
  pipeline_name    text,
  pipeline_emoji   text default '📋',
  pipeline_company text default null,
  template_id      uuid default null
)
returns json
language plpgsql security definer
set search_path = ''
as $$
declare
  actor            uuid := (select auth.uid());
  cleaned_name     text;
  cleaned_emoji    text;
  resolved_emoji   text;
  cleaned_company  text;
  new_pipeline_id  uuid;
  general_id       uuid;
  client_id        uuid;
  ts_record        record;
  new_stage_id     uuid;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- BR-2b: subscription gate. workspace_id is the input arg; no lookup
  -- required. Fires for canceled/past_due/incomplete/unpaid/paused
  -- workspaces (helper returns false). Personal workspaces also fall
  -- through here (no workspace_billing row → false) but the upstream
  -- WT-4 API gates already reject this RPC for personal workspaces
  -- before it's called from the app; the SQL gate is defense in depth.
  if not public.is_workspace_writable(create_pipeline_with_channels.workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

  if not public.is_workspace_owner_or_admin(workspace_id) then
    raise exception 'You must be a workspace owner or admin to create pipelines'
      using errcode = '42501';
  end if;

  cleaned_name := trim(coalesce(pipeline_name, ''));
  if cleaned_name = '' then
    raise exception 'Pipeline name cannot be empty' using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Pipeline name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  cleaned_emoji := nullif(trim(coalesce(pipeline_emoji, '')), '');
  resolved_emoji := coalesce(cleaned_emoji, '📋');

  cleaned_company := nullif(trim(coalesce(pipeline_company, '')), '');
  if cleaned_company is not null and length(cleaned_company) > 80 then
    raise exception 'Company name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  if template_id is not null then
    if not exists (
      select 1 from public.templates t
      where t.id = template_id
        and (
          t.workspace_id is null
          or t.workspace_id = create_pipeline_with_channels.workspace_id
        )
    ) then
      raise exception
        'Template not found or not accessible in this workspace'
        using errcode = '42501';
    end if;
  end if;

  insert into public.pipelines (workspace_id, name, emoji, company)
  values (workspace_id, cleaned_name, resolved_emoji, cleaned_company)
  returning id into new_pipeline_id;

  insert into public.pipeline_memberships (pipeline_id, user_id, role)
  values (new_pipeline_id, actor, 'owner');

  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'general', false, actor)
  returning id into general_id;

  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'client', true, actor)
  returning id into client_id;

  insert into public.channel_memberships (channel_id, user_id)
  values (general_id, actor), (client_id, actor);

  if template_id is not null then
    for ts_record in
      select ts.id, ts.position, ts.name, ts.description, ts.client_visible
      from public.template_stages ts
      where ts.template_id = create_pipeline_with_channels.template_id
      order by ts.position
    loop
      insert into public.stages (
        pipeline_id, position, name, description, client_visible
      )
      values (
        new_pipeline_id,
        ts_record.position,
        ts_record.name,
        ts_record.description,
        ts_record.client_visible
      )
      returning id into new_stage_id;

      insert into public.tasks (
        stage_id, position, title, description, client_visible
      )
      select new_stage_id, position, title, description, client_visible
      from public.template_tasks
      where template_stage_id = ts_record.id;
    end loop;
  end if;

  return json_build_object(
    'pipeline_id', new_pipeline_id,
    'name',        cleaned_name,
    'emoji',       resolved_emoji,
    'company',     cleaned_company,
    'template_id', template_id
  );
end;
$$;


-- ─── 2/9: create_task ──────────────────────────────────────────────────────
-- Pre-BR-2b body: 20260520140000_fix_create_task_ambiguous_stage_id.sql:23-88
-- Workspace_id source: tasks → stages.pipeline_id → pipelines.workspace_id
-- Gate inserted: after stage→pipeline lookup, before can_edit_pipeline
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
  resolved_workspace_id uuid;  -- BR-2b
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

  select pipeline_id into parent_pipeline
  from public.stages s where s.id = create_task.stage_id;
  if parent_pipeline is null then
    raise exception 'Stage not found' using errcode = '22023';
  end if;

  -- BR-2b: resolve workspace_id via the parent_pipeline already in hand,
  -- then gate. Fail-closed if pipeline somehow missing (shouldn't happen
  -- given the FK; defensive).
  select p.workspace_id into resolved_workspace_id
  from public.pipelines p where p.id = parent_pipeline;
  if resolved_workspace_id is null then
    raise exception 'Pipeline not found' using errcode = '22023';
  end if;
  if not public.is_workspace_writable(resolved_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

  if not public.can_edit_pipeline(parent_pipeline) then
    raise exception 'You don''t have permission to add tasks to this pipeline'
      using errcode = '42501';
  end if;

  resolved_assignee := coalesce(assignee_id, actor);

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


-- ─── 3/9: create_stage ─────────────────────────────────────────────────────
-- Pre-BR-2b body: 20260522120000_edit_pipeline_rpcs.sql:69-96
-- Workspace_id source: pipelines.workspace_id (via input pipeline_id)
-- Gate inserted: after auth check, before can_edit_pipeline
create or replace function public.create_stage(pipeline_id uuid, name text, after_stage_id uuid default null)
returns json language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  resolved_workspace_id uuid;  -- BR-2b
  cleaned_name text;
  new_position int;
  new_stage_id uuid;
  after_position int;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  -- BR-2b: resolve workspace_id from the input pipeline_id, then gate.
  select p.workspace_id into resolved_workspace_id
  from public.pipelines p where p.id = create_stage.pipeline_id;
  if resolved_workspace_id is null then
    raise exception 'Pipeline not found' using errcode = '22023';
  end if;
  if not public.is_workspace_writable(resolved_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

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


-- ─── 4/9: move_task ────────────────────────────────────────────────────────
-- Pre-BR-2b body: 20260522120000_edit_pipeline_rpcs.sql:154-196
-- Workspace_id source: tasks → stages.pipeline_id → pipelines.workspace_id
-- Gate inserted: after source_pipeline resolution, before can_edit_pipeline
-- Note: existing logic verifies source/target pipelines match — if a task
-- is moved within the same workspace, the gate fires once (sufficient).
create or replace function public.move_task(task_id uuid, target_stage_id uuid, target_position integer)
returns json language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  source_stage_id uuid;
  source_pipeline uuid;
  target_pipeline uuid;
  resolved_workspace_id uuid;  -- BR-2b
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

  -- BR-2b: resolve workspace_id from source_pipeline (= target_pipeline
  -- given the cross-pipeline check above), then gate.
  select p.workspace_id into resolved_workspace_id
  from public.pipelines p where p.id = source_pipeline;
  if resolved_workspace_id is null then
    raise exception 'Pipeline not found' using errcode = '22023';
  end if;
  if not public.is_workspace_writable(resolved_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

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


-- ─── 5/9: reorder_stages ───────────────────────────────────────────────────
-- Pre-BR-2b body: 20260522120000_edit_pipeline_rpcs.sql:101-121
-- Workspace_id source: pipelines.workspace_id (via input pipeline_id)
-- Gate inserted: after auth check, before can_edit_pipeline
create or replace function public.reorder_stages(pipeline_id uuid, ordered_stage_ids uuid[])
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  resolved_workspace_id uuid;  -- BR-2b
  expected_count int;
  matched_count int;
  total_count int;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  -- BR-2b: resolve workspace_id from the input pipeline_id, then gate.
  select p.workspace_id into resolved_workspace_id
  from public.pipelines p where p.id = reorder_stages.pipeline_id;
  if resolved_workspace_id is null then
    raise exception 'Pipeline not found' using errcode = '22023';
  end if;
  if not public.is_workspace_writable(resolved_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

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


-- ─── 6/9: reorder_tasks_in_stage ───────────────────────────────────────────
-- Pre-BR-2b body: 20260522120000_edit_pipeline_rpcs.sql:126-149
-- Workspace_id source: stages → pipelines.workspace_id (via input stage_id)
-- Gate inserted: after parent_pipeline resolution, before can_edit_pipeline
create or replace function public.reorder_tasks_in_stage(stage_id uuid, ordered_task_ids uuid[])
returns void language plpgsql security definer set search_path to ''
as $function$
declare
  actor uuid := (select auth.uid());
  parent_pipeline uuid;
  resolved_workspace_id uuid;  -- BR-2b
  expected_count int;
  matched_count int;
  total_count int;
begin
  if actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  select s.pipeline_id into parent_pipeline from public.stages s where s.id = reorder_tasks_in_stage.stage_id;
  if parent_pipeline is null then raise exception 'Stage not found' using errcode = '22023'; end if;

  -- BR-2b: resolve workspace_id from parent_pipeline, then gate.
  select p.workspace_id into resolved_workspace_id
  from public.pipelines p where p.id = parent_pipeline;
  if resolved_workspace_id is null then
    raise exception 'Pipeline not found' using errcode = '22023';
  end if;
  if not public.is_workspace_writable(resolved_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

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


-- ─── 7/9: save_pipeline_as_template ────────────────────────────────────────
-- Pre-BR-2b body: 20260608120000_save_pipeline_as_template_rpc.sql:74-190
-- Workspace_id source: pipelines.workspace_id — ALREADY RESOLVED at original
--   lines 121-124 into v_workspace_id. The original ordering placed the
--   lookup AFTER can_edit_pipeline and name validation; BR-2b reorders to
--   AUTH → workspace lookup → gate → existing permission/name/etc.
-- Gate inserted: after the existing workspace_id lookup, repositioned upward
create or replace function public.save_pipeline_as_template(
  source_pipeline_id   uuid,
  template_name        text,
  template_description text default null,
  template_emoji       text default null
)
returns json
language plpgsql security definer
set search_path = ''
as $$
declare
  actor              uuid := (select auth.uid());
  cleaned_name       text;
  cleaned_desc       text;
  cleaned_emoji      text;
  resolved_emoji     text;
  v_workspace_id     uuid;
  v_source_emoji     text;
  v_new_template_id  uuid;
  v_new_stage_id     uuid;
  s_record           record;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- BR-2b: workspace_id lookup hoisted to top (originally lines 121-124
  -- of source migration, after can_edit_pipeline + name validation).
  -- Reordered so the subscription gate fires before validation.
  select workspace_id, emoji
    into v_workspace_id, v_source_emoji
  from public.pipelines
  where id = source_pipeline_id;
  if v_workspace_id is null then
    raise exception 'Source pipeline not found' using errcode = '22023';
  end if;
  if not public.is_workspace_writable(v_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

  if not public.can_edit_pipeline(source_pipeline_id) then
    raise exception
      'You must be a workspace owner, pipeline owner, or pipeline admin to save a template from this pipeline'
      using errcode = '42501';
  end if;

  cleaned_name := trim(coalesce(template_name, ''));
  if cleaned_name = '' then
    raise exception 'Template name cannot be empty' using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Template name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  cleaned_emoji := nullif(trim(coalesce(template_emoji, '')), '');
  resolved_emoji := coalesce(cleaned_emoji, v_source_emoji, '📋');

  cleaned_desc := nullif(trim(coalesce(template_description, '')), '');

  insert into public.templates (
    workspace_id, name, description, emoji,
    source_pipeline_id, created_by
  )
  values (
    v_workspace_id,
    cleaned_name,
    cleaned_desc,
    resolved_emoji,
    source_pipeline_id,
    actor
  )
  returning id into v_new_template_id;

  for s_record in
    select id, position, name, description, client_visible
    from public.stages
    where pipeline_id = source_pipeline_id
    order by position
  loop
    insert into public.template_stages (
      template_id, position, name, description, client_visible
    )
    values (
      v_new_template_id,
      s_record.position,
      s_record.name,
      s_record.description,
      s_record.client_visible
    )
    returning id into v_new_stage_id;

    insert into public.template_tasks (
      template_stage_id, position, title, description, client_visible
    )
    select v_new_stage_id, position, title, description, client_visible
    from public.tasks
    where stage_id = s_record.id;
  end loop;

  return json_build_object(
    'template_id', v_new_template_id,
    'name', cleaned_name
  );
end;
$$;


-- ─── 8/9: delete_pipeline ──────────────────────────────────────────────────
-- Pre-BR-2b body: 20260610120000_delete_pipeline_rpc.sql:89-131
-- Workspace_id source: pipelines.workspace_id (via input pipeline_id)
-- Gate inserted: after auth check, before can_edit_pipeline
-- IMPORTANT: lookup BEFORE delete (per spec — pipeline row still exists)
create or replace function public.delete_pipeline(pipeline_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  resolved_workspace_id uuid;  -- BR-2b
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- BR-2b: resolve workspace_id BEFORE the delete (the lookup needs the
  -- pipeline row to still exist), then gate.
  select p.workspace_id into resolved_workspace_id
  from public.pipelines p where p.id = delete_pipeline.pipeline_id;
  if resolved_workspace_id is null then
    raise exception 'Pipeline not found' using errcode = '22023';
  end if;
  if not public.is_workspace_writable(resolved_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

  if not public.can_edit_pipeline(pipeline_id) then
    raise exception
      'You must be a workspace owner, pipeline owner, or pipeline admin to delete this pipeline'
      using errcode = '42501';
  end if;

  delete from public.pipelines
  where id = delete_pipeline.pipeline_id;
end;
$$;


-- ─── 9/9: send_channel_message ─────────────────────────────────────────────
-- Pre-BR-2b body: 20260613110000_notifications.sql:96-210
-- Workspace_id source: channels → pipelines.workspace_id — ALREADY RESOLVED
--   at original lines 126-130 into resolved_workspace_id. Gate fires right
--   after the channel-not-found check.
-- Gate inserted: after channel lookup, before channel-member authz
create or replace function public.send_channel_message(
  p_channel_id uuid,
  p_text text,
  p_is_internal boolean default false
)
returns public.channel_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  resolved_pipeline_id uuid;
  resolved_workspace_id uuid;
  trimmed text := btrim(coalesce(p_text, ''));
  tokens text[];
  tok text;
  resolved_mentions uuid[] := array[]::uuid[];
  candidate uuid;
  inserted public.channel_messages;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if length(trimmed) < 1 then
    raise exception 'Message body cannot be empty' using errcode = '22023';
  end if;

  select c.pipeline_id, p.workspace_id
    into resolved_pipeline_id, resolved_workspace_id
  from public.channels c
  join public.pipelines p on p.id = c.pipeline_id
  where c.id = p_channel_id;

  if resolved_pipeline_id is null then
    raise exception 'Channel not found' using errcode = '22023';
  end if;

  -- BR-2b: subscription gate. resolved_workspace_id already in hand from
  -- the channel→pipeline→workspace join above.
  if not public.is_workspace_writable(resolved_workspace_id) then
    raise exception 'subscription_required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.channel_memberships
    where channel_id = p_channel_id and user_id = actor
  ) then
    raise exception 'Not authorized to send messages in this channel'
      using errcode = '42501';
  end if;

  if p_is_internal and public.is_pipeline_client(resolved_pipeline_id) then
    raise exception 'Clients cannot post internal messages'
      using errcode = '42501';
  end if;

  select array_agg(distinct lower(m[1]))
    into tokens
  from regexp_matches(trimmed, '@(\S+)', 'g') m
  where m[1] is not null and length(m[1]) > 0;

  if tokens is not null then
    foreach tok in array tokens loop
      candidate := null;

      select pr.id into candidate
      from public.profiles pr
      where pr.id in (
        select wm.user_id
        from public.workspace_memberships wm
        where wm.workspace_id = resolved_workspace_id
        union
        select pm.user_id
        from public.pipeline_memberships pm
        where pm.pipeline_id = resolved_pipeline_id
      )
        and (
          lower(split_part(coalesce(pr.email, ''), '@', 1)) = tok
          or lower(regexp_replace(coalesce(pr.display_name, ''), '\s+', '', 'g')) = tok
        )
      limit 1;

      if candidate is not null
         and not (candidate = any(resolved_mentions)) then
        resolved_mentions := resolved_mentions || candidate;
      end if;
    end loop;
  end if;

  insert into public.channel_messages (
    channel_id, author_id, text, is_internal, mentions
  )
  values (
    p_channel_id, actor, trimmed, p_is_internal, resolved_mentions
  )
  returning * into inserted;

  return inserted;
end;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) All 9 functions now contain both the helper call AND the 'subscription
--     _required' raise text. Either flips to false → that function's body
--     wasn't updated; surface and reapply that section.
--   select
--     proname,
--     position('is_workspace_writable' in pg_get_functiondef(oid)) > 0 as has_gate,
--     position('subscription_required' in pg_get_functiondef(oid)) > 0 as raises_subscription_required
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in (
--       'create_pipeline_with_channels',
--       'create_task',
--       'create_stage',
--       'move_task',
--       'reorder_stages',
--       'reorder_tasks_in_stage',
--       'save_pipeline_as_template',
--       'delete_pipeline',
--       'send_channel_message'
--     )
--   order by proname;
--   -- Expected: 9 rows (or 10 for create_pipeline_with_channels if both
--   -- the 4-arg and 5-arg overloads are present), all has_gate = true,
--   -- all raises_subscription_required = true. The 4-arg overload of
--   -- create_pipeline_with_channels is NOT updated by this migration —
--   -- only the 5-arg version is. If only one row appears for that
--   -- proname, it's the 5-arg version. The 4-arg overload should be
--   -- considered deprecated; future callers use the 5-arg one.
--
-- (b) Helper grant survives the CREATE OR REPLACE rounds (it would, but
--     defensive).
--   select has_function_privilege('authenticated',
--          'public.is_workspace_writable(uuid)',
--          'EXECUTE') as can_call;
--   -- Expected: true.
--
-- (c) Signatures unchanged. Re-applying BR-2b should leave the args
--     byte-identical to their pre-BR-2b forms.
--   select proname, pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in (
--       'create_pipeline_with_channels',
--       'create_task', 'create_stage', 'move_task',
--       'reorder_stages', 'reorder_tasks_in_stage',
--       'save_pipeline_as_template', 'delete_pipeline',
--       'send_channel_message'
--     )
--   order by proname, args;
--   -- Spot-check that nothing changed shape.
--
-- (d) Smoke against Jordan's grandfathered workspace. Pick a pipeline_id
--     in salesedge and call create_stage (cheapest write RPC); should
--     succeed without raising.
--     select public.create_stage('<pipeline-uuid-in-salesedge>'::uuid, 'BR-2b smoke');
--   -- Expected: returns the new stage's id. CLEANUP: delete the stage.
--
-- (e) Negative smoke. Temporarily flip test-workspace-4b to past_due, try
--     the same call against a test-workspace-4b pipeline, expect 42501
--     with message 'subscription_required'. Then restore to active.
--     See the smoke tests Jordan runs after apply.
-- ============================================================================
