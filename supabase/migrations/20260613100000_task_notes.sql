-- ============================================================================
-- TN-1: task_notes — task-scoped multi-author notes
--
-- New surface: a "Notes" section in the task detail panel where BOTH
-- agency team members AND clients (via portal) can post multi-line text
-- notes against a specific task. The author + workspace owners/admins
-- can delete; everyone in the task's audience can read.
--
-- Differs from stage_notes (which inspired the shape):
--   * stage_notes scopes to stages; task_notes scopes to tasks.
--   * stage_notes has a client_visible flag (agency authored, agency
--     chooses what clients see). task_notes has NO client_visible
--     flag — everyone who can view the task can view all notes on it.
--     Visibility is fully derived from the parent task's visibility
--     (which itself derives from stage.client_visible AND
--     task.client_visible for clients).
--   * stage_notes is INSERTed directly through RLS WITH CHECK; task_notes
--     INSERT/UPDATE/DELETE all flow through SECURITY DEFINER RPCs so
--     the RLS recursion pattern that surfaced in PI-followup-2 (insert
--     triggers a SELECT that walks back through helpers reading the
--     same table) can't recur here.
--
-- WHY DENORMALIZE workspace_id + pipeline_id:
-- Two columns the caller never sets directly (they're derived inside
-- the create RPC from p_task_id → stage_id → pipeline_id → workspace_id).
-- Denormalized into the row so SELECT policies don't need to join through
-- tasks → stages → pipelines to check audience, which is the same join
-- shape that caused the recursion in PI-followup-2. Triggers (not
-- writers) enforce the denormalization stays correct.
-- ============================================================================


-- ─── 1. Table + constraints ───────────────────────────────────────────────

