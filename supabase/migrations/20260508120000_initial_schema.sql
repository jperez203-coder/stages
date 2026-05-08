-- ============================================================================
-- Stages — initial schema (Phase 3.2)
-- ============================================================================
-- Apply via the Supabase SQL editor or `supabase db push`.
--
-- Reflects the locked decisions from CLAUDE.md "Phase 3 schema decisions":
--   1. No denormalized owner columns. Owner is just a membership row.
--   2. No legacy pipeline.messages — channels/channel_messages only.
--   3. Single stage_notes table (no shape variants).
--   4. Mentions reference user_id (uuid), not email strings.
--   5. Multi-owner workspaces allowed.
--   6. All inline arrays from the prototype become tables.
--   7. Normalized read_state with separate columns.
--
-- Row Level Security policies live in a follow-up migration (3.3) — this
-- migration only sets up the structure. Do NOT expose this DB to the client
-- until RLS is enabled and policies are in place.
-- ============================================================================

-- ─── extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── profiles ────────────────────────────────────────────────────────────────
-- Lightweight extension of auth.users. Join target for display data; the
-- email is denormalized so app queries don't need to reach into auth schema.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create index profiles_email_idx on public.profiles(email);

comment on table public.profiles is
  'App-level user profile. One row per auth.users row, populated on signup.';

-- ─── workspaces ──────────────────────────────────────────────────────────────
-- A workspace groups pipelines for one agency. Multi-owner allowed via
-- workspace_memberships (locked decision #5).
create table public.workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ─── workspace_memberships ───────────────────────────────────────────────────
-- The replacement for prototype's workspace.ownerEmail. MVP only writes
-- role='owner', but the CHECK is pre-loosened to admit admin/member so we
-- don't pay the column-migration cost later when an agency wants a workspace-
-- wide ops admin (cross-pipeline visibility without being a co-owner).
create table public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_memberships_user_idx on public.workspace_memberships(user_id);

-- ─── pipelines ───────────────────────────────────────────────────────────────
-- The prototype calls these "clients" but the data shape is a pipeline.
-- workspace_id is required so every pipeline lives inside a workspace.
-- current_stage_id is added below as a deferred FK (circular with stages).
create table public.pipelines (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  company text,
  emoji text default '📋',
  template text,
  current_stage_id uuid,
  submitted_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null,
  last_edited_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index pipelines_workspace_idx on public.pipelines(workspace_id);

-- ─── pipeline_memberships ────────────────────────────────────────────────────
-- Role attached to the (user, pipeline) relationship — owner / admin / member /
-- client. can_submit and can_check_tasks are per-membership permission flags
-- that mirror the prototype's per-member booleans.
create table public.pipeline_memberships (
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'client')),
  can_submit boolean not null default false,
  can_check_tasks boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (pipeline_id, user_id)
);

create index pipeline_memberships_user_idx on public.pipeline_memberships(user_id);
create index pipeline_memberships_role_idx on public.pipeline_memberships(pipeline_id, role);

-- ─── stages ──────────────────────────────────────────────────────────────────
-- position is the order within the pipeline (renumbered on reorder).
create table public.stages (
  id uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  position integer not null,
  name text not null,
  description text,
  color text,
  deadline timestamptz,
  completed boolean not null default false,
  completed_at timestamptz,
  client_visible boolean not null default false
);

create index stages_pipeline_pos_idx on public.stages(pipeline_id, position);

-- Now the back-reference from pipelines.current_stage_id can resolve.
alter table public.pipelines
  add constraint pipelines_current_stage_fk
  foreign key (current_stage_id) references public.stages(id) on delete set null;

-- ─── tasks ───────────────────────────────────────────────────────────────────
-- position is the list-order within the stage. pos_x/pos_y are free-form
-- coordinates for the Canvas view (null until the user drags the task).
create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  position integer not null,
  text text not null,
  done boolean not null default false,
  deadline timestamptz,
  note text,
  pos_x numeric,
  pos_y numeric,
  client_visible boolean not null default false
);

create index tasks_stage_pos_idx on public.tasks(stage_id, position);

