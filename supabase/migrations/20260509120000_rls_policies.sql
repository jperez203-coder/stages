-- ============================================================================
-- Stages — RLS, helper functions, triggers, storage buckets (Phase 3.3)
-- ============================================================================
-- Apply via `npx supabase db push`. Verify by running the two-browser test
-- documented in CLAUDE.md "Security model → The two-browser test."
--
-- Architecture:
--   * Helper functions (security definer, stable) bypass RLS to read membership
--     tables and let the planner cache results across rows in a query.
--   * Triggers handle what RLS cannot express cleanly: profile auto-creation,
--     last-owner protection, admin permission scoping, submission gating, and
--     atomic stage-advancement on task completion.
--   * Per-table RLS policies enforce row-level access. Each policy is preceded
--     by a plain-English comment block describing what it enforces and why.
--   * Storage policies guard the two private buckets (stage_attachments,
--     pipeline_files) so files are only readable by users who can read the
--     corresponding row.
--
-- Internal-message defense in depth — see CLAUDE.md → Security model item 4.
-- The channel_messages SELECT policy below is Layer 1. Layers 2 and 3 live in
-- application code and must remain.
-- ============================================================================


-- ============================================================================
-- 1. HELPER FUNCTIONS
-- ============================================================================
-- All declared `security definer stable` with `set search_path = ''` so they
-- bypass RLS internally (preventing infinite recursion when policies reference
-- the same membership tables they're protecting), let the planner cache
-- results, and resist search-path-based attacks.
-- ----------------------------------------------------------------------------

-- True if the calling user has any membership row in the workspace.
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_memberships
    where workspace_id = ws_id and user_id = (select auth.uid())
  );
$$;

-- True if the calling user is workspace-level OWNER (role='owner') of the workspace.
create or replace function public.is_workspace_owner(ws_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_memberships
    where workspace_id = ws_id and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

-- True if the calling user is an agency-side member of the pipeline. This is
-- the union of: (a) explicit pipeline_memberships row with role IN
-- ('owner','admin','member'), AND (b) workspace owners — they inherit access
-- to every pipeline in the workspace without needing an explicit row (matches
-- the prototype + every real agency product).
create or replace function public.is_pipeline_agency_member(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role = 'owner'
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'admin', 'member')
        )
      )
  );
$$;

-- True if the calling user has a pipeline_memberships row with role='client'.
create or replace function public.is_pipeline_client(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipeline_memberships
    where pipeline_id = p_id and user_id = (select auth.uid()) and role = 'client'
  );
$$;

-- True if the calling user can read the pipeline at all (agency OR client).
create or replace function public.can_see_pipeline(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select public.is_pipeline_agency_member(p_id) or public.is_pipeline_client(p_id);
$$;

-- True if the user can edit pipeline content (stages, tasks, notes, files,
-- channels, etc.). Workspace owner OR pipeline owner OR pipeline admin.
create or replace function public.can_edit_pipeline(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role = 'owner'
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'admin')
        )
      )
  );
$$;

-- True if the calling user is allowed to mark the pipeline submitted.
-- Workspace owner OR pipeline owner OR (pipeline admin AND can_submit=true).
create or replace function public.can_submit_pipeline(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role = 'owner'
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and (pm.role = 'owner' or (pm.role = 'admin' and pm.can_submit = true))
        )
      )
  );
$$;

-- True if the calling user is an agency user allowed to toggle task done/undone.
-- Owner+admin always; member only with can_check_tasks=true. (Clients have a
-- separate path: their access is governed by client_visible flags, not this.)
create or replace function public.can_check_pipeline_task(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role = 'owner'
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and (
              pm.role in ('owner', 'admin')
              or (pm.role = 'member' and pm.can_check_tasks = true)
            )
        )
      )
  );
$$;

-- True if the calling user is a member of the channel.
create or replace function public.is_channel_member(ch_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.channel_memberships
    where channel_id = ch_id and user_id = (select auth.uid())
  );
$$;


-- ============================================================================
-- 2. TRIGGERS
-- ============================================================================
-- Triggers handle invariants RLS cannot express cleanly: cross-row checks,
-- column-scoped permission rules, multi-step atomic operations.
-- ----------------------------------------------------------------------------