create table public.task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (length(content) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- (task_id, created_at) — newest-at-bottom listing per task. Forward
-- order; the UI flips to chronological for the "newer notes near input"
-- pattern, but the index covers both directions.
create index task_notes_task_created_idx
  on public.task_notes (task_id, created_at);

-- (author_id) — supports the "your notes" lookup used by delete authz
-- and future per-user activity surfaces.
create index task_notes_author_idx
  on public.task_notes (author_id);


-- ─── 2. RLS ───────────────────────────────────────────────────────────────

alter table public.task_notes enable row level security;

-- SELECT: anyone who can see the parent task.
--   * Agency-side viewers (workspace owner/admin OR pipeline owner/admin/member)
--     see every task → every task_note.
--   * Clients (pipeline_memberships with role='client') see only tasks
--     where task.client_visible AND parent stage.client_visible —
--     they see task_notes on those tasks only.
-- The helper composition here is the same one used by the channels +
-- channel_messages select policies, so behavior is symmetric with
-- existing surfaces. Both helpers are SECURITY DEFINER so the
-- composition is safe to call from a SELECT policy.
create policy task_notes_select on public.task_notes
for select using (
  public.is_pipeline_agency_member(pipeline_id)
  or (
    public.is_pipeline_client(pipeline_id)
    and exists (
      select 1
      from public.tasks t
      join public.stages s on s.id = t.stage_id
      where t.id = task_notes.task_id
        and t.client_visible = true
        and s.client_visible = true
    )
  )
);

-- NO INSERT/UPDATE/DELETE policies. Writes go through the SECURITY
-- DEFINER RPCs below. PostgREST .insert / .delete on task_notes will
-- always 42501 — by design.


-- ─── 3. create_task_note RPC ──────────────────────────────────────────────

create or replace function public.create_task_note(
  p_task_id uuid,
  p_content text
)
returns public.task_notes
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  resolved_pipeline_id uuid;
  resolved_workspace_id uuid;
  trimmed text := btrim(coalesce(p_content, ''));
  task_visible_to_client boolean;
  inserted public.task_notes;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if length(trimmed) < 1 then
    raise exception 'Note content cannot be empty' using errcode = '22023';
  end if;
  if length(trimmed) > 5000 then
    raise exception 'Note content exceeds 5000 characters' using errcode = '22023';
  end if;

  -- Resolve task → stage → pipeline → workspace + client-visibility.
  -- Single round-trip; SECURITY DEFINER means no RLS gate on this read.
  select s.pipeline_id, p.workspace_id,
         (t.client_visible and s.client_visible)
    into resolved_pipeline_id, resolved_workspace_id, task_visible_to_client
  from public.tasks t
  join public.stages s on s.id = t.stage_id
  join public.pipelines p on p.id = s.pipeline_id
  where t.id = p_task_id;

  if resolved_pipeline_id is null then
    raise exception 'Task not found' using errcode = '22023';
  end if;

  -- Authz: viewer must be agency-side OR a client on a task they can see.
  -- Same gate the SELECT policy uses; inlined here so the create
  -- pre-flight matches the read post-flight.
  if not public.is_pipeline_agency_member(resolved_pipeline_id) and not (
    public.is_pipeline_client(resolved_pipeline_id) and task_visible_to_client
  ) then
    raise exception 'Not authorized to post notes on this task'
      using errcode = '42501';
  end if;

  insert into public.task_notes (
    task_id, pipeline_id, workspace_id, author_id, content
  )
  values (
    p_task_id, resolved_pipeline_id, resolved_workspace_id, actor, trimmed
  )
  returning * into inserted;

  return inserted;
end;
$$;

grant execute on function public.create_task_note(uuid, text) to authenticated;

comment on function public.create_task_note(uuid, text) is
  'TN-1: SECURITY DEFINER RPC. Posts a task_note as the calling user. Authz mirrors the SELECT policy (agency members + clients-on-visible-tasks). Resolves and denormalizes workspace_id + pipeline_id from the task. Returns the inserted row.';


-- ─── 4. delete_task_note RPC ──────────────────────────────────────────────

create or replace function public.delete_task_note(
  p_note_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  note_author uuid;
  note_workspace uuid;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select tn.author_id, tn.workspace_id
    into note_author, note_workspace
  from public.task_notes tn
  where tn.id = p_note_id;

  if note_author is null then
    raise exception 'Note not found' using errcode = 'P0002';
  end if;

  -- Either: actor authored the note, OR actor is a workspace owner/admin
  -- on the note's workspace. Pipeline-scoped owner/admin status does NOT
  -- grant note-delete (only workspace-scope) — keeps the moderation
  -- surface tight; pipeline admins can still delete their own notes.
  if actor = note_author then
    -- author may delete
    null;
  elsif exists (
    select 1 from public.workspace_memberships
    where workspace_id = note_workspace
      and user_id = actor
      and role in ('owner', 'admin')
  ) then
    -- workspace owner/admin may delete
    null;
  else
    raise exception 'Not authorized to delete this note'
      using errcode = '42501';
  end if;

  delete from public.task_notes tn
  where tn.id = p_note_id;

  return true;
end;
$$;

grant execute on function public.delete_task_note(uuid) to authenticated;

comment on function public.delete_task_note(uuid) is
  'TN-1: SECURITY DEFINER RPC. Deletes a task_note if the caller is its author OR a workspace owner/admin on the parent workspace. Pipeline-scoped admins cannot delete others notes by design.';


-- ─── 5. Verification (run after apply) ────────────────────────────────────
-- Apply path is the Supabase Dashboard SQL Editor. Copy each block
-- separately to verify.
--
-- A. Table + indexes + RLS enabled.
--    select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename = 'task_notes';
--    select indexname from pg_indexes
--    where schemaname = 'public' and tablename = 'task_notes';
--
-- B. SELECT policy present, no INSERT/UPDATE/DELETE policies.
--    select polname, polcmd from pg_policy
--    where polrelid = 'public.task_notes'::regclass;
--
-- C. Both RPCs are SECURITY DEFINER + search_path = ''.
--    select proname, prosecdef, proconfig
--    from pg_proc
--    where proname in ('create_task_note', 'delete_task_note');
--
-- D. End-to-end via /api/task-notes/create + /api/task-notes/delete.
