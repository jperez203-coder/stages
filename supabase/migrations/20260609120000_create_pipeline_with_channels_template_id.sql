-- ============================================================================
-- Phase 4c slice 4: extend create_pipeline_with_channels with template_id
-- ============================================================================
-- Adds an optional 5-argument overload of create_pipeline_with_channels
-- so the new two-step picker UI can instantiate pipelines from a
-- template. The existing 4-argument signature
-- (workspace_id, pipeline_name, pipeline_emoji, pipeline_company) from
-- 20260520120000 is INTENTIONALLY left in place — see "Why both
-- overloads" below.
--
-- ── BEHAVIOR ────────────────────────────────────────────────────────
--
-- When template_id is NULL (or callers use the 4-arg overload):
--   * Body is byte-for-byte identical to migration 20260520120000.
--   * Zero stages, zero tasks. Empty pipeline. (Today's behavior.)
--
-- When template_id is non-null:
--   1. Defense-in-depth visibility check: template must be a built-in
--      (workspace_id IS NULL) OR owned by the same workspace as the
--      new pipeline. Forged cross-workspace template_ids → 42501.
--      The RPC is security definer (BYPASSRLS), so RLS doesn't
--      naturally enforce visibility on the template_id argument.
--      This explicit check is the security floor — a direct
--      PostgREST call passing a different workspace's template_id
--      gets rejected here.
--   2. Loop over template_stages by position. For each: insert one
--      stages row + all that stage's template_tasks → tasks.
--   3. NO stages.color is written. template_stages has no color
--      column to copy from. New stages get NULL color, and
--      src/lib/current-stage.ts renders all-grey because every new
--      stage starts with completed=false (locked state-color model;
--      see PLANNED entry in PROGRESS.md and current-stage.ts header).
--   4. NO live task state is copied — done/deadline/pos_x/pos_y/
--      assignee_id/completed_at/completed_by/note all default. Only
--      structural columns (position, title, description,
--      client_visible) are mirrored.
--
-- Single transaction (PL/pgSQL function = one txn). Any failure rolls
-- back the pipeline + channels + memberships + every partially-
-- inserted stage/task. No orphans possible.
--
-- ── WHY BOTH OVERLOADS (decision 2026-05-26) ────────────────────────
--
-- The 4-arg version stays in place. Reasons:
--   * Existing app code (today's create-pipeline form pre-slice-4)
--     calls the 4-arg signature. Removing it would 404 the core
--     create-pipeline flow until the UI updates land in lockstep.
--   * Cached PostgREST query plans on the Supabase edge would 404
--     against signatures they remember as 4-arg until the next plan
--     refresh.
--   * The 4-arg overload is harmless dead code once all callers move
--     to the 5-arg version; removable in a follow-up migration after
--     confirmation that nothing references it.
--
-- PostgreSQL treats different argument counts as separate functions.
-- Adding the 5-arg overload doesn't touch the 4-arg row in pg_proc;
-- both coexist. The picker UI explicitly calls the 5-arg version by
-- passing template_id (NULL or a uuid).
--
-- ┌─ DOWN PLAN
-- │
-- │   revoke execute on function
-- │     public.create_pipeline_with_channels(uuid, text, text, text, uuid)
-- │     from authenticated;
-- │   drop function if exists
-- │     public.create_pipeline_with_channels(uuid, text, text, text, uuid);
-- │
-- │   -- 4-arg version stays untouched.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================

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

  -- ── Defense-in-depth template visibility check ───────────────────────
  -- See header for rationale. Built-in (workspace_id IS NULL) OR owned
  -- by the same workspace as the new pipeline. Anything else → 42501.
  --
  -- The right-hand side `create_pipeline_with_channels.workspace_id`
  -- is explicitly function-qualified because PL/pgSQL's
  -- `variable_conflict = error` default would otherwise raise on the
  -- bare `workspace_id` here — it can't disambiguate between the
  -- `templates.workspace_id` column (in scope via the FROM) and the
  -- function parameter of the same name. Same pattern as the
  -- template_id qualification in the LOOP below.
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

  -- 1. Pipeline row.
  insert into public.pipelines (workspace_id, name, emoji, company)
  values (workspace_id, cleaned_name, resolved_emoji, cleaned_company)
  returning id into new_pipeline_id;

  -- 2. Creator's pipeline_memberships row.
  insert into public.pipeline_memberships (pipeline_id, user_id, role)
  values (new_pipeline_id, actor, 'owner');

  -- 3. Internal #general channel.
  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'general', false, actor)
  returning id into general_id;

  -- 4. Client channel.
  insert into public.channels (pipeline_id, name, is_client, created_by)
  values (new_pipeline_id, 'client', true, actor)
  returning id into client_id;

  -- 5. Creator joins both channels.
  insert into public.channel_memberships (channel_id, user_id)
  values (general_id, actor), (client_id, actor);

  -- ── 6. NEW: template instantiation ───────────────────────────────────
  -- Loop over template_stages by position. For each, insert one stages
  -- row + all that stage's template_tasks → tasks. Same loop pattern as
  -- save_pipeline_as_template (20260608120000) — positional inference
  -- would break on duplicate positions; capturing the new stage_id
  -- per-row is safe regardless.
  --
  -- LOCKED CONSTRAINT: no color is written to stages here.
  -- template_stages has no color column to copy from; new stages start
  -- with NULL color, and current-stage.ts renders them grey because
  -- completed=false. The decorative pill colors in the picker UI are
  -- render-time only and not persisted.
  if template_id is not null then
    -- Alias `template_stages` as `ts` so the WHERE's LEFT side can be
    -- explicitly column-qualified (`ts.template_id`). Without the alias,
    -- a bare `template_id` on the LEFT is ambiguous between the column
    -- and the function parameter under PL/pgSQL's default
    -- `variable_conflict = error`. Same posture as the
    -- `create_pipeline_with_channels.workspace_id` qualification in the
    -- visibility check above.
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


-- ─── Grants (new 5-arg signature; 4-arg grants untouched) ─────────────────
revoke execute on function
  public.create_pipeline_with_channels(uuid, text, text, text, uuid)
  from public;

grant execute on function
  public.create_pipeline_with_channels(uuid, text, text, text, uuid)
  to authenticated;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
-- (a) Both overloads exist (4-arg + 5-arg)
--   select proname,
--          pg_get_function_identity_arguments(oid) as args,
--          prosecdef
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'create_pipeline_with_channels';
--   -- Expected: 2 rows. One with 4 args, one with 5 args. Both
--   -- prosecdef = true.
--
-- (b) Grant on the 5-arg version
--   select has_function_privilege('authenticated',
--          'public.create_pipeline_with_channels(uuid, text, text, text, uuid)',
--          'EXECUTE') as can_call;
--   -- Expected: true.
--
-- (c) Backward-compat sanity: 4-arg grant still in place
--   select has_function_privilege('authenticated',
--          'public.create_pipeline_with_channels(uuid, text, text, text)',
--          'EXECUTE') as can_call;
--   -- Expected: true. (Untouched by this migration.)
-- ============================================================================
