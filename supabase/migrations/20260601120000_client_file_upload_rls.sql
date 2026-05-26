-- ============================================================================
-- Phase 4b-3-d (client portal file upload): grant clients INSERT access
-- to pipeline_links + the pipeline_files storage bucket
-- ============================================================================
-- Up to and including 4b-3-c, the portal Files tab was READ-ONLY for
-- clients. This migration extends INSERT to client viewers — they can
-- now upload files into pipelines they're a client of, with three
-- locked-by-RLS constraints:
--
--   1. kind = 'file' only — clients cannot add URL-kind link rows
--      (separate v1.1 discussion; risk asymmetry favors blocking).
--   2. client_visible = true — clients cannot insert covert /
--      hidden-from-self rows. Every client upload is automatically
--      visible to themselves AND to the agency.
--   3. added_by = auth.uid() — clients cannot impersonate an agency
--      uploader on a row they're inserting.
--
-- ── DEFENSE IN DEPTH (matches the existing project pattern) ─────────
--
-- Each of the three rules above is enforced TWICE — once in the
-- policy's WITH CHECK and once in a BEFORE INSERT trigger. This is
-- intentional:
--   * Policy WITH CHECK is the first line of defense. PostgREST
--     evaluates it on every INSERT. Failure → 403.
--   * Trigger is the second line of defense. If a future maintainer
--     accidentally relaxes a policy clause (e.g. extending the
--     policy for some new use case), the trigger still raises an
--     exception at the table level with a named error message.
--
-- Mirrors `enforce_client_task_update_scope` and
-- `enforce_admin_can_check_tasks_scope` from migration
-- 20260509120000 — any rule a client must not violate gets BOTH a
-- policy clause AND a trigger. A new maintainer reading either one
-- understands the constraint without having to cross-reference.
--
-- DO NOT remove the trigger thinking the policy clause is sufficient.
-- DO NOT remove the policy clause thinking the trigger is sufficient.
-- Both layers protect against a different class of regression.
--
-- ── WHAT CLIENTS STILL CANNOT DO (untouched by this migration) ──────
--
--   * UPDATE existing pipeline_links rows (label edits, visibility
--     toggle, mime_type changes, etc.) — pipeline_links_update policy
--     unchanged. Clients are still UPDATE-blocked.
--   * INSERT URL-kind rows — the kind='file' constraint blocks this.
--   * INSERT into pipelines they're not a 'client' member of —
--     is_pipeline_client(pipeline_id) returns false for those.
--   * Read or download agency-only files (client_visible=false) — the
--     pipeline_links_select and pipeline_files_storage_select
--     policies are unchanged.
--   * Delete OTHER people's files — pipeline_links_delete still
--     requires added_by = auth.uid() OR can_edit_pipeline.
--
-- Clients CAN delete their own uploaded files via the
-- added_by = auth.uid() branch of the existing pipeline_links_delete
-- policy (and the matching storage_delete policy). This is a
-- FREE consequence of letting them insert with added_by = auth.uid();
-- no policy change required.
--
-- Implication logged as v1.1: there is no audit trail when a client
-- uploads a file and immediately deletes it (the metadata row is
-- gone, the bytes are gone). If a customer ever asks for "show me
-- what client X has previously shared and removed," that's a
-- soft-delete + audit-log feature — deliberately deferred and not in
-- this migration. Documented in PROGRESS.md when the matching UI ships.
--
-- ── ROLE OVERLAP EDGE CASE ─────────────────────────────────────────
--
-- A user who is BOTH an agency member AND a client of the same
-- pipeline (rare — usually only during testing, or when an agency
-- owner adds themselves as a "client" of their own pipeline) will be
-- caught by `is_pipeline_client(...)` in the trigger and have the
-- three client constraints applied on INSERT. Their separate agency
-- capabilities (UPDATE, DELETE of others' rows, etc.) are unaffected.
--
-- This matches `enforce_client_task_update_scope` (migration
-- 20260509120000), which also doesn't carve out overlap users.
-- Consistency with the existing pattern was the deciding factor. If a
-- legitimate overlap-user use case ever surfaces, the fix is to add
-- `and not is_pipeline_agency_member(new.pipeline_id)` to the trigger
-- check; that's a single-line follow-up migration.
--
-- ── WHY THIS IS PRIVACY-SENSITIVE ──────────────────────────────────
--
-- This is the FIRST migration that grants any client write access
-- beyond toggling task `done` flags + posting to their own channel.
-- It opens INSERT on two surfaces (pipeline_links table + the
-- pipeline_files storage bucket) simultaneously. The privacy test
-- plan from the scoping report (Tests 1-7) MUST be run before any
-- UI ships. Tests 2, 3, and 4 are STOP gates — if any of them
-- doesn't raise, do not advance to UI work.
--
-- ┌─ DOWN PLAN
-- │
-- │   drop trigger if exists pipeline_links_enforce_client_insert_scope
-- │     on public.pipeline_links;
-- │   drop function if exists
-- │     public.enforce_client_pipeline_link_insert_scope();
-- │
-- │   drop policy if exists pipeline_files_storage_insert
-- │     on storage.objects;
-- │   create policy pipeline_files_storage_insert on storage.objects
-- │   for insert with check (
-- │     bucket_id = 'pipeline_files'
-- │     and public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
-- │   );
-- │
-- │   drop policy if exists pipeline_links_insert on public.pipeline_links;
-- │   create policy pipeline_links_insert on public.pipeline_links
-- │   for insert with check (public.can_edit_pipeline(pipeline_id));
-- │
-- │   -- Any rows clients inserted under the broader policy stay in
-- │   -- place after revert (the added_by column records who, but the
-- │   -- role distinction is contextual — they look like agency rows
-- │   -- post-revert). If you need to purge them:
-- │   --   delete from public.pipeline_links pl
-- │   --   where exists (
-- │   --     select 1 from public.pipeline_memberships pm
-- │   --     where pm.user_id = pl.added_by
-- │   --       and pm.pipeline_id = pl.pipeline_id
-- │   --       and pm.role = 'client'
-- │   --   );
-- │   -- Then orphan-cleanup the corresponding storage bytes from
-- │   -- the pipeline_files bucket (paths come from the deleted rows'
-- │   -- storage_path column — capture before the DELETE).
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Change A: extend pipeline_links_insert policy ──────────────────────
-- Adds an OR branch for clients. Agency behavior (first branch) is
-- byte-for-byte identical to migration 20260509120000. Each clause on
-- the new client branch is load-bearing:
--   * is_pipeline_client(pipeline_id) — caller has role='client'
--     membership for THIS pipeline (blocks cross-pipeline inserts).
--   * kind = 'file' — blocks URL-kind rows (no client-added links).
--   * added_by = auth.uid() — blocks impersonation of agency uploads.
--   * client_visible = true — blocks covert / hidden-from-self rows.

drop policy if exists pipeline_links_insert on public.pipeline_links;

create policy pipeline_links_insert on public.pipeline_links
for insert with check (
  public.can_edit_pipeline(pipeline_id)
  or (
    public.is_pipeline_client(pipeline_id)
    and kind = 'file'
    and added_by = (select auth.uid())
    and client_visible = true
  )
);


-- ─── 2. Change B: extend pipeline_files_storage_insert policy ──────────────
-- Same OR-extension on the storage.objects policy. The pipeline UUID
-- is extracted from the first path segment via storage.foldername
-- (matches the existing extraction trick from migration
-- 20260509120000); a client uploading to a path scoped to a pipeline
-- they're NOT a client of fails is_pipeline_client(...).
--
-- Path convention (locked in buildStoragePath, src/lib/build-storage-path.ts):
--   {pipeline_id}/{uuid}.{ext}
-- The first folder segment IS the pipeline UUID and IS the gate.
-- The client UI MUST use buildStoragePath() — never accept a path
-- from user input — or this policy doesn't help. (Already enforced in
-- the agency upload helper; the forked portal upload helper will
-- inherit the same call.)

