-- ============================================================================
-- Sidebar folders + minimal doc/sheet engine
-- ============================================================================
-- Adds a lightweight, WORKSPACE-WIDE (not pipeline-scoped) internal wiki:
-- custom named folders in the sidebar, each holding "doc" or "sheet" type
-- documents. This is a new breadth of data for the app — everything else
-- (stages/tasks/notes/files) lives under a specific client pipeline; these
-- live at the workspace level, alongside pipelines, not inside one.
--
-- Entirely internal. No client_visible concept exists here — clients never
-- have workspace_memberships, so is_workspace_member() alone already
-- excludes them from every policy below. Nothing further needed.
--
-- RLS PATTERN: mirrors public.templates (20260606120000) for the
-- membership-based select/insert/update shape, and additionally ANDs in
-- public.is_workspace_writable() on every mutation — that helper didn't
-- exist yet when templates shipped; BR-3 (20260618200000) established it
-- as the billing-enforcement pattern for new workspace-mutating tables, so
-- this table is built with it from day one instead of needing a later
-- retrofit migration.
--
-- ACCESS MODEL (assumption — flag if this isn't what you want):
--   * Any workspace team member (owner/admin/member) can read, create, and
--     edit folders/documents — a low-friction shared team wiki, same trust
--     level as e.g. an internal chat channel.
--   * DELETE is owner/admin only, matching the destructive-action pattern
--     used elsewhere (e.g. templates_delete) — losing a folder/doc is more
--     consequential than editing one.
--
-- CONTENT SHAPES (JSONB — chosen so plain text is trivial to extract later
-- for the future read-only "ask anything" embeddings feature; NOT built
-- here, this just avoids painting that feature into a corner):
--   doc:   { blocks: [{ type: 'p'|'h1'|'h2'|'bullet', text: string }] }
--   sheet: { columns: string[], rows: Record<string,string>[] }
-- ============================================================================


-- ── STEP 1: sidebar_folders ─────────────────────────────────────────────────

create table public.sidebar_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  -- Ordering within the sidebar. Default 0 is a placeholder only — the app
  -- must compute the real value (current max + 1) client-side before
  -- insert, same convention as stages.position / tasks.position elsewhere
  -- in this schema. Not a DB sequence/trigger.
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index sidebar_folders_workspace_pos_idx
  on public.sidebar_folders(workspace_id, position);

comment on table public.sidebar_folders is
  'Workspace-wide sidebar folders for the internal doc/sheet wiki. Not '
  'pipeline-scoped, not client-visible.';


-- ── STEP 2: documents ────────────────────────────────────────────────────────

create type public.doc_type as enum ('doc', 'sheet');

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  folder_id uuid not null references public.sidebar_folders(id) on delete cascade,
  title text not null default 'Untitled',
  type public.doc_type not null default 'doc',
  content jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_folder_idx on public.documents(folder_id);
create index documents_workspace_idx on public.documents(workspace_id);

comment on column public.documents.content is
  'doc: { blocks: [{ type, text }] } — sheet: { columns: string[], rows: Record<string,string>[] }. '
  'Shape chosen for easy plain-text extraction by a future embeddings pass.';

-- Reuses the existing touch_updated_at() trigger function (already defined
-- for user_billing / workspace_billing) — no new function needed.
create trigger documents_touch
  before update on public.documents
  for each row execute function public.touch_updated_at();


-- ── STEP 3: enable RLS ───────────────────────────────────────────────────────

alter table public.sidebar_folders enable row level security;
alter table public.documents enable row level security;


-- ── STEP 4: sidebar_folders policies ─────────────────────────────────────────

create policy sidebar_folders_select on public.sidebar_folders
for select using (
  public.is_workspace_member(workspace_id)
);

create policy sidebar_folders_insert on public.sidebar_folders
for insert with check (
  public.is_workspace_member(workspace_id)
  and public.is_workspace_writable(workspace_id)
);

create policy sidebar_folders_update on public.sidebar_folders
for update using (
  public.is_workspace_member(workspace_id)
  and public.is_workspace_writable(workspace_id)
) with check (
  public.is_workspace_member(workspace_id)
  and public.is_workspace_writable(workspace_id)
);

create policy sidebar_folders_delete on public.sidebar_folders
for delete using (
  public.is_workspace_owner_or_admin(workspace_id)
  and public.is_workspace_writable(workspace_id)
);


-- ── STEP 5: documents policies ───────────────────────────────────────────────

create policy documents_select on public.documents
for select using (
  public.is_workspace_member(workspace_id)
);

-- INSERT/UPDATE additionally verify folder_id actually belongs to the same
-- workspace_id on the row — without this, a caller could set workspace_id
-- to their own (writable) workspace but folder_id to a folder in a
-- DIFFERENT workspace, attaching a document across the isolation boundary.
-- The advisor's draft didn't have this check; adding it here.
create policy documents_insert on public.documents
for insert with check (
  public.is_workspace_member(workspace_id)
  and public.is_workspace_writable(workspace_id)
  and exists (
    select 1 from public.sidebar_folders f
    where f.id = documents.folder_id
      and f.workspace_id = documents.workspace_id
  )
);

create policy documents_update on public.documents
for update using (
  public.is_workspace_member(workspace_id)
  and public.is_workspace_writable(workspace_id)
) with check (
  public.is_workspace_member(workspace_id)
  and public.is_workspace_writable(workspace_id)
  and exists (
    select 1 from public.sidebar_folders f
    where f.id = documents.folder_id
      and f.workspace_id = documents.workspace_id
  )
);

create policy documents_delete on public.documents
for delete using (
  public.is_workspace_owner_or_admin(workspace_id)
  and public.is_workspace_writable(workspace_id)
);


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Both tables exist with RLS enabled:
--   select relname, relrowsecurity from pg_class
--   where relname in ('sidebar_folders', 'documents');
--   Expected: relrowsecurity = true for both.
--
-- 2. Cross-workspace folder_id attach is rejected (as a member of workspace
--    A, try to insert a document with workspace_id = A but folder_id
--    belonging to workspace B): expect 0 rows / RLS violation.
--
-- 3. A member of a workspace with no active subscription (is_workspace_writable
--    = false) cannot insert/update/delete folders or documents, but CAN still
--    select existing ones (read access is never billing-gated, matching the
--    rule already established for tasks/stages/etc.).
-- ============================================================================
