-- ============================================================================
-- Task detail panel: rich-text body content
-- ============================================================================
-- Backs the global Task tab's task detail side panel (Figma V2): a
-- Notion-style page body below the title/description/property row, reusing
-- the same DocEditor block engine + DocContent shape ({blocks:[...]}) that
-- documents.content already uses (20260904120000_sidebar_folders_and_documents.sql).
-- Same '{}'::jsonb default; DocEditor treats an empty/missing blocks array
-- as a single empty paragraph.
-- ============================================================================

alter table public.tasks
  add column body jsonb not null default '{}'::jsonb;

comment on column public.tasks.body is
  'Rich-text task body (DocContent shape: {blocks:[...]}), rendered/edited via DocEditor in the task detail panel. Distinct from the short plain-text tasks.description field.';

-- enforce_client_task_update_scope's column blacklist needs `body` added,
-- same reasoning as the priority/status addition in
-- 20260906120000_task_priority_status_assignees.sql — new columns aren't
-- automatically covered by the existing blacklist, so without this a
-- client could slip a body edit through even though the Task tab (the only
-- surface that writes this column) is a workspace-member-only route.
create or replace function public.enforce_client_task_update_scope()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  parent_pipeline_id uuid;
begin
  select pipeline_id into parent_pipeline_id
  from public.stages where id = new.stage_id;

  if public.is_pipeline_client(parent_pipeline_id) then
    if new.title          is distinct from old.title
       or new.deadline    is distinct from old.deadline
       or new.note        is distinct from old.note
       or new.pos_x       is distinct from old.pos_x
       or new.pos_y       is distinct from old.pos_y
       or new.client_visible is distinct from old.client_visible
       or new.position    is distinct from old.position
       or new.stage_id    is distinct from old.stage_id
       or new.assignee_id is distinct from old.assignee_id
       or new.description is distinct from old.description
       or new.priority    is distinct from old.priority
       or new.status      is distinct from old.status
       or new.body        is distinct from old.body then
      raise exception 'Clients can only toggle the done flag on tasks.';
    end if;
  end if;
  return new;
end;
$$;
