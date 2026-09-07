-- ============================================================================
-- Task detail panel: banner block
-- ============================================================================
-- Backs the "+" content menu in the global Task tab's task detail panel
-- (Figma V2 slash-menu reference — scoped down to just what was asked for:
-- Banner / Upload file / Add link, not the full ClickUp-specific menu the
-- reference screenshot showed). Banner is a solid-color block with an
-- editable header line, rendered above the rich-text body — deliberately
-- NOT an image (per Jordan: "the banner should just be a solid background
-- color where you can insert a header"), so no storage/upload plumbing
-- needed for it.
-- ============================================================================

alter table public.tasks
  add column banner jsonb;

comment on column public.tasks.banner is
  'Optional banner block shown above the task body: {color: hex string, text: string}. Null when no banner has been added. Solid color only, no image — see migration header.';

-- enforce_client_task_update_scope's column blacklist needs `banner` added,
-- same reasoning as the priority/status/body additions in prior migrations.
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
       or new.body        is distinct from old.body
       or new.banner      is distinct from old.banner then
      raise exception 'Clients can only toggle the done flag on tasks.';
    end if;
  end if;
  return new;
end;
$$;
