-- Corrects the previous migration's naming: what it called `clients` is
-- actually the COMPANY concept (e.g. "On Top Roofing") per the Figma —
-- companies view shows a stack of individual client-contact avatars per
-- row, and the clients view shows individual people (name + email), each
-- belonging to exactly one company. Two distinct entities:
--
--   Company  — the business a project can optionally link to.
--   Client   — an individual contact/person at a company; THIS is who
--              actually gets invited to a portal (not the company itself,
--              which has no email of its own).
--
-- Safe to drop-and-recreate rather than rename-in-place: the previous
-- `clients` table and `pipelines.client_id` column are empty/unused (see
-- 20260910120000's own comment — "nothing reads or writes this column
-- yet"), so there's no data or app code to migrate.

drop table public.clients cascade;
alter table public.pipelines drop column client_id;

-- ─── companies ──────────────────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  emoji text default '🏢',
  created_at timestamptz not null default now()
);

create index companies_workspace_idx on public.companies(workspace_id);

alter table public.companies enable row level security;

create policy companies_select on public.companies
for select using (public.is_workspace_member(workspace_id));

create policy companies_insert on public.companies
for insert with check (public.is_workspace_owner(workspace_id));

create policy companies_update on public.companies
for update using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy companies_delete on public.companies
for delete using (public.is_workspace_owner(workspace_id));

-- Optional link: a project (pipeline) MAY belong to a company, or may be
-- pure internal work with no company at all. ON DELETE SET NULL —
-- deleting a company unlinks its projects rather than destroying them.
alter table public.pipelines
  add column company_id uuid references public.companies(id) on delete set null;

create index pipelines_company_idx on public.pipelines(company_id) where company_id is not null;

-- ─── clients (individual contacts) ─────────────────────────────────────
-- Not yet tied to a portal identity/auth.users row — that wiring (client
-- login, invite-by-email, pipeline_memberships-equivalent scoped to a
-- client_id) is deliberately a later step once the roster UI itself is
-- settled. For now this is just the contact record shown in the Clients
-- list.
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text,
  created_at timestamptz not null default now()
);

create index clients_workspace_idx on public.clients(workspace_id);
create index clients_company_idx on public.clients(company_id);

alter table public.clients enable row level security;

create policy clients_select on public.clients
for select using (public.is_workspace_member(workspace_id));

create policy clients_insert on public.clients
for insert with check (public.is_workspace_owner(workspace_id));

create policy clients_update on public.clients
for update using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

create policy clients_delete on public.clients
for delete using (public.is_workspace_owner(workspace_id));
