-- ============================================================================
-- Task view: priority, status, and multi-assignee support
-- ============================================================================
-- Backs the new global Task tab (Figma V2, /w/[slug]/tasks): a cross-project
-- task list grouped into Overdue / In progress / Not started, with a
-- Priority column and multiple assignee avatars per row.
--
-- Three additive pieces, none of which touch the existing single-assignee
-- flows (My Tasks card, notifications, the member-task-update-scope RLS) —
-- those all keep reading `tasks.assignee_id` exactly as before.
--
--   1. tasks.priority   — nullable, agency-set-only. Not every task needs one.
--   2. tasks.status     — not_started | in_progress, default not_started.
--      Deliberately does NOT include a 'done' value — tasks.done stays the
--      single source of truth for completion everywhere else in the app;
--      status only distinguishes "not started" from "in progress" among
--      tasks that aren't done yet. "Overdue" isn't a status value at all —
--      it's computed client-side from (not done) AND (deadline < today),
--      and takes visual precedence over status in the Task view's grouping.
--   3. task_assignees   — join table, ADDITIVE alongside assignee_id (not a
--      replacement). Backfilled from existing assignee_id values so already-
--      assigned tasks show that person in the new multi-assignee UI too.
-- ============================================================================

create type public.task_priority as enum ('urgent', 'high', 'normal', 'low');
create type public.task_status as enum ('not_started', 'in_progress');

alter table public.tasks
  add column priority public.task_priority,
  add column status public.task_status not null default 'not_started';

comment on column public.tasks.priority is
  'Agency-set-only, nullable. Shown as a colored flag in the Task view; not part of the client-visible surface.';
comment on column public.tasks.status is
  'not_started | in_progress — only meaningful while done=false. Does NOT replace tasks.done as the completion source of truth.';

-- enforce_client_task_update_scope is a blacklist of columns clients may not
-- change (they can only toggle `done`); new columns aren't automatically
-- covered, so without this a client could slip a priority/status change
-- through. Re-declaring the whole function since CREATE OR REPLACE can't
-- patch just the body's condition list.
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
       or new.status      is distinct from old.status then
      raise exception 'Clients can only toggle the done flag on tasks.';
    end if;
  end if;
  return new;
end;
$$;


-- ── task_assignees ──────────────────────────────────────────────────────────

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

create index task_assignees_user_idx on public.task_assignees(user_id);

comment on table public.task_assignees is
  'Multi-assignee support for the Task view. Additive alongside tasks.assignee_id — that column stays the single-assignee source of truth for My Tasks / notifications; this table is read only by the new cross-project Task tab.';

-- Backfill: carry every existing single-assignee value over so already-
-- assigned tasks show that person here too. The `exists` guard skips any
-- assignee_id that's gone stale/orphaned (found live: a task pointing at a
-- user no longer in auth.users) — assignee_id's own FK is ON DELETE SET
-- NULL, so this shouldn't happen going forward, but old data apparently
-- predates that guarantee. Skipping it here is strictly safe: it just
-- means that one task won't show an assignee in the new view, matching
-- what's already true of it (an assignee that doesn't exist isn't really
-- assigned to anyone functional).
insert into public.task_assignees (task_id, user_id)
select t.id, t.assignee_id
from public.tasks t
where t.assignee_id is not null
  and exists (select 1 from auth.users u where u.id = t.assignee_id)
on conflict do nothing;

alter table public.task_assignees enable row level security;

-- Agency-only surface (mirrors tasks_select's agency branch — assignees
-- aren't in the documented client-visible field list, so clients get no
-- rows here at all, not even for client_visible tasks).
create policy task_assignees_select on public.task_assignees
for select using (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    where t.id = task_assignees.task_id
      and public.is_pipeline_agency_member(s.pipeline_id)
  )
);

create policy task_assignees_insert on public.task_assignees
for insert with check (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    join public.pipelines p on p.id = s.pipeline_id
    where t.id = task_assignees.task_id
      and public.can_edit_pipeline(s.pipeline_id)
      and public.is_workspace_writable(p.workspace_id)
  )
);

create policy task_assignees_delete on public.task_assignees
for delete using (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    join public.pipelines p on p.id = s.pipeline_id
    where t.id = task_assignees.task_id
      and public.can_edit_pipeline(s.pipeline_id)
      and public.is_workspace_writable(p.workspace_id)
  )
);


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. select count(*) from task_assignees; should be >= count of tasks with
--    assignee_id is not null (backfill worked).
-- 2. As a client on a client_visible task: try updating priority/status —
--    expect the "Clients can only toggle the done flag" exception.
-- 3. As a client: select * from task_assignees — expect 0 rows regardless
--    of task visibility.
-- 4. As an agency editor: insert/delete a task_assignees row for a task in
--    their own workspace — succeeds. Cross-workspace attempt — 0 rows
--    affected / RLS violation.
-- ============================================================================
