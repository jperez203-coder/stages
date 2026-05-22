-- ============================================================================
-- Phase 4a step 6 (backend) — enforce_member_task_update_scope trigger
-- ============================================================================
-- Closes a server-side column-gating gap surfaced during step 6 planning:
-- the tightened tasks_update RLS (20260521120000) gates members at the ROW
-- level (assignee_id = auth.uid()) but NOT at the column level. The existing
-- enforce_client_task_update_scope trigger restricts CLIENTS to flipping
-- `done` only; there's no equivalent for agency MEMBERS.
--
-- THE GAP IT CLOSES: a member who is the assignee of task X could call
--   supabase.from('tasks').update({ client_visible: true }).eq('id', X)
-- directly — RLS permits it (assignee = uid), and the task leaks into the
-- client portal. Same shape attack on stage_id (drag-move via API),
-- assignee_id (covered defensively here even though WITH CHECK also blocks
-- it), pos_x/pos_y, position, note, completed_at, completed_by.
--
-- WHAT IT DOES: BEFORE UPDATE trigger on tasks. For non-owner/non-admin
-- agency callers (members), reject the UPDATE if any column OTHER than
-- the step-6 spec's allowed set (`done`, `title`, `description`, `deadline`)
-- has changed. Owner/admin pass through (they're the canonical edit role).
-- Clients pass through here too — they're governed by the existing
-- enforce_client_task_update_scope trigger which fires earlier in
-- alphabetical order ('enforce_c' < 'enforce_m').
--
-- ALLOWED FOR MEMBERS:
--   done         — toggle complete (existing checkbox path + step-6 panel)
--   title        — inline rename in step-6 panel
--   description  — multiline description in step-6 panel
--   deadline     — set / change due date in step-6 panel (assignee can
--                  set their own task's deadline per the locked spec)
--
-- REJECTED FOR MEMBERS:
--   assignee_id      — reassignment is owner/admin only
--   client_visible   — visibility to client portal = owner/admin only
--   stage_id         — drag cross-stage = owner/admin only
--   position         — drag-reorder = owner/admin only
--   pos_x, pos_y     — legacy free-position columns; no UI; locked down
--   note             — legacy column; no UI; locked down
--   completed_at     — system-managed via set_task_completion_metadata
--   completed_by     — system-managed via set_task_completion_metadata
--
-- TRIGGER ORDERING (alphabetical on BEFORE UPDATE):
--   tasks_enforce_client_update_scope  (c < m)  — checks if client first
--   tasks_enforce_member_update_scope  (m < s)  — this one
--   tasks_set_completion_metadata      (s)      — fills completed_at/by
--
-- So a client UPDATE hits the client trigger and raises before the member
-- trigger runs. An owner/admin UPDATE passes both enforce_* triggers (each
-- has an early-return guard for can_edit_pipeline). A member UPDATE hits
-- the client trigger (passes early-return since they're not a client),
-- then the member trigger does the real check.
--
-- ┌─ DOWN PLAN
-- │   drop trigger if exists tasks_enforce_member_update_scope on public.tasks;
-- │   drop function if exists public.enforce_member_task_update_scope();
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================

create or replace function public.enforce_member_task_update_scope()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  parent_pipeline_id uuid;
begin
  -- Resolve parent pipeline (needed for permission helpers).
  select pipeline_id into parent_pipeline_id
  from public.stages where id = new.stage_id;

  -- Early returns:
  --   * owner/admin can mutate any column — they're the canonical edit role
  --   * clients have their own stricter trigger (enforce_client_task_update_scope)
  --     which runs before this one; we don't double-handle here
  if public.can_edit_pipeline(parent_pipeline_id) then
    return new;
  end if;
  if public.is_pipeline_client(parent_pipeline_id) then
    return new;
  end if;

  -- At this point: the caller is an agency member (not owner/admin, not
  -- client) updating a task. Reject any change to columns outside the
  -- step-6 spec's allowed set.
  if new.assignee_id     is distinct from old.assignee_id
     or new.client_visible is distinct from old.client_visible
     or new.stage_id      is distinct from old.stage_id
     or new.position      is distinct from old.position
     or new.pos_x         is distinct from old.pos_x
     or new.pos_y         is distinct from old.pos_y
     or new.note          is distinct from old.note
     or new.completed_at  is distinct from old.completed_at
     or new.completed_by  is distinct from old.completed_by then
    raise exception 'Members can only edit title, description, deadline, and done on their assigned tasks.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_enforce_member_update_scope on public.tasks;
create trigger tasks_enforce_member_update_scope
before update on public.tasks
for each row execute function public.enforce_member_task_update_scope();


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Trigger exists + fires before update:
--   select tgname, tgtype, proname from pg_trigger t
--   join pg_proc p on p.oid = t.tgfoid
--   where tgrelid = 'public.tasks'::regclass
--   order by tgname;
--   Expected: row for tasks_enforce_member_update_scope with proname
--   = enforce_member_task_update_scope.
--
-- 2. Member CAN flip done on their own task (allowed):
--   (impersonate a member who is assignee of task X)
--   update public.tasks set done = true where id = '<X>';
--   Expected: 1 row updated.
--
-- 3. Member CAN rename their own task's title (allowed):
--   update public.tasks set title = 'New name' where id = '<X>';
--   Expected: 1 row updated.
--
-- 4. Member CAN set deadline on their own task (allowed):
--   update public.tasks set deadline = now() + interval '7 days' where id = '<X>';
--   Expected: 1 row updated.
--
-- 5. Member CANNOT flip client_visible on their own task (REJECTED):
--   update public.tasks set client_visible = true where id = '<X>';
--   Expected: ERROR 42501 'Members can only edit title, description, deadline, and done...'
--
-- 6. Member CANNOT directly write completed_at (REJECTED):
--   update public.tasks set completed_at = now() where id = '<X>';
--   Expected: ERROR 42501.
--
-- 7. Member CANNOT change stage_id (REJECTED):
--   update public.tasks set stage_id = '<other-stage>' where id = '<X>';
--   Expected: ERROR 42501.
--
-- 8. Owner/admin can change any column (early return):
--   (impersonate workspace owner)
--   update public.tasks set client_visible = true, stage_id = '<other-stage>'
--   where id = '<X>';
--   Expected: 1 row updated, no error.
--
-- 9. Client trigger still wins for clients (alphabetical order):
--   (impersonate a pipeline client on a client_visible task)
--   update public.tasks set title = 'Hacked' where id = '<X>';
--   Expected: ERROR from enforce_client_task_update_scope (raised before
--   this trigger fires).
-- ============================================================================