-- ─── handle_new_user ────────────────────────────────────────────────────────
-- Auto-create the public.profiles row when a new auth.users row appears.
-- Eliminates the entire class of bugs where app code forgets to create the
-- profile or fails mid-signup. Profile always exists by the time any other
-- code runs against the user.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ─── sync_profile_email ─────────────────────────────────────────────────────
-- Keep public.profiles.email in sync if a user updates their auth.users.email
-- (e.g. via Supabase's email-change flow).
create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function public.sync_profile_email();

-- ─── prevent_last_workspace_owner_removal ───────────────────────────────────
-- Workspaces must always have at least one owner. This trigger fires before a
-- workspace_memberships DELETE and aborts the operation if removing this row
-- would leave the workspace with zero owners. The owner must transfer
-- ownership (insert another owner row first) before they can leave.
create or replace function public.prevent_last_workspace_owner_removal()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role = 'owner' then
    if (
      select count(*) from public.workspace_memberships
      where workspace_id = old.workspace_id and role = 'owner'
    ) <= 1 then
      raise exception 'Cannot remove the last owner from a workspace. Transfer ownership first.';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists workspace_memberships_prevent_last_owner_removal
  on public.workspace_memberships;
create trigger workspace_memberships_prevent_last_owner_removal
before delete on public.workspace_memberships
for each row execute function public.prevent_last_workspace_owner_removal();

-- ─── enforce_admin_can_check_tasks_scope ────────────────────────────────────
-- Owners can update any field of any pipeline_memberships row in their
-- workspace. Admins can ONLY flip can_check_tasks on rows where role='member'.
-- They cannot change roles, change can_submit, modify other admins, etc.
-- (The RLS UPDATE policy admits any can_edit_pipeline user; this trigger is
-- the second gate that scopes admin writes specifically.)
create or replace function public.enforce_admin_can_check_tasks_scope()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
begin
  -- Resolve the calling user's effective role on this pipeline.
  -- Workspace owners inherit 'owner'; otherwise look up pipeline_memberships.
  if exists (
    select 1 from public.workspace_memberships wm
    join public.pipelines p on p.workspace_id = wm.workspace_id
    where p.id = new.pipeline_id and wm.user_id = actor and wm.role = 'owner'
  ) then
    actor_role := 'owner';
  else
    select role into actor_role
    from public.pipeline_memberships
    where pipeline_id = new.pipeline_id and user_id = actor;
  end if;

  -- Owners pass through.
  if actor_role = 'owner' then
    return new;
  end if;

  -- Admins: only allowed mutation is can_check_tasks on a row where role='member'.
  if actor_role = 'admin' then
    if old.role != 'member' then
      raise exception 'Admins can only modify pipeline_memberships rows where role = ''member''.';
    end if;
    if new.role           is distinct from old.role
       or new.can_submit  is distinct from old.can_submit
       or new.joined_at   is distinct from old.joined_at
       or new.user_id     is distinct from old.user_id
       or new.pipeline_id is distinct from old.pipeline_id then
      raise exception 'Admins can only flip can_check_tasks on member rows; no other field changes allowed.';
    end if;
    return new;
  end if;

  -- Members and clients should never reach the UPDATE policy in the first place.
  raise exception 'Only owners or admins can update pipeline_memberships.';
end;
$$;

drop trigger if exists pipeline_memberships_enforce_admin_scope
  on public.pipeline_memberships;
create trigger pipeline_memberships_enforce_admin_scope
before update on public.pipeline_memberships
for each row execute function public.enforce_admin_can_check_tasks_scope();

-- ─── protect_pipeline_submission ────────────────────────────────────────────
-- The submitted_at and submitted_by columns require can_submit_pipeline. This
-- trigger blocks UPDATEs that touch those columns unless the actor passes the
-- check. (Prevents an admin without can_submit from submitting via direct API.)
create or replace function public.protect_pipeline_submission()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  if (new.submitted_at is distinct from old.submitted_at)
     or (new.submitted_by is distinct from old.submitted_by) then
    if not public.can_submit_pipeline(new.id) then
      raise exception 'Only the workspace owner, pipeline owner, or admin with can_submit may submit a pipeline.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pipelines_protect_submission on public.pipelines;
create trigger pipelines_protect_submission
before update on public.pipelines
for each row execute function public.protect_pipeline_submission();

-- ─── enforce_client_task_update_scope ───────────────────────────────────────
-- Clients are allowed to UPDATE tasks they can see (gated by RLS), but only
-- the `done` column — never text, deadline, note, position, visibility, etc.
-- This trigger is the column-level enforcement that pairs with the row-level
-- RLS policy.
create or replace function public.enforce_client_task_update_scope()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  parent_pipeline_id uuid;
begin
  select pipeline_id into parent_pipeline_id
  from public.stages where id = new.stage_id;

  -- If the actor is a client of this pipeline, only `done` may change.
  if public.is_pipeline_client(parent_pipeline_id) then
    if new.text           is distinct from old.text
       or new.deadline    is distinct from old.deadline
       or new.note        is distinct from old.note
       or new.pos_x       is distinct from old.pos_x
       or new.pos_y       is distinct from old.pos_y
       or new.client_visible is distinct from old.client_visible
       or new.position    is distinct from old.position
       or new.stage_id    is distinct from old.stage_id then
      raise exception 'Clients can only toggle the done flag on tasks.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_enforce_client_update_scope on public.tasks;
create trigger tasks_enforce_client_update_scope
before update on public.tasks
for each row execute function public.enforce_client_task_update_scope();

-- ─── auto_advance_stage ─────────────────────────────────────────────────────
-- The keystone trigger: when a task transitions to done=true and that
-- completes the parent stage, atomically:
--   1. Mark the parent stage as completed.
--   2. Advance pipelines.current_stage_id to the next stage (if any).
--   3. Insert the stage_advanced activity event with denormalized actor_name.
--
-- Wrapping all three in one trigger transaction means the database state can
-- never be partially-advanced — regardless of which UI path completed the
-- task (canvas, stage page, drag-and-drop, future automations like incoming
-- email, AI agents, etc.).
--
-- Bypasses RLS via security definer so client-triggered advances also log.
create or replace function public.auto_advance_stage()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  parent_stage  public.stages%rowtype;
  pipeline_row  public.pipelines%rowtype;
  next_stage    public.stages%rowtype;
  all_done      boolean;
  actor_id      uuid := (select auth.uid());
  actor_label   text;
begin
  -- Only act on transitions into done=true. Undo / re-check don't advance.
  if not (old.done = false and new.done = true) then
    return new;
  end if;

  select * into parent_stage  from public.stages    where id = new.stage_id;
  select * into pipeline_row  from public.pipelines where id = parent_stage.pipeline_id;

  -- Only the active stage advances. Tasks completed on past stages don't.
  if pipeline_row.current_stage_id is distinct from parent_stage.id then
    return new;
  end if;

  -- All sibling tasks done?
  select bool_and(done) into all_done from public.tasks where stage_id = parent_stage.id;
  if not all_done then
    return new;
  end if;

  -- Mark stage complete.
  update public.stages
    set completed = true, completed_at = now()
    where id = parent_stage.id;

  -- Find the next stage by position; advance current_stage_id if one exists.
  select * into next_stage from public.stages
    where pipeline_id = parent_stage.pipeline_id
      and position > parent_stage.position
    order by position asc
    limit 1;

  if next_stage.id is not null then
    update public.pipelines
      set current_stage_id = next_stage.id, last_edited_at = now()
      where id = pipeline_row.id;
  end if;

  -- Look up the actor's display name for the activity log; fall back to email
  -- then a literal 'unknown' so the column-level NOT NULL is always satisfied.
  select coalesce(display_name, email, 'unknown') into actor_label
    from public.profiles where id = actor_id;
  if actor_label is null then
    actor_label := 'unknown';
  end if;

  insert into public.activity_events (pipeline_id, actor_id, actor_name, type, stage_name)
  values (pipeline_row.id, actor_id, actor_label, 'stage_advanced', parent_stage.name);

  return new;
end;
$$;

drop trigger if exists tasks_auto_advance_stage on public.tasks;
create trigger tasks_auto_advance_stage
after update of done on public.tasks
for each row execute function public.auto_advance_stage();


-- ============================================================================
-- 3. ENABLE ROW LEVEL SECURITY ON EVERY APP TABLE
-- ============================================================================
-- Without ENABLE ROW LEVEL SECURITY, no policies apply — every authenticated
-- user could read everything. Enable on every table; deny by default; add
-- explicit policies below.
-- ----------------------------------------------------------------------------

alter table public.profiles               enable row level security;
alter table public.workspaces             enable row level security;
alter table public.workspace_memberships  enable row level security;
alter table public.pipelines              enable row level security;
alter table public.pipeline_memberships   enable row level security;
alter table public.stages                 enable row level security;
alter table public.tasks                  enable row level security;
alter table public.stage_notes            enable row level security;
alter table public.stage_attachments      enable row level security;
alter table public.pipeline_links         enable row level security;
alter table public.channels               enable row level security;
alter table public.channel_memberships    enable row level security;
alter table public.channel_messages       enable row level security;
alter table public.activity_events        enable row level security;
alter table public.read_state             enable row level security;
alter table public.user_templates         enable row level security;
alter table public.team_invites           enable row level security;
alter table public.client_invites         enable row level security;


-- ============================================================================
-- 4. POLICIES — per table, with plain-English comments
-- ============================================================================

-- ─── profiles ───────────────────────────────────────────────────────────────

-- SELECT: a user can read their own profile, plus profiles of users who share
-- at least one workspace OR pipeline with them. Prevents enumeration of all
-- agency teams; enables display of teammate / message-author names.
create policy profiles_select on public.profiles
for select using (
  id = (select auth.uid())
  or exists (
    select 1 from public.workspace_memberships my
    join public.workspace_memberships theirs on theirs.workspace_id = my.workspace_id
    where my.user_id = (select auth.uid()) and theirs.user_id = public.profiles.id
  )
  or exists (
    select 1 from public.pipeline_memberships my
    join public.pipeline_memberships theirs on theirs.pipeline_id = my.pipeline_id
    where my.user_id = (select auth.uid()) and theirs.user_id = public.profiles.id
  )
);

-- UPDATE: a user can only update their own profile row.
-- (display_name etc. — email is synced from auth.users, not user-writable.)
create policy profiles_update on public.profiles
for update using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- INSERT: handled by handle_new_user trigger only. No client INSERTs.
-- DELETE: cascades from auth.users.delete; no direct DELETE allowed.


-- ─── workspaces ─────────────────────────────────────────────────────────────

-- SELECT: only members of the workspace see it. Clients (no workspace
-- membership) deliberately cannot enumerate workspaces — they reach pipelines
-- via the magic-link, not via workspace browsing.
create policy workspaces_select on public.workspaces
for select using (public.is_workspace_member(id));

-- INSERT: any authenticated user can create a workspace. App code inserts the
-- corresponding workspace_memberships row (role='owner') in the same
-- transaction so the creator becomes the owner.
create policy workspaces_insert on public.workspaces
for insert with check ((select auth.uid()) is not null);

-- UPDATE: only workspace owners can rename/edit.
create policy workspaces_update on public.workspaces
for update using (public.is_workspace_owner(id))
with check (public.is_workspace_owner(id));

-- DELETE: only workspace owners. Cascades to all pipelines, memberships, etc.
create policy workspaces_delete on public.workspaces
for delete using (public.is_workspace_owner(id));


-- ─── workspace_memberships ──────────────────────────────────────────────────

-- SELECT: workspace members see the membership list. Lets owners see who else
-- is on the team; lets users confirm their own membership.
create policy workspace_memberships_select on public.workspace_memberships
for select using (public.is_workspace_member(workspace_id));

-- INSERT: only the workspace owner can add new members.
create policy workspace_memberships_insert on public.workspace_memberships
for insert with check (public.is_workspace_owner(workspace_id));

-- UPDATE: only the workspace owner can change roles.
create policy workspace_memberships_update on public.workspace_memberships
for update using (public.is_workspace_owner(workspace_id))
with check (public.is_workspace_owner(workspace_id));

-- DELETE: workspace owner can remove anyone; users can remove themselves.
-- The prevent_last_workspace_owner_removal trigger blocks the final owner.
create policy workspace_memberships_delete on public.workspace_memberships
for delete using (
  public.is_workspace_owner(workspace_id) or user_id = (select auth.uid())
);


-- ─── pipelines ──────────────────────────────────────────────────────────────

-- SELECT: workspace members see all pipelines in the workspace (including
-- workspace owners by inheritance). Clients see only the pipeline they're
-- invited to as `client`. Cross-workspace queries return zero rows.
create policy pipelines_select on public.pipelines
for select using (
  public.is_workspace_member(workspace_id) or public.is_pipeline_client(id)
);

-- INSERT: only workspace owners create pipelines (matches the prototype where
-- only `session.role === 'owner'` could add pipelines).
create policy pipelines_insert on public.pipelines
for insert with check (public.is_workspace_owner(workspace_id));

-- UPDATE: any agency-side editor (owner / admin / inherited workspace owner).
-- The protect_pipeline_submission trigger gates the submitted_at/submitted_by
-- columns separately to enforce can_submit.
create policy pipelines_update on public.pipelines
for update using (public.can_edit_pipeline(id))
with check (public.can_edit_pipeline(id));

-- DELETE: only workspace owners. Cascades to stages, tasks, channels, etc.
create policy pipelines_delete on public.pipelines
for delete using (public.is_workspace_owner(workspace_id));


-- ─── pipeline_memberships ───────────────────────────────────────────────────

-- SELECT: agency members see the full membership list. Clients see only their
-- own row (so they know they're on the pipeline) but not other members.
create policy pipeline_memberships_select on public.pipeline_memberships
for select using (
  public.is_pipeline_agency_member(pipeline_id)
  or user_id = (select auth.uid())
);

-- INSERT: workspace owners can add anyone. Pipeline owners/admins (via
-- can_edit_pipeline) can add admin/member/client rows but cannot create
-- another pipeline-level owner (only workspace owners can do that — preserves
-- a clear escalation gate).
create policy pipeline_memberships_insert on public.pipeline_memberships
for insert with check (
  public.is_workspace_owner((select workspace_id from public.pipelines where id = pipeline_id))
  or (public.can_edit_pipeline(pipeline_id) and role != 'owner')
);

-- UPDATE: any can_edit_pipeline user. The enforce_admin_can_check_tasks_scope
-- trigger fires AFTER this policy and tightly restricts what admins specifically
-- are allowed to change (only can_check_tasks on member rows).
create policy pipeline_memberships_update on public.pipeline_memberships
for update using (public.can_edit_pipeline(pipeline_id))
with check (public.can_edit_pipeline(pipeline_id));

-- DELETE: workspace owner can remove anyone. Users can remove themselves.
create policy pipeline_memberships_delete on public.pipeline_memberships
for delete using (
  public.is_workspace_owner((select workspace_id from public.pipelines where id = pipeline_id))
  or user_id = (select auth.uid())
);


-- ─── stages ─────────────────────────────────────────────────────────────────

-- SELECT: agency members see all stages on the pipeline. Clients see only
-- stages flagged client_visible. (This is the parent gate for tasks; if a
-- stage is hidden from the client, every task underneath is invisible too.)
create policy stages_select on public.stages
for select using (
  public.is_pipeline_agency_member(pipeline_id)
  or (public.is_pipeline_client(pipeline_id) and client_visible = true)
);

-- INSERT/UPDATE/DELETE: only agency edit-permitted users. Clients cannot
-- create or modify stages.
create policy stages_insert on public.stages
for insert with check (public.can_edit_pipeline(pipeline_id));

create policy stages_update on public.stages
for update using (public.can_edit_pipeline(pipeline_id))
with check (public.can_edit_pipeline(pipeline_id));

create policy stages_delete on public.stages
for delete using (public.can_edit_pipeline(pipeline_id));


-- ─── tasks ──────────────────────────────────────────────────────────────────

-- SELECT: agency sees all tasks on visible stages. Clients see only tasks
-- where BOTH the task AND its parent stage are flagged client_visible
-- (defense in depth — a task "smuggled" into an internal stage stays hidden).
create policy tasks_select on public.tasks
for select using (
  exists (
    select 1 from public.stages s
    where s.id = tasks.stage_id
      and (
        public.is_pipeline_agency_member(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and tasks.client_visible = true
          and s.client_visible = true
        )
      )
  )
);

-- INSERT: agency edit-permitted users only.
create policy tasks_insert on public.tasks
for insert with check (
  exists (
    select 1 from public.stages s
    where s.id = tasks.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);

-- UPDATE: agency editors (full); OR clients on visible-tasks-on-visible-stages.
-- The enforce_client_task_update_scope trigger then restricts client UPDATEs
-- to only the `done` column. Agency UPDATEs are unrestricted at the column
-- level (they go through the row policy + can_check_pipeline_task in app code
-- for the member-without-permission case).
create policy tasks_update on public.tasks
for update using (
  exists (
    select 1 from public.stages s
    where s.id = tasks.stage_id
      and (
        public.can_edit_pipeline(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and tasks.client_visible = true
          and s.client_visible = true
        )
        or (
          -- members with can_check_tasks can flip done (column-restricted by
          -- app logic; the trigger above is client-specific, agency members
          -- are trusted to only send done changes from the UI checkbox path)
          public.can_check_pipeline_task(s.pipeline_id)
        )
      )
  )
)
with check (
  exists (
    select 1 from public.stages s
    where s.id = tasks.stage_id
      and (
        public.can_edit_pipeline(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and tasks.client_visible = true
          and s.client_visible = true
        )
        or public.can_check_pipeline_task(s.pipeline_id)
      )
  )
);

-- DELETE: agency edit-permitted users only.
create policy tasks_delete on public.tasks
for delete using (
  exists (
    select 1 from public.stages s
    where s.id = tasks.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);


-- ─── stage_notes ────────────────────────────────────────────────────────────

-- SELECT: agency sees all notes; clients see only notes flagged client_visible.
create policy stage_notes_select on public.stage_notes
for select using (
  exists (
    select 1 from public.stages s
    where s.id = stage_notes.stage_id
      and (
        public.is_pipeline_agency_member(s.pipeline_id)
        or (public.is_pipeline_client(s.pipeline_id) and stage_notes.client_visible = true)
      )
  )
);

-- INSERT: agency editors only. Clients cannot post stage notes.
create policy stage_notes_insert on public.stage_notes
for insert with check (
  exists (
    select 1 from public.stages s
    where s.id = stage_notes.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);

-- UPDATE: only the original author OR a workspace owner.
create policy stage_notes_update on public.stage_notes
for update using (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_notes.stage_id
      and public.is_workspace_owner(
        (select workspace_id from public.pipelines where id = s.pipeline_id)
      )
  )
);

-- DELETE: same gate as UPDATE.
create policy stage_notes_delete on public.stage_notes
for delete using (
  author_id = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_notes.stage_id
      and public.is_workspace_owner(
        (select workspace_id from public.pipelines where id = s.pipeline_id)
      )
  )
);


-- ─── stage_attachments ──────────────────────────────────────────────────────

-- SELECT: agency sees all; clients see only when both the attachment AND the
-- parent stage are client_visible.
create policy stage_attachments_select on public.stage_attachments
for select using (
  exists (
    select 1 from public.stages s
    where s.id = stage_attachments.stage_id
      and (
        public.is_pipeline_agency_member(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and stage_attachments.client_visible = true
          and s.client_visible = true
        )
      )
  )
);

-- INSERT: agency editors only.
create policy stage_attachments_insert on public.stage_attachments
for insert with check (
  exists (
    select 1 from public.stages s
    where s.id = stage_attachments.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);

-- UPDATE/DELETE: original uploader OR agency editor.
create policy stage_attachments_update on public.stage_attachments
for update using (
  added_by = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_attachments.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);

create policy stage_attachments_delete on public.stage_attachments
for delete using (
  added_by = (select auth.uid())
  or exists (
    select 1 from public.stages s
    where s.id = stage_attachments.stage_id
      and public.can_edit_pipeline(s.pipeline_id)
  )
);


-- ─── pipeline_links ─────────────────────────────────────────────────────────

-- SELECT: agency sees all; clients see only client_visible.
create policy pipeline_links_select on public.pipeline_links
for select using (
  public.is_pipeline_agency_member(pipeline_id)
  or (public.is_pipeline_client(pipeline_id) and client_visible = true)
);

-- INSERT: agency editors only.
create policy pipeline_links_insert on public.pipeline_links
for insert with check (public.can_edit_pipeline(pipeline_id));

-- UPDATE/DELETE: original adder OR agency editor.
create policy pipeline_links_update on public.pipeline_links
for update using (
  added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id)
);

create policy pipeline_links_delete on public.pipeline_links
for delete using (
  added_by = (select auth.uid()) or public.can_edit_pipeline(pipeline_id)
);


-- ─── channels ──────────────────────────────────────────────────────────────

-- SELECT: agency members see all channels for the pipeline; clients see only
-- channels they're explicitly added to.
create policy channels_select on public.channels
for select using (
  public.is_pipeline_agency_member(pipeline_id)
  or public.is_channel_member(id)
);

-- INSERT/UPDATE/DELETE: agency editors only. Clients cannot create or modify
-- channels. The DB-level unique partial index on (pipeline_id) WHERE
-- is_client=true also enforces one-client-channel-per-pipeline.
create policy channels_insert on public.channels
for insert with check (public.can_edit_pipeline(pipeline_id));

create policy channels_update on public.channels
for update using (public.can_edit_pipeline(pipeline_id))
with check (public.can_edit_pipeline(pipeline_id));

create policy channels_delete on public.channels
for delete using (public.can_edit_pipeline(pipeline_id));


-- ─── channel_memberships ───────────────────────────────────────────────────

-- SELECT: anyone in the channel sees who else is in it; agency members see
-- channel memberships for any channel on a pipeline they have agency access to.
create policy channel_memberships_select on public.channel_memberships
for select using (
  public.is_channel_member(channel_id)
  or public.is_pipeline_agency_member(
    (select pipeline_id from public.channels where id = channel_id)
  )
);

-- INSERT: agency editors of the parent pipeline only.
create policy channel_memberships_insert on public.channel_memberships
for insert with check (
  public.can_edit_pipeline(
    (select pipeline_id from public.channels where id = channel_id)
  )
);

-- DELETE: agency editor OR the user removing themselves.
create policy channel_memberships_delete on public.channel_memberships
for delete using (
  public.can_edit_pipeline(
    (select pipeline_id from public.channels where id = channel_id)
  )
  or user_id = (select auth.uid())
);


-- ─── channel_messages — the most security-critical table ───────────────────

-- SELECT (Layer 1 of internal-message defense in depth, see CLAUDE.md):
-- A user must be a channel member to see ANY message. Of those messages,
-- internal ones are visible only to agency-side members of the parent
-- pipeline. Clients are channel members but NOT agency members, so they fail
-- the second clause for is_internal=true rows and never see them.
--
-- This is the only layer that protects against direct API access. Layers 2
-- (server-side hard-coded is_internal=false on client posts) and 3 (render-
-- side filter on the client portal) are application code and must remain.
-- Removing any layer creates a leak vector.
create policy channel_messages_select on public.channel_messages
for select using (
  public.is_channel_member(channel_id)
  and (
    is_internal = false
    or public.is_pipeline_agency_member(
      (select pipeline_id from public.channels where id = channel_id)
    )
  )
);

-- INSERT: must be a channel member. WITH CHECK refuses is_internal=true from
-- non-agency posters — clients can post but is_internal must be false.
create policy channel_messages_insert on public.channel_messages
for insert with check (
  public.is_channel_member(channel_id)
  and author_id = (select auth.uid())
  and (
    is_internal = false
    or public.is_pipeline_agency_member(
      (select pipeline_id from public.channels where id = channel_id)
    )
  )
);

-- UPDATE: not allowed (messages are immutable in the prototype).
-- DELETE: not allowed in MVP (matches prototype — no delete UI).


-- ─── activity_events ───────────────────────────────────────────────────────

-- SELECT: agency members of the pipeline only. Clients do not see activity
-- feed entries (avoids leaking team/agency operational signal).
create policy activity_events_select on public.activity_events
for select using (public.is_pipeline_agency_member(pipeline_id));

-- INSERT: agency members can append. The auto_advance_stage trigger uses
-- security definer so client-triggered stage_advanced events are also
-- inserted (the trigger bypasses this RLS check by design).
create policy activity_events_insert on public.activity_events
for insert with check (
  public.is_pipeline_agency_member(pipeline_id)
  and actor_id = (select auth.uid())
);

-- UPDATE/DELETE: not allowed (append-only audit log).


-- ─── read_state ────────────────────────────────────────────────────────────

-- SELECT/INSERT/UPDATE/DELETE: a user can only see and write their own rows.
-- (Cascades on auth.users delete.)
create policy read_state_select on public.read_state
for select using (user_id = (select auth.uid()));

create policy read_state_insert on public.read_state
for insert with check (user_id = (select auth.uid()));

create policy read_state_update on public.read_state
for update using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy read_state_delete on public.read_state
for delete using (user_id = (select auth.uid()));


-- ─── user_templates ────────────────────────────────────────────────────────

-- All ops gated to the template owner. Templates are personal, not shared.
create policy user_templates_select on public.user_templates
for select using (owner_id = (select auth.uid()));

create policy user_templates_insert on public.user_templates
for insert with check (owner_id = (select auth.uid()));

create policy user_templates_update on public.user_templates
for update using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy user_templates_delete on public.user_templates
for delete using (owner_id = (select auth.uid()));


-- ─── team_invites ──────────────────────────────────────────────────────────

-- SELECT: pipeline editors see invites for their pipeline. The invitee
-- themselves does NOT need direct SELECT — they accept via a security definer
-- function called by the magic-link landing (added in 3.4 alongside auth).
create policy team_invites_select on public.team_invites
for select using (public.can_edit_pipeline(pipeline_id));

-- INSERT: pipeline editors create invites.
create policy team_invites_insert on public.team_invites
for insert with check (
  public.can_edit_pipeline(pipeline_id)
  and invited_by = (select auth.uid())
);

-- UPDATE: not directly. Acceptance flows through accept_team_invite() which
-- is added in 3.4. DELETE is the explicit "revoke" path.
create policy team_invites_delete on public.team_invites
for delete using (public.can_edit_pipeline(pipeline_id));


-- ─── client_invites ────────────────────────────────────────────────────────

-- Same shape as team_invites — pipeline editors see / create / revoke;
-- acceptance via accept_client_invite() added in 3.4.
create policy client_invites_select on public.client_invites
for select using (public.can_edit_pipeline(pipeline_id));

create policy client_invites_insert on public.client_invites
for insert with check (
  public.can_edit_pipeline(pipeline_id)
  and invited_by = (select auth.uid())
);

create policy client_invites_delete on public.client_invites
for delete using (public.can_edit_pipeline(pipeline_id));


-- ============================================================================
-- 5. STORAGE BUCKETS + POLICIES
-- ============================================================================
-- Two private buckets. Files are accessed via signed URLs — public URLs are
-- never used. Path encoding embeds pipeline_id (and stage_id for attachments)
-- so policies can extract the parent pipeline cheaply via storage.foldername.
-- ----------------------------------------------------------------------------

-- Bucket: stage_attachments
--   path convention: {pipeline_id}/{stage_id}/{attachment_id}.{ext}
insert into storage.buckets (id, name, public)
values ('stage_attachments', 'stage_attachments', false)
on conflict (id) do nothing;

-- Bucket: pipeline_files
--   path convention: {pipeline_id}/links/{link_id}.{ext}
insert into storage.buckets (id, name, public)
values ('pipeline_files', 'pipeline_files', false)
on conflict (id) do nothing;


-- ─── stage_attachments storage policies ────────────────────────────────────

-- SELECT: agency members of the pipeline can read; clients can read only when
-- the corresponding stage_attachments row is client_visible AND the parent
-- stage is also client_visible. Joining storage_path = name resolves the
-- stage attachment row and lets us check both visibility flags.
create policy stage_attachments_storage_select on storage.objects
for select using (
  bucket_id = 'stage_attachments'
  and exists (
    select 1
    from public.stage_attachments sa
    join public.stages s on s.id = sa.stage_id
    where sa.storage_path = name
      and (
        public.is_pipeline_agency_member(s.pipeline_id)
        or (
          public.is_pipeline_client(s.pipeline_id)
          and sa.client_visible = true
          and s.client_visible = true
        )
      )
  )
);

-- INSERT: the corresponding row may not exist yet at upload time, so we
-- extract pipeline_id from the path and check edit permission. The app
-- creates the stage_attachments row right after the upload completes.
create policy stage_attachments_storage_insert on storage.objects
for insert with check (
  bucket_id = 'stage_attachments'
  and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
);

-- DELETE: original uploader OR agency editor.
create policy stage_attachments_storage_delete on storage.objects
for delete using (
  bucket_id = 'stage_attachments'
  and exists (
    select 1
    from public.stage_attachments sa
    join public.stages s on s.id = sa.stage_id
    where sa.storage_path = name
      and (
        sa.added_by = (select auth.uid())
        or public.can_edit_pipeline(s.pipeline_id)
      )
  )
);


-- ─── pipeline_files storage policies ───────────────────────────────────────

-- SELECT: agency members can read; clients can read only when client_visible.
create policy pipeline_files_storage_select on storage.objects
for select using (
  bucket_id = 'pipeline_files'
  and exists (
    select 1
    from public.pipeline_links pl
    where pl.storage_path = name
      and (
        public.is_pipeline_agency_member(pl.pipeline_id)
        or (public.is_pipeline_client(pl.pipeline_id) and pl.client_visible = true)
      )
  )
);

-- INSERT: extract pipeline_id from the path, check edit permission.
create policy pipeline_files_storage_insert on storage.objects
for insert with check (
  bucket_id = 'pipeline_files'
  and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
);

-- DELETE: original adder OR agency editor.
create policy pipeline_files_storage_delete on storage.objects
for delete using (
  bucket_id = 'pipeline_files'
  and exists (
    select 1
    from public.pipeline_links pl
    where pl.storage_path = name
      and (
        pl.added_by = (select auth.uid())
        or public.can_edit_pipeline(pl.pipeline_id)
      )
  )
);


-- ============================================================================
-- 6. VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- After `npx supabase db push`, run these in the Dashboard SQL editor to
-- confirm policies are in place and tables are RLS-enabled. They are NOT part
-- of the migration; they're documentation for the verification step.
-- ----------------------------------------------------------------------------
--
-- Confirm RLS enabled on every public table:
-- select schemaname, tablename, rowsecurity
-- from pg_tables where schemaname = 'public' order by tablename;
-- (Every row should have rowsecurity = true.)
--
-- Confirm policies exist for every table:
-- select schemaname, tablename, policyname, cmd
-- from pg_policies where schemaname = 'public'
-- order by tablename, cmd;
--
-- Confirm storage buckets exist and are private:
-- select id, name, public from storage.buckets
-- where id in ('stage_attachments', 'pipeline_files');
--
-- Confirm storage policies exist:
-- select policyname, cmd from pg_policies
-- where schemaname = 'storage' and tablename = 'objects'
-- and policyname like '%_storage_%' order by policyname;
--
-- ============================================================================
-- End of RLS migration. Run the two-browser test (see CLAUDE.md → Security
-- model → The two-browser test) before advancing to 3.4.
-- ============================================================================
