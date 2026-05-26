-- ============================================================================
-- Phase 4c slice 3: save_pipeline_as_template RPC
-- ============================================================================
-- RPC that copies an existing pipeline's stages + tasks into the
-- templates / template_stages / template_tasks tables (slice 1 schema)
-- so an agency can save a working pipeline as a reusable template for
-- their workspace.
--
-- ── PERMISSION GATE ─────────────────────────────────────────────────
--
-- can_edit_pipeline(source_pipeline_id) — workspace OWNER OR pipeline
-- owner/admin. Matches every other edit-pipeline gate (create_pipeline_
-- with_channels, canvas UPDATE policies, etc.). Workspace ADMINS without
-- an explicit pipeline_memberships row are intentionally NOT covered;
-- this is consistent with how can_edit_pipeline behaves throughout the
-- codebase. If a broader gate is ever wanted, the change should be to
-- can_edit_pipeline itself (so all edit surfaces benefit), not a one-off
-- divergence here.
--
-- ── LOCKED CONSTRAINT (enforced by what's NOT copied) ───────────────
--
-- stages.color is NEVER copied. template_stages has no color column.
-- Instantiated pipelines (slice 4) start all-grey via the state-color
-- computation in src/lib/current-stage.ts (LOCKED file, never modify).
--
-- ── ATOMICITY ───────────────────────────────────────────────────────
--
-- Single PL/pgSQL function = single transaction. Any failure mid-copy
-- (e.g. mid-loop on stage N+1) rolls back the template + all already-
-- inserted stages + tasks. No orphan rows possible.
--
-- ── STAGE LOOP RATIONALE ────────────────────────────────────────────
--
-- The RPC loops over source stages one at a time rather than doing two
-- batch INSERTs joined by position. Reason: public.stages
-- (pipeline_id, position) is an INDEX, not a UNIQUE constraint —
-- duplicate positions are theoretically possible in source data (data
-- bug, but defensive). The loop maps source-stage → new-template-stage
-- one-to-one via the captured id, avoiding positional inference.
--
-- Performance: N+1 statements where N = source stage count. Typical
-- agency pipeline has ≤ ~12 stages; well under any meaningful budget.
--
-- ── COLUMNS COPIED vs STRIPPED ──────────────────────────────────────
--
-- Source stages → template_stages:
--   COPIED:   position, name, description, client_visible
--   STRIPPED: color (locked), deadline (live), completed (live),
--             completed_at (live), pipeline_id (→ template_id)
--
-- Source tasks → template_tasks:
--   COPIED:   position, title, description, client_visible
--   STRIPPED: stage_id (→ template_stage_id), done (live), deadline
--             (live), note (legacy column, slice 1 schema omits it),
--             pos_x (live canvas placement), pos_y (live), assignee_id
--             (live), completed_at (live), completed_by (live),
--             created_at (DB default sets on new template_tasks rows)
--
-- ┌─ DOWN PLAN
-- │
-- │   revoke execute on function
-- │     public.save_pipeline_as_template(uuid, text, text, text)
-- │     from authenticated;
-- │   drop function if exists
-- │     public.save_pipeline_as_template(uuid, text, text, text);
-- │
-- │   -- Existing templates created via this RPC remain in place
-- │   -- (they're indistinguishable from any other workspace-saved
-- │   -- templates post-revert). No data cleanup needed.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================

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
  -- 1. Auth gate
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- 2. Permission: workspace owner OR pipeline owner/admin. Workspace
  -- admins without a pipeline_memberships row are NOT covered.
  if not public.can_edit_pipeline(source_pipeline_id) then
    raise exception
      'You must be a workspace owner, pipeline owner, or pipeline admin to save a template from this pipeline'
      using errcode = '42501';
  end if;

  -- 3. Validate template name
  cleaned_name := trim(coalesce(template_name, ''));
  if cleaned_name = '' then
    raise exception 'Template name cannot be empty' using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Template name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  -- 4. Source pipeline lookup — workspace_id (for the templates row) +
  -- emoji (for the emoji default).
  select workspace_id, emoji
    into v_workspace_id, v_source_emoji
  from public.pipelines
  where id = source_pipeline_id;

  if v_workspace_id is null then
    raise exception 'Source pipeline not found' using errcode = '22023';
  end if;

  -- 5. Resolve template emoji: caller-supplied (trimmed, non-empty),
  -- else the source pipeline's emoji, else the system default '📋'.
  cleaned_emoji := nullif(trim(coalesce(template_emoji, '')), '');
  resolved_emoji := coalesce(cleaned_emoji, v_source_emoji, '📋');

  -- Description optional; whitespace-only collapses to NULL.
  cleaned_desc := nullif(trim(coalesce(template_description, '')), '');

  -- 6. Insert templates row
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

  -- 7. Loop over source stages (in position order). For each:
  --   a. insert ONE template_stages row, capture its new id
  --   b. insert all of that stage's tasks → template_tasks, keyed by
  --      the captured new template_stage_id
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

  -- 8. Return the new template's id + name. UI uses these for the
  -- success confirmation; slice 4 picker re-fetches the rest.
  return json_build_object(
    'template_id', v_new_template_id,
    'name', cleaned_name
  );
end;
$$;


-- ─── Grants ────────────────────────────────────────────────────────────────
revoke execute on function
  public.save_pipeline_as_template(uuid, text, text, text)
  from public;

grant execute on function
  public.save_pipeline_as_template(uuid, text, text, text)
  to authenticated;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
-- (a) Function exists with right signature + security context
--   select proname, prosecdef, provolatile,
--          pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'save_pipeline_as_template';
--   -- Expected: 1 row. prosecdef = true. provolatile = 'v'.
--   -- args = 'source_pipeline_id uuid, template_name text,
--   --         template_description text, template_emoji text'.
--
-- (b) Grant exists for authenticated role
--   select has_function_privilege('authenticated',
--          'public.save_pipeline_as_template(uuid, text, text, text)',
--          'EXECUTE') as can_call;
--   -- Expected: true.
-- ============================================================================
