-- ============================================================================
-- Phase 4c slice 1: pipeline templates — schema + RLS
-- ============================================================================
-- First of four planned slices for the templates feature. See the PLANNED
-- entry at the top of PROGRESS.md for the full agreed scope. This slice
-- lands only the data shape + access policies. No UI, no RPC, no seed data.
-- Built-in starter templates seed: slice 2. SAVE flow: slice 3. Picker UI +
-- INSTANTIATE: slice 4.
--
-- ── LOCKED CONSTRAINT (enforced by schema shape here) ───────────────
--
-- Stage color = completion state per src/lib/current-stage.ts (the file
-- is LOCKED — never modify). Instantiated pipelines start ALL-GREY
-- because every stage is incomplete on creation. Therefore:
--
--   * template_stages has NO `color` column. Mirroring public.stages's
--     color column would invite slice 4 to copy it into the new pipeline's
--     stages, short-circuiting the state-color computation. Removing it
--     here at the schema level prevents that mistake by construction.
--   * The picker UI's stage pills MAY use a decorative position-index
--     palette for visual variety; that's a UI rendering decision, not a
--     column on this table.
--
-- ── COLUMN-NAME VERIFICATION (done 2026-06-06) ──────────────────────
--
-- The initial schema (20260508120000) had tasks.text + tasks.note. The
-- phase 4a data-model migration (20260519120000) renamed text→title and
-- added a separate description column. The TS type TaskRaw confirms the
-- live UI reads title + description. note still exists in public.tasks
-- (initial schema column, not dropped — the enforce_client_task_update_scope
-- trigger still references it) but the live UI doesn't consume it. The
-- template_tasks columns below mirror title + description; note is out of
-- scope for templates v1.
--
-- Stage column names verified unchanged from initial schema: name +
-- description + client_visible are the kept columns; color + deadline +
-- completed + completed_at are stripped.
--
-- ── BUILT-IN TEMPLATES SHAPE ────────────────────────────────────────
--
-- templates.workspace_id is NULLABLE. NULL means "Stages-shipped built-in
-- starter template" — readable by every authenticated user via the
-- templates_select policy, write-blocked at the policy level so no agency
-- can edit or delete a built-in. Built-ins land in slice 2's seed
-- migration which runs as the migration role (RLS bypassed during DDL,
-- so the workspace_id=NULL inserts that the templates_insert policy
-- would reject are allowed during the seed step).
--
-- NOT NULL workspace_id means "workspace-saved template" — private to the
-- workspace that created it; only workspace owners/admins can write.
--
-- ── CASCADE BEHAVIOR ────────────────────────────────────────────────
--
--   * workspace deleted → templates (workspace_id FK CASCADE) → their
--     template_stages (CASCADE) → their template_tasks (CASCADE). Clean.
--   * source_pipeline deleted → source_pipeline_id SET NULL (template
--     survives; provenance becomes "unknown source"). Matches the same
--     ON DELETE SET NULL pattern used for activity_events.actor_id,
--     stage_notes.author_id, etc.
--   * created_by user deleted → created_by SET NULL (template survives).
--   * template deleted → its template_stages CASCADE → their template_tasks
--     CASCADE.
--
-- ── DOWN PLAN
-- │
-- │   drop policy if exists template_tasks_delete  on public.template_tasks;
-- │   drop policy if exists template_tasks_update  on public.template_tasks;
-- │   drop policy if exists template_tasks_insert  on public.template_tasks;
-- │   drop policy if exists template_tasks_select  on public.template_tasks;
-- │   drop policy if exists template_stages_delete on public.template_stages;
-- │   drop policy if exists template_stages_update on public.template_stages;
-- │   drop policy if exists template_stages_insert on public.template_stages;
-- │   drop policy if exists template_stages_select on public.template_stages;
-- │   drop policy if exists templates_delete       on public.templates;
-- │   drop policy if exists templates_update       on public.templates;
-- │   drop policy if exists templates_insert       on public.templates;
-- │   drop policy if exists templates_select       on public.templates;
-- │   drop table if exists public.template_tasks;
-- │   drop table if exists public.template_stages;
-- │   drop table if exists public.templates;
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. templates ──────────────────────────────────────────────────────────
create table public.templates (
  id                  uuid primary key default gen_random_uuid(),
  -- NULL = Stages-shipped built-in (read-only to all agencies via RLS).
  -- NOT NULL = workspace-saved by an agency (private to that workspace).
  workspace_id        uuid references public.workspaces(id) on delete cascade,
  name                text not null,
  description         text,
  emoji               text not null default '📋',
  -- Provenance — set when an agency saves from a live pipeline. NULL for
  -- built-ins. Also goes NULL if the source pipeline is later deleted
  -- (the template survives the source).
  source_pipeline_id  uuid references public.pipelines(id) on delete set null,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index templates_workspace_idx on public.templates(workspace_id);


-- ─── 2. template_stages ───────────────────────────────────────────────────
-- Mirrors public.stages MINUS color + deadline + completed + completed_at.
-- Locked constraint: color is derived from completion state at render
-- time (src/lib/current-stage.ts), never stored.
create table public.template_stages (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references public.templates(id) on delete cascade,
  position        integer not null,
  name            text not null,
  description     text,
  client_visible  boolean not null default false
);
create index template_stages_template_pos_idx
  on public.template_stages(template_id, position);


-- ─── 3. template_tasks ───────────────────────────────────────────────────
-- Mirrors public.tasks's content columns (title + description +
-- client_visible) and strips ALL live state (done, deadline, note, pos_x,
-- pos_y, assignee_id, completed_at, completed_by, created_at).
-- See header for column-name verification trail.
create table public.template_tasks (
  id                 uuid primary key default gen_random_uuid(),
  template_stage_id  uuid not null references public.template_stages(id) on delete cascade,
  position           integer not null,
  title              text not null,
  description        text,
  client_visible     boolean not null default false
);
create index template_tasks_stage_pos_idx
  on public.template_tasks(template_stage_id, position);