drop policy if exists pipeline_files_storage_insert on storage.objects;

create policy pipeline_files_storage_insert on storage.objects
for insert with check (
  bucket_id = 'pipeline_files'
  and (
    public.can_edit_pipeline(((storage.foldername(name))[1])::uuid)
    or public.is_pipeline_client(((storage.foldername(name))[1])::uuid)
  )
);


-- ─── 3. Change C: BEFORE INSERT trigger on pipeline_links ──────────────────
-- Enforces the same three client constraints as the policy WITH CHECK
-- above. See the file header for the defense-in-depth rationale —
-- this trigger is intentionally redundant with the policy and MUST
-- NOT be removed in any future "cleanup" pass.
--
-- security definer + set search_path = '' matches the pattern of
-- enforce_client_task_update_scope and enforce_admin_can_check_tasks_scope
-- (migration 20260509120000).

create or replace function public.enforce_client_pipeline_link_insert_scope()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  -- Only applies to client viewers; agency inserts pass through
  -- (is_pipeline_client returns false for them, so the body is
  -- skipped and NEW is returned unchanged). See header for the role-
  -- overlap edge case (rare; matches existing pattern).
  if public.is_pipeline_client(new.pipeline_id) then
    if new.client_visible is distinct from true then
      raise exception 'Clients must upload with client_visible = true.';
    end if;
    if new.kind is distinct from 'file' then
      raise exception 'Clients can only upload files (kind = file), not links.';
    end if;
    if new.added_by is distinct from (select auth.uid()) then
      raise exception 'Clients cannot impersonate another uploader.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pipeline_links_enforce_client_insert_scope
  on public.pipeline_links;