-- ─── stage_notes ─────────────────────────────────────────────────────────────
-- Threaded notes per stage. Replaces the prototype's three legacy shapes
-- (string, single object, array) with one row-per-note model.
create table public.stage_notes (
  id uuid primary key default uuid_generate_v4(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  client_visible boolean not null default false
);

create index stage_notes_stage_idx on public.stage_notes(stage_id, created_at desc);

-- ─── stage_attachments ───────────────────────────────────────────────────────
-- Files attached to a specific stage. storage_path points into a Supabase
-- Storage bucket (created in 3.3 alongside policies). Image-only for MVP.
create table public.stage_attachments (
  id uuid primary key default uuid_generate_v4(),
  stage_id uuid not null references public.stages(id) on delete cascade,
  kind text not null default 'image' check (kind in ('image')),
  label text,
  storage_path text not null,
  file_name text,
  file_size bigint,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  client_visible boolean not null default false
);

create index stage_attachments_stage_idx on public.stage_attachments(stage_id);

-- ─── pipeline_links ──────────────────────────────────────────────────────────
-- Pipeline-level files & URLs (the agency's Files & Links tab). url is set
-- for kind='url'; storage_path is set for kind='image'. The check enforces
-- that exactly the right field is filled for each kind.
create table public.pipeline_links (
  id uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  kind text not null check (kind in ('url', 'image')),
  label text,
  url text,
  storage_path text,
  file_name text,
  file_size bigint,
  added_by uuid references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  client_visible boolean not null default false,
  constraint pipeline_links_kind_payload check (
    (kind = 'url'   and url is not null and storage_path is null) or
    (kind = 'image' and storage_path is not null and url is null)
  )
);

create index pipeline_links_pipeline_idx on public.pipeline_links(pipeline_id);

-- ─── channels ────────────────────────────────────────────────────────────────
-- Slack-style chat channels scoped to a single pipeline.
-- The unique partial index enforces the one-client-channel-per-pipeline rule
-- at the database — defense in depth on top of the application check.
create table public.channels (
  id uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  is_client boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index channels_pipeline_idx on public.channels(pipeline_id);

create unique index channels_one_client_per_pipeline
  on public.channels(pipeline_id)
  where is_client = true;

-- ─── channel_memberships ─────────────────────────────────────────────────────
create table public.channel_memberships (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index channel_memberships_user_idx on public.channel_memberships(user_id);

-- ─── channel_messages ────────────────────────────────────────────────────────
-- mentions is a uuid[] of user_ids. GIN index makes "messages mentioning me"
-- queries fast. is_internal is the agency-only flag — RLS in 3.3 will hide
-- internal messages from clients.
create table public.channel_messages (
  id uuid primary key default uuid_generate_v4(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  text text not null,
  is_internal boolean not null default false,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create index channel_messages_channel_idx on public.channel_messages(channel_id, created_at desc);
create index channel_messages_mentions_idx on public.channel_messages using gin (mentions);

-- ─── activity_events ─────────────────────────────────────────────────────────
-- Append-only event log for the Activity tab. Both stage_name AND actor_name
-- are denormalized at write time: the entry survives stage renames, stage
-- deletes, AND user account deletions so historical entries always read
-- "Sarah completed task X" forever, never "[deleted user] completed task X".
create table public.activity_events (
  id uuid primary key default uuid_generate_v4(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  type text not null check (type in (
    'pipeline_created',
    'member_joined',
    'stage_advanced',
    'pipeline_submitted'
  )),
  stage_name text,
  created_at timestamptz not null default now()
);

create index activity_events_pipeline_idx on public.activity_events(pipeline_id, created_at desc);

-- ─── read_state ──────────────────────────────────────────────────────────────
-- Replaces the prototype's "${email}|${id}|${tab}" string-keyed object.
-- kind defaults to '' so the composite PK is always populated; pipeline_tab
-- rows use kind='thread'/'activity'/'members'.
create table public.read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null check (scope_type in ('channel', 'pipeline_tab', 'celebration')),
  scope_id uuid not null,
  kind text not null default '',
  last_read_at timestamptz not null default now(),
  primary key (user_id, scope_type, scope_id, kind)
);

-- ─── user_templates ──────────────────────────────────────────────────────────
-- Saved pipeline structure for reuse. The stages payload is { stages:
-- [{ name, tasks: [string] }] } — JSONB because it's a write-once snapshot
-- and we never need to query its contents.
create table public.user_templates (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text default '📋',
  description text,
  stages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index user_templates_owner_idx on public.user_templates(owner_id);

-- ─── invites (team_invites + client_invites) ────────────────────────────────
-- These two tables track the prototype's custom-token invitation flow.
--
-- TODO(3.4) — explicit decision required when wiring auth: compare Supabase's
-- native auth.admin.inviteUserByEmail() flow against this custom-token
-- approach. Specifically check whether native handles BOTH cases cleanly:
--   (a) agency invites that lead to email+password setup, and
--   (b) client invites that lead to magic-link-only access.
-- If native handles both, drop these tables. If not, keep them. Don't carry
-- the duplication into 4.x without making the call.

-- ─── team_invites ────────────────────────────────────────────────────────────
-- Pending team-member invitations. Acceptance creates a pipeline_memberships
-- row with role='member'.
create table public.team_invites (
  token text primary key,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted boolean not null default false,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create index team_invites_pipeline_idx on public.team_invites(pipeline_id);
create index team_invites_email_idx on public.team_invites(email);

-- ─── client_invites ──────────────────────────────────────────────────────────
-- Magic-link invitations for clients. Tracks the "who's pending" UX state
-- alongside Supabase Auth's actual magic-link mechanism (wired in 3.4).
create table public.client_invites (
  token text primary key,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  client_email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted boolean not null default false,
  accepted_at timestamptz
);

create index client_invites_pipeline_idx on public.client_invites(pipeline_id);

-- ============================================================================
-- End of initial schema. RLS policies follow in 0002_rls_policies.sql.
-- ============================================================================