-- ─── 4. Enable RLS on all three tables ────────────────────────────────────
alter table public.templates       enable row level security;
alter table public.template_stages enable row level security;
alter table public.template_tasks  enable row level security;


-- ─── 5. templates policies ───────────────────────────────────────────────
-- SELECT: workspace members see their own; built-ins (workspace_id IS NULL)
-- are visible to every authenticated user.
create policy templates_select on public.templates
for select using (
  workspace_id is null
  or public.is_workspace_member(workspace_id)
);

-- INSERT: workspace-scoped only. workspace_id IS NOT NULL guard means no
-- app-level path can create a built-in; built-ins land via slice 2's seed
-- migration running as the migration role (RLS bypassed during DDL).
create policy templates_insert on public.templates
for insert with check (
  workspace_id is not null
  and public.is_workspace_owner_or_admin(workspace_id)
);

-- UPDATE: workspace owners/admins only on their own workspace's templates.
-- workspace_id IS NULL never satisfies → built-ins are read-only to every
-- agency (and to every signed-in user period). Same with check on the
-- post-UPDATE row to prevent moving a row's workspace_id to NULL.
create policy templates_update on public.templates
for update using (
  workspace_id is not null
  and public.is_workspace_owner_or_admin(workspace_id)
) with check (
  workspace_id is not null
  and public.is_workspace_owner_or_admin(workspace_id)
);

-- DELETE: same gate. Built-ins uneditable, undeletable.
create policy templates_delete on public.templates
for delete using (
  workspace_id is not null
  and public.is_workspace_owner_or_admin(workspace_id)
);


-- ─── 6. template_stages policies (join through to parent template) ───────
-- Each operation gates by walking to the parent template's visibility.
-- Same pattern as channel_memberships joining through channels.
create policy template_stages_select on public.template_stages
for select using (
  exists (
    select 1 from public.templates t
    where t.id = template_stages.template_id
      and (
        t.workspace_id is null
        or public.is_workspace_member(t.workspace_id)
      )
  )
);