create trigger pipeline_links_enforce_client_insert_scope
before insert on public.pipeline_links
for each row execute function public.enforce_client_pipeline_link_insert_scope();


-- ============================================================================
-- 4. VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- Paste these into the Supabase Dashboard SQL editor AFTER applying
-- the migration. Each one is a structural check confirming the
-- migration landed as written; the privacy tests (Tests 1-7 from the
-- scoping report) come next and exercise actual behavior.
--
-- ─── (a) pipeline_links_insert now has the OR-extended WITH CHECK ──────────
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check_expr
--   from pg_policy
--   where polrelid = 'public.pipeline_links'::regclass
--     and polname = 'pipeline_links_insert';
--   -- Expected: 1 row. with_check_expr mentions BOTH
--   -- 'can_edit_pipeline' AND 'is_pipeline_client' AND 'client_visible'
--   -- AND 'added_by' AND a kind = 'file' check.
--
-- ─── (b) pipeline_files_storage_insert now has the OR-extended check ───────
--   select polname, pg_get_expr(polwithcheck, polrelid) as with_check_expr
--   from pg_policy
--   where polrelid = 'storage.objects'::regclass
--     and polname = 'pipeline_files_storage_insert';
--   -- Expected: 1 row. with_check_expr mentions BOTH
--   -- 'can_edit_pipeline' AND 'is_pipeline_client'.
--
-- ─── (c) Trigger function exists and is security-definer ───────────────────
--   select proname, prosecdef, proconfig
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'enforce_client_pipeline_link_insert_scope';
--   -- Expected: 1 row. prosecdef = true.
--   -- proconfig contains 'search_path='.
--
-- ─── (d) Trigger is attached to pipeline_links and enabled ─────────────────
--   select tgname, tgtype, tgenabled
--   from pg_trigger
--   where tgrelid = 'public.pipeline_links'::regclass
--     and tgname = 'pipeline_links_enforce_client_insert_scope';
--   -- Expected: 1 row. tgenabled = 'O' (origin — fires normally).
--
-- ─── (e) Unchanged policies are still present (regression check) ───────────
--   select polname
--   from pg_policy
--   where polrelid = 'public.pipeline_links'::regclass
--   order by polname;
--   -- Expected 4 rows: pipeline_links_delete, pipeline_links_insert,
--   -- pipeline_links_select, pipeline_links_update.
--
--   select polname
--   from pg_policy
--   where polrelid = 'storage.objects'::regclass
--     and polname like 'pipeline_files_storage_%'
--   order by polname;
--   -- Expected 3 rows: pipeline_files_storage_delete,
--   -- pipeline_files_storage_insert, pipeline_files_storage_select.
--   -- (DELETE and SELECT policies were NOT touched by this migration.)
-- ============================================================================
