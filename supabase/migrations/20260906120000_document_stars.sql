-- ============================================================================
-- Per-user document starring
-- ============================================================================
-- Backs the star toggle on the doc/sheet page header (Figma V2). Starring is
-- PERSONAL, not a shared document flag — a separate table (not a boolean
-- column on `documents`) so one member starring a doc doesn't star it for
-- everyone else in the workspace. Matches the "Starred" sidebar section
-- being a per-user concept (see Sidebar.tsx doc comment).
--
-- workspace_id is denormalized onto this table (same convention as
-- `documents.workspace_id` alongside `folder_id` in
-- 20260904120000_sidebar_folders_and_documents.sql) so RLS can check
-- membership without a join through `documents`.
--
-- Not wired into the sidebar's "Starred" section yet — that's a separate,
-- larger follow-up (the section is currently a static placeholder). This
-- migration only adds the toggle + persistence for the header button.
-- ============================================================================

create table public.document_stars (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, document_id)
);

create index document_stars_user_idx on public.document_stars(user_id);

comment on table public.document_stars is
  'Per-user starred documents. Starring is personal — not visible to other workspace members.';

alter table public.document_stars enable row level security;

-- A user only ever sees their own stars; no cross-user leakage possible
-- regardless of workspace state.
create policy document_stars_select on public.document_stars
for select using (
  user_id = auth.uid()
);

-- INSERT gated the same way as documents_insert: membership + billing-
-- writable + the document must actually belong to the claimed workspace
-- (cross-workspace isolation, same rationale as documents_insert).
create policy document_stars_insert on public.document_stars
for insert with check (
  user_id = auth.uid()
  and public.is_workspace_member(workspace_id)
  and public.is_workspace_writable(workspace_id)
  and exists (
    select 1 from public.documents d
    where d.id = document_stars.document_id
      and d.workspace_id = document_stars.workspace_id
  )
);

-- Un-starring your own item is always allowed, even if the workspace's
-- subscription has lapsed — same "read/personal-state changes aren't
-- billing-gated" rule as everything else in this schema.
create policy document_stars_delete on public.document_stars
for delete using (
  user_id = auth.uid()
);