create policy template_stages_insert on public.template_stages
for insert with check (
  exists (
    select 1 from public.templates t
    where t.id = template_stages.template_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
);

create policy template_stages_update on public.template_stages
for update using (
  exists (
    select 1 from public.templates t
    where t.id = template_stages.template_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
) with check (
  exists (
    select 1 from public.templates t
    where t.id = template_stages.template_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
);

create policy template_stages_delete on public.template_stages
for delete using (
  exists (
    select 1 from public.templates t
    where t.id = template_stages.template_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
);


-- ─── 7. template_tasks policies (join two levels to parent template) ─────
-- Walks template_tasks → template_stages → templates. Built-ins still
-- read-only to all agencies: the parent template's workspace_id IS NULL
-- never satisfies the write-side workspace_id IS NOT NULL guards.
create policy template_tasks_select on public.template_tasks
for select using (
  exists (
    select 1
    from public.template_stages ts
    join public.templates t on t.id = ts.template_id
    where ts.id = template_tasks.template_stage_id
      and (
        t.workspace_id is null
        or public.is_workspace_member(t.workspace_id)
      )
  )
);

create policy template_tasks_insert on public.template_tasks
for insert with check (
  exists (
    select 1
    from public.template_stages ts
    join public.templates t on t.id = ts.template_id
    where ts.id = template_tasks.template_stage_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
);

create policy template_tasks_update on public.template_tasks
for update using (
  exists (
    select 1
    from public.template_stages ts
    join public.templates t on t.id = ts.template_id
    where ts.id = template_tasks.template_stage_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
) with check (
  exists (
    select 1
    from public.template_stages ts
    join public.templates t on t.id = ts.template_id
    where ts.id = template_tasks.template_stage_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
);

create policy template_tasks_delete on public.template_tasks
for delete using (
  exists (
    select 1
    from public.template_stages ts
    join public.templates t on t.id = ts.template_id
    where ts.id = template_tasks.template_stage_id
      and t.workspace_id is not null
      and public.is_workspace_owner_or_admin(t.workspace_id)
  )
);


-- ============================================================================
-- VERIFICATION QUERIES (commented — run manually in SQL editor after apply)
-- ============================================================================
-- (a) Confirm tables exist with the right columns and no `color` on stages.
--   select table_name, column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('templates', 'template_stages', 'template_tasks')
--   order by table_name, ordinal_position;
--   -- Expected: templates has workspace_id (uuid, YES nullable),
--   -- name (text, NO), description (text, YES), emoji (text, NO),
--   -- source_pipeline_id (uuid, YES), created_by (uuid, YES),
--   -- created_at (timestamp with time zone, NO).
--   -- template_stages columns: id, template_id, position, name,
--   -- description, client_visible. **No color column.**
--   -- template_tasks columns: id, template_stage_id, position, title,
--   -- description, client_visible. **No note, no done, no deadline,
--   -- no pos_x/pos_y, no assignee_id, no completed_at, no completed_by,
--   -- no created_at.**
--
-- (b) Confirm RLS is enabled on all three tables.
--   select relname, relrowsecurity
--   from pg_class
--   where relname in ('templates', 'template_stages', 'template_tasks')
--     and relnamespace = 'public'::regnamespace;
--   -- Expected: all three rows show relrowsecurity = true.
--
-- (c) Confirm all 12 policies (4 per table) are present.
--   select polname, polrelid::regclass as table_name, polcmd
--   from pg_policy
--   where polrelid in (
--     'public.templates'::regclass,
--     'public.template_stages'::regclass,
--     'public.template_tasks'::regclass
--   )
--   order by polrelid, polcmd;
--   -- Expected: 12 rows total. Each table contributes one of each:
--   -- SELECT ('r'), INSERT ('a'), UPDATE ('w'), DELETE ('d').
--
-- (d) Sanity: no built-ins exist yet (seed comes in slice 2).
--   select count(*) from public.templates where workspace_id is null;
--   -- Expected: 0.
-- ============================================================================
