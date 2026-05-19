-- ============================================================================
-- Phase 4a — data model preparation
-- ============================================================================
-- Direction (locked):
--   * keep client_visible boolean (no audience enum migration; deferred to v1.1)
--   * minimum schema delta to support pipeline canvas, task detail panel,
--     my-tasks view, deadlines, checklists
--
-- This migration:
--   1. profiles.last_active_pipeline_id (new column)
--   2. tasks gets assignee_id, completed_at, completed_by, description
--   3. tasks.text renamed to tasks.title (consistency with checklist_items)
--   4. enforce_client_task_update_scope rewritten — uses new column name
--      `title`, adds assignee_id + description to the forbidden list
--   5. set_task_completion_metadata BEFORE UPDATE trigger on tasks — app
--      writes `done`; system writes completed_at + completed_by
--   6. checklist_items net-new table + 1 index + 4 RLS policies + 3 triggers
--      (inherit-visibility, enforce-client-scope, completion-metadata)
--   7. team_invites dropped (superseded by workspace_invites; no code refs)
--
-- Audit before apply (results pasted in chat 2026-05-19):
--   * zero custom enums in public schema (no speculative audience enum)
--   * zero CHECK constraints on tasks/profiles/pipelines
--   * exactly two triggers on tasks; zero on checklist_items
--   * zero views in public schema
--   * only one PG function references new.text/old.text:
--     enforce_client_task_update_scope, which is rewritten in section 4
--
-- Down plan: bottom of file.
-- ============================================================================


-- ─── 1. profiles.last_active_pipeline_id ────────────────────────────────────
-- UI hint for the "open last pipeline I worked on" landing path. ON DELETE
-- SET NULL so deleting a pipeline doesn't leave dangling FKs on profiles.
alter table public.profiles
  add column if not exists last_active_pipeline_id uuid
    references public.pipelines(id) on delete set null;


-- ─── 2. tasks new columns ──────────────────────────────────────────────────
-- assignee_id, completed_by FK auth.users(id) to match schema convention
-- (stage_notes.author_id, channel_messages.author_id, etc.). app-side joins
-- to profiles still work since profiles.id = auth.users.id 1:1.
alter table public.tasks
  add column if not exists assignee_id  uuid references auth.users(id) on delete set null,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references auth.users(id) on delete set null,
  add column if not exists description  text;


-- ─── 3. Rename tasks.text → tasks.title ────────────────────────────────────
-- Naming consistency with checklist_items.title. zero production data lives
-- in this column (legacy app stores tasks in localStorage only). No
-- supabase.from('tasks') anywhere in src/, so no Phase 3.4 code breaks.
-- The only PG reference is in enforce_client_task_update_scope, rewritten
-- in the next section to use the new column name.
alter table public.tasks rename column text to title;


