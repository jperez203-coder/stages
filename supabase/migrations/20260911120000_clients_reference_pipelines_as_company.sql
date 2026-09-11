-- Second correction to the Client/Company/Project naming: a "Company" is
-- not a new entity — it's a Pipeline, renamed. Pipelines already carry
-- everything a client portal needs (name, emoji, company, members,
-- channels, stages/tasks), and a pipeline can already hold unlimited
-- stages — so "unlimited projects under one client portal" was already
-- true mechanically; it only needed the labels untangled:
--
--   Pipeline -> Company (the portal)
--   Stage    -> Project (already lives directly under the pipeline,
--                already unlimited-per-pipeline, already holds tasks)
--   Task     -> unchanged
--
-- This drops the standalone `companies` table added in
-- 20260910130000 (redundant now — pipelines already are the company/
-- portal) and repoints `clients.company_id` at `pipelines.id` directly.
-- `clients` itself (the individual contact roster) is still new and
-- still correct — that concept genuinely didn't exist before.

drop table public.clients cascade;
drop table public.companies cascade;
alter table public.pipelines drop column company_id;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_id uuid not null references public.pipelines(id) on delete cascade,
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
