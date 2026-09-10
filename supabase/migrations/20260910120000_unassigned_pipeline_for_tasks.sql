-- Lets a task be created from the global Task tab without picking a real
-- project — per Jordan: "a project should not show if i don't pick a
-- project, however it should still show under the task view." Task Name
-- is the only real requirement in CreateTaskModal; everything else,
-- including project, is optional.
--
-- tasks.stage_id is NOT NULL (every task belongs to a stage, which belongs
-- to a pipeline) — there's no way around that at the schema level. So a
-- projectless task still needs a real stage_id under the hood; it's just
-- targeted at a hidden, auto-created-on-first-use pipeline per workspace
-- that never appears in any pipeline listing (sidebar Projects, dashboard,
-- header search, the Create Task project picker, admin metrics, etc.).
--
-- is_system marks that hidden pipeline so every "list this workspace's
-- pipelines" query can exclude it with `.eq("is_system", false)`. The
-- partial unique index guarantees at most one per workspace even under
-- concurrent get_or_create calls (the function below tolerates the resulting
-- unique-violation race by re-selecting).

alter table public.pipelines
  add column is_system boolean not null default false;

create unique index pipelines_one_system_per_workspace
  on public.pipelines(workspace_id)
  where is_system;

comment on column public.pipelines.is_system is
  'True only for the auto-created, hidden "Unassigned" pipeline that holds tasks created without picking a project. Never shown in any pipeline listing — filter it out of every workspace-wide pipelines query.';

-- Finds (or lazily creates) the hidden pipeline + its one stage for a
-- workspace. Returns BOTH ids (not just stage_id) — the app still needs
-- the real pipeline_id after creating a projectless task, for things that
-- work off pipeline_id directly regardless of display (task attachments'
-- storage path, RLS checks) even though the pipeline itself is never
-- shown as a "project" anywhere. SECURITY DEFINER so the insert bypasses
-- pipelines_insert / stages_insert (which require owner/admin authorship
-- context this hidden row doesn't have) — same pattern as create_task and
-- create_workspace_with_owner.
create or replace function public.get_or_create_unassigned_pipeline(p_workspace_id uuid)
returns table (pipeline_id uuid, stage_id uuid)
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  v_pipeline_id uuid;
  v_stage_id uuid;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  select id into v_pipeline_id
  from public.pipelines
  where workspace_id = p_workspace_id and is_system = true
  limit 1;

  if v_pipeline_id is null then
    begin
      insert into public.pipelines (workspace_id, name, is_system)
      values (p_workspace_id, 'Unassigned', true)
      returning id into v_pipeline_id;
    exception when unique_violation then
      -- Concurrent call already created it — fall through to re-select.
      v_pipeline_id := null;
    end;

    if v_pipeline_id is null then
      select id into v_pipeline_id
      from public.pipelines
      where workspace_id = p_workspace_id and is_system = true
      limit 1;
    end if;
  end if;

  select id into v_stage_id
  from public.stages
  where stages.pipeline_id = v_pipeline_id
  order by position asc
  limit 1;

  if v_stage_id is null then
    insert into public.stages (pipeline_id, position, name)
    values (v_pipeline_id, 0, 'Unassigned')
    returning id into v_stage_id;
  end if;

  return query select v_pipeline_id, v_stage_id;
end;
$$;

grant execute on function public.get_or_create_unassigned_pipeline(uuid) to authenticated;

-- ============================================================================
-- Widen is_pipeline_agency_member / can_edit_pipeline for is_system pipelines
-- ============================================================================
-- Every existing branch of these two functions requires either the
-- workspace OWNER role or an explicit pipeline_memberships row scoped to
-- the ONE pipeline in question. The hidden is_system pipeline never gets
-- pipeline_memberships rows (nobody is ever "added" to it — that's the
-- point), so without this widening, a non-owner workspace member (a plain
-- 'member' or an 'admin' with no explicit row on this specific pipeline)
-- could not even see, create, or edit their own projectless tasks — a
-- silent, confusing failure for exactly the persona this feature is for.
--
-- The added branch says: any workspace member can see/edit content on the
-- workspace's own hidden pipeline. This is intentional and safe — is_system
-- is a UI-visibility concern (never listed as a "project"), not a data
-- sensitivity boundary; workspace members can already see everything else
-- in their own workspace.
create or replace function public.is_pipeline_agency_member(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role = 'owner'
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'admin', 'member')
        )
        or (
          p.is_system
          and public.is_workspace_member(p.workspace_id)
        )
      )
  );
$$;

create or replace function public.can_edit_pipeline(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role = 'owner'
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'admin')
        )
        or (
          p.is_system
          and public.is_workspace_member(p.workspace_id)
        )
      )
  );
$$;
