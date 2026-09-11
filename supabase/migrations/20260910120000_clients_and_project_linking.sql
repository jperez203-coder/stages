-- Data-model foundation for the Project/Client split (see the "Pipeline is
-- doing two jobs" discussion): a "pipeline" today is simultaneously the
-- client-portal boundary AND a single stage-tracked engagement, which
-- breaks down once a client needs multiple concurrent projects tracked
-- separately.
--
-- This migration only adds the new `clients` entity and an optional link
-- from `pipelines` (== "Project" in the UI going forward) to it. Nothing
-- reads or writes this column yet — no behavior changes, no UI changes.
-- The internal table name stays `pipelines` (renaming it would touch RLS
-- policies, queries, and types across the whole app for no functional
-- gain); "Project" is purely the user-facing word from here on.
--
-- Deliberately NOT part of this migration (later steps):
--   - Client creation/invite UI (workspace-level "+ New Client").
--   - Project <-> Client linking UI.
--   - Portal access model change (today a "client" is a person with a
--     pipeline_memberships row scoped to ONE pipeline; widening portal
--     access to "every project linked to this client" needs its own
--     membership table + RLS changes across stages/tasks/channels, which
--     is real surgery best done once the UI shape is settled).

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  emoji text default '🏢',
  created_at timestamptz not null default now()
);

create index clients_workspace_idx on public.clients(workspace_id);

alter table public.clients enable row level security;

-- Mirrors the pipelines_* policies' shape: any workspace member can read
-- and rename a client, only the owner can create or delete one.
create policy clients_select on public.clients
for select using (public.is_workspace_member(workspace_id));

create policy clients_insert on public.clients
for insert with check (public.is_workspace_owner(workspace_id));

create policy clients_update on public.clients
for update using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy clients_delete on public.clients
for delete using (public.is_workspace_owner(workspace_id));

-- Optional link: a project (pipeline) MAY belong to a client, or may be
-- pure internal work with no client at all. ON DELETE SET NULL — deleting
-- a client unlinks its projects rather than destroying their data.
alter table public.pipelines
  add column client_id uuid references public.clients(id) on delete set null;

create index pipelines_client_idx on public.pipelines(client_id) where client_id is not null;