-- ─── 4. Rewrite enforce_client_task_update_scope ───────────────────────────
-- Two changes vs the existing function:
--   (a) `new.text` / `old.text` becomes `new.title` / `old.title` (rename)
--   (b) adds `assignee_id` + `description` to the forbidden-for-clients list
--
-- completed_at + completed_by are NOT forbidden here — they're set by
-- set_task_completion_metadata (section 5) which fires AFTER this trigger
-- (alphabetical order: 'enforce' < 'set'). When a client sends `done = true`,
-- this trigger sees no change in completed_at/by (they're still NULL = NULL),
-- passes, then set_task_completion_metadata fills the values.
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
       or new.description is distinct from old.description then
      raise exception 'Clients can only toggle the done flag on tasks.';
    end if;
  end if;
  return new;
end;
$$;


-- ─── 5. set_task_completion_metadata trigger ───────────────────────────────
-- App code writes `done = true/false`. System writes completed_at +
-- completed_by based on the transition. Prevents clients from spoofing
-- completed_by (the only column they touch is `done`).
create or replace function public.set_task_completion_metadata()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.done = true and old.done = false then
    new.completed_at := now();
    new.completed_by := (select auth.uid());
  elsif new.done = false and old.done = true then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_set_completion_metadata on public.tasks;
create trigger tasks_set_completion_metadata
before update on public.tasks
for each row execute function public.set_task_completion_metadata();


-- ─── 6. checklist_items table ──────────────────────────────────────────────
-- Sub-items under a task. completed_at IS NOT NULL = item is complete (no
-- separate `done` boolean — per locked spec).
--
-- client_visible is NOT NULL with no DEFAULT. INSERT must either (a) provide
-- a value explicitly, or (b) rely on the inherit_checklist_item_client_visible
-- trigger (section 7) which fires BEFORE NOT NULL evaluation.
create table public.checklist_items (
  id             uuid        primary key default gen_random_uuid(),
  task_id        uuid        not null references public.tasks(id) on delete cascade,
  title          text        not null,
  position       integer     not null,
  client_visible boolean     not null,
  completed_at   timestamptz,
  completed_by   uuid        references auth.users(id) on delete set null,
  created_by     uuid        references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index checklist_items_task_pos_idx on public.checklist_items(task_id, position);

comment on table public.checklist_items is
  'Sub-items under a task. client_visible inherits from parent task at INSERT '
  'via trigger but is then independently editable. completed_at IS NOT NULL = '
  'item is complete; completed_by auto-populated by trigger.';


-- ─── 7. checklist_items inherit-visibility trigger ─────────────────────────
-- BEFORE INSERT. Fires before NOT NULL evaluation. App INSERTs that omit
-- client_visible (or pass NULL) inherit from the parent task. Explicit
-- true/false overrides.
create or replace function public.inherit_checklist_item_client_visible()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.client_visible is null then
    select client_visible into new.client_visible
    from public.tasks where id = new.task_id;
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_items_inherit_visibility on public.checklist_items;
create trigger checklist_items_inherit_visibility
before insert on public.checklist_items
for each row execute function public.inherit_checklist_item_client_visible();


-- ─── 8. checklist_items enforce_client_update_scope ────────────────────────
-- Mirrors tasks_enforce_client_update_scope: clients can only toggle
-- completion. completed_at is not in the forbidden list; completed_by is
-- set by the trigger in section 9 so the client never directly touches it.
create or replace function public.enforce_client_checklist_item_update_scope()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  parent_pipeline_id uuid;
begin
  select s.pipeline_id into parent_pipeline_id
  from public.tasks t
  join public.stages s on s.id = t.stage_id
  where t.id = new.task_id;

  if public.is_pipeline_client(parent_pipeline_id) then
    if new.title          is distinct from old.title
       or new.position    is distinct from old.position
       or new.task_id     is distinct from old.task_id
       or new.client_visible is distinct from old.client_visible then
      raise exception 'Clients can only toggle completion on checklist items.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_items_enforce_client_update_scope on public.checklist_items;
create trigger checklist_items_enforce_client_update_scope
before update on public.checklist_items
for each row execute function public.enforce_client_checklist_item_update_scope();


-- ─── 9. checklist_items completion-metadata trigger ────────────────────────
-- Symmetric with tasks. App writes `completed_at = now()` (check) or
-- `completed_at = null` (uncheck). System writes completed_by based on
-- the null↔not-null transition.
create or replace function public.set_checklist_item_completion_metadata()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    new.completed_by := (select auth.uid());
  elsif new.completed_at is null and old.completed_at is not null then
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists checklist_items_set_completion_metadata on public.checklist_items;
create trigger checklist_items_set_completion_metadata
before update on public.checklist_items
for each row execute function public.set_checklist_item_completion_metadata();


-- ─── 10. checklist_items RLS ───────────────────────────────────────────────
alter table public.checklist_items enable row level security;

-- SELECT: agency members see all items on pipelines they belong to. Clients
-- see only items where the full visibility chain (item → task → stage) is
-- client_visible. Defense in depth — a "smuggled" client_visible item under
-- a hidden parent stays hidden.
create policy checklist_items_select on public.checklist_items
for select using (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    where t.id = checklist_items.task_id
      and (
        public.is_pipeline_agency_member(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and checklist_items.client_visible = true
          and t.client_visible = true
          and s.client_visible = true
        )
      )
  )
);

-- INSERT: agency edit-permitted users only. Clients never create items.
create policy checklist_items_insert on public.checklist_items
for insert with check (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    where t.id = checklist_items.task_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);

-- UPDATE: agency editors (full); clients on chain-visible items, column-
-- restricted to completed_at by the trigger in section 8.
create policy checklist_items_update on public.checklist_items
for update using (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    where t.id = checklist_items.task_id
      and (
        public.can_edit_pipeline(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and checklist_items.client_visible = true
          and t.client_visible = true
          and s.client_visible = true
        )
      )
  )
)
with check (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    where t.id = checklist_items.task_id
      and (
        public.can_edit_pipeline(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and checklist_items.client_visible = true
          and t.client_visible = true
          and s.client_visible = true
        )
      )
  )
);

-- DELETE: agency editors only.
create policy checklist_items_delete on public.checklist_items
for delete using (
  exists (
    select 1 from public.tasks t
    join public.stages s on s.id = t.stage_id
    where t.id = checklist_items.task_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);


-- ─── 11. Drop team_invites ─────────────────────────────────────────────────
-- Superseded by workspace_invites in Phase 3.4 step 6. Zero src/ refs; the
-- three RLS policies on it cascade away. PHASE_3_4_PLAN.md, RLS_PLAN.md,
-- supabase/README.md still mention the table name in prose — leave for a
-- separate docs cleanup pass; not a functional concern.
drop table if exists public.team_invites cascade;


-- ============================================================================
-- DOWN PLAN (manual rollback)
-- ============================================================================
--   drop policy if exists checklist_items_delete on public.checklist_items;
--   drop policy if exists checklist_items_update on public.checklist_items;
--   drop policy if exists checklist_items_insert on public.checklist_items;
--   drop policy if exists checklist_items_select on public.checklist_items;
--   drop function if exists public.set_checklist_item_completion_metadata();
--   drop function if exists public.enforce_client_checklist_item_update_scope();
--   drop function if exists public.inherit_checklist_item_client_visible();
--   drop table if exists public.checklist_items;
--   drop function if exists public.set_task_completion_metadata();
--   -- restore enforce_client_task_update_scope body from
--   -- 20260509120000_rls_policies.sql lines 363-388 (with old `text` column name)
--   alter table public.tasks rename column title to text;
--   alter table public.tasks
--     drop column if exists description,
--     drop column if exists completed_by,
--     drop column if exists completed_at,
--     drop column if exists assignee_id;
--   alter table public.profiles drop column if exists last_active_pipeline_id;
--   -- team_invites: recreate from 20260508120000_initial_schema.sql lines
--   -- 304-316 + the three RLS policies from 20260509120000.
-- ============================================================================
