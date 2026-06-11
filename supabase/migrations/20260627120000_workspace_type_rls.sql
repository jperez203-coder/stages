-- ============================================================================
-- Stages — workspace_type RLS hardening (WT-6)
-- ============================================================================
-- Defense-in-depth at the database layer. WT-4 already gates the Model C
-- rules at the API + RPC layer (the primary defense); this migration
-- adds RESTRICTIVE RLS policies + a workspaces.type immutability trigger
-- so that a compromised client, a future surface bypassing the WT-4
-- gates, or an out-of-band PostgREST caller cannot land a row that the
-- product rules say shouldn't exist.
--
-- ── WHY RESTRICTIVE, NOT MODIFY-EXISTING-PERMISSIVE ─────────────────────
-- Each table here already has a PERMISSIVE INSERT policy that gates on
-- caller role (owner/admin on the workspace or pipeline). Modifying those
-- to ALSO check workspace.type would touch every policy independently —
-- six separate CREATE OR REPLACE statements, each with their own audit
-- trail. RESTRICTIVE policies AND with the PERMISSIVE policies (PG RLS
-- combines them with AND for restrictive + OR for permissive), so a
-- single RESTRICTIVE per table layers cleanly on top of whatever the
-- existing policy already does:
--
--   row passes the existing PERMISSIVE check  ──┐
--                                                ├── AND ── INSERT allowed
--   row passes the new RESTRICTIVE check     ──┘
--
-- The existing PERMISSIVE policies stay byte-for-byte unchanged.
--
-- ── SECURITY DEFINER PATHS ARE UNAFFECTED ───────────────────────────────
-- create_workspace_with_owner, accept_workspace_invite, accept_client_invite,
-- init_workspace_billing all run as SECURITY DEFINER. SECURITY DEFINER
-- bypasses RLS entirely (both PERMISSIVE and RESTRICTIVE). So:
--
--   * The initial owner-membership row that create_workspace_with_owner
--     inserts on a personal workspace continues to work.
--   * accept_workspace_invite still inserts workspace_memberships rows
--     on agency workspaces (it rejects personal targets in WT-4).
--   * accept_client_invite still inserts pipeline_memberships role='client'
--     rows on agency pipelines (same WT-4 reject for personal).
--
-- Direct PostgREST writes are the ONLY surface RESTRICTIVE policies gate
-- here — which is exactly the threat model (compromised browser, custom
-- client, future surface that bypasses the WT-4 API/RPC gates).
--
-- ── WORKSPACES.TYPE IMMUTABILITY ─────────────────────────────────────────
-- A BEFORE UPDATE trigger raises if the type column is being changed.
-- Personal → agency conversion (and the reverse) requires more product
-- thought — billing implications, member-onboarding flow, etc. — and is
-- intentionally out of scope until a future WT-7 design.
--
-- Unlike RLS, triggers fire for ALL writes including SECURITY DEFINER
-- paths. None of the existing RPCs UPDATE workspaces.type (they only
-- INSERT it via the create_workspace_with_owner path), so locking the
-- column entirely doesn't break any legitimate code path. When in-place
-- conversion ships, the future RPC will need to disable + re-enable
-- this trigger inside its transaction.
--
-- ── DOWN PLAN ──────────────────────────────────────────────────────────
-- │
-- │   -- 1. Drop the RESTRICTIVE policies.
-- │   drop policy if exists workspace_invites_insert_not_personal on public.workspace_invites;
-- │   drop policy if exists workspace_memberships_insert_not_personal on public.workspace_memberships;
-- │   drop policy if exists client_invites_insert_not_personal on public.client_invites;
-- │   drop policy if exists pipeline_memberships_insert_client_not_personal on public.pipeline_memberships;
-- │   drop policy if exists channels_insert_client_not_personal on public.channels;
-- │
-- │   -- 2. Drop the immutability trigger + function.
-- │   drop trigger if exists workspaces_prevent_type_change on public.workspaces;
-- │   drop function if exists public.prevent_workspace_type_change();
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. workspace_invites_insert_not_personal ─────────────────────────────
-- Direct PostgREST INSERTs to workspace_invites happen in the team
-- settings UI (src/app/w/(workspace)/[slug]/settings/team/page.tsx —
-- the InviteForm.submit handler runs supabase.from('workspace_invites')
-- .insert(...) under the user's JWT). The WT-4 API route gate at
-- /api/invites/send catches the EMAIL side of personal workspaces, but
-- the INSERT itself happens before that route is called. This
-- RESTRICTIVE policy blocks the INSERT at the source.
create policy workspace_invites_insert_not_personal on public.workspace_invites
as restrictive
for insert
with check (
  (select w.type from public.workspaces w where w.id = workspace_id) <> 'personal'
);

comment on policy workspace_invites_insert_not_personal on public.workspace_invites is
  'WT-6: restrictive policy blocking workspace_invites INSERTs when target workspace.type=personal. Layered AND with the existing workspace_invites_insert PERMISSIVE policy. Personal workspaces never need member invites (Model C).';


-- ─── 2. workspace_memberships_insert_not_personal ─────────────────────────
-- workspace_memberships INSERTs are unusual on the direct PostgREST path —
-- the new-workspace owner row goes through create_workspace_with_owner
-- (SECURITY DEFINER), and accept_workspace_invite (also SECURITY DEFINER)
-- handles the invite-acceptance case. Both bypass RLS so this RESTRICTIVE
-- policy does NOT block them. It only blocks the (rare today, possible
-- tomorrow) direct INSERT path — e.g. a future admin UI that adds a
-- pre-vetted teammate without an invite token.
create policy workspace_memberships_insert_not_personal on public.workspace_memberships
as restrictive
for insert
with check (
  (select w.type from public.workspaces w where w.id = workspace_id) <> 'personal'
);

comment on policy workspace_memberships_insert_not_personal on public.workspace_memberships is
  'WT-6: restrictive policy blocking workspace_memberships INSERTs when target workspace.type=personal. SECURITY DEFINER RPCs (create_workspace_with_owner for the initial owner row; accept_workspace_invite for invitee rows) bypass this — only direct PostgREST is affected.';


-- ─── 3. client_invites_insert_not_personal ────────────────────────────────
-- The /api/client-invites/send route inserts client_invites under the
-- caller's JWT (RLS applies). WT-4's route gate rejects personal
-- workspaces before the INSERT runs, but a direct PostgREST caller
-- (bypassing the route) would land the row. This RESTRICTIVE policy
-- catches that path.
create policy client_invites_insert_not_personal on public.client_invites
as restrictive
for insert
with check (
  (
    select w.type
    from public.pipelines p
    join public.workspaces w on w.id = p.workspace_id
    where p.id = pipeline_id
  ) <> 'personal'
);

comment on policy client_invites_insert_not_personal on public.client_invites is
  'WT-6: restrictive policy blocking client_invites INSERTs when the target pipelines parent workspace.type=personal. Personal workspaces have no client portal surface (Model C).';


-- ─── 4. pipeline_memberships_insert_client_not_personal ───────────────────
-- accept_client_invite (SECURITY DEFINER) handles the legitimate path
-- and is unaffected. Direct PostgREST INSERTs that set role='client'
-- on a personal-workspace pipeline are blocked. Agency-role INSERTs
-- (owner/admin/member) are untouched — those happen for legitimate
-- agency teammate flows that may direct-insert today.
--
-- NOTE: the check is scoped to role='client' specifically. We don't
-- block role='owner'/'admin'/'member' on personal workspaces because
-- the owner row exists by construction (created by
-- create_workspace_with_owner) and additional admin/member rows on a
-- personal pipeline are already blocked indirectly by the existing
-- workspace_memberships restriction (only the workspace owner can
-- add pipeline-level admins/members, and on a personal workspace
-- there's only ever one owner). Restricting role='client' is the
-- narrowest cut that closes the Model C gap.
create policy pipeline_memberships_insert_client_not_personal on public.pipeline_memberships
as restrictive
for insert
with check (
  role <> 'client'
  or (
    select w.type
    from public.pipelines p
    join public.workspaces w on w.id = p.workspace_id
    where p.id = pipeline_id
  ) <> 'personal'
);

comment on policy pipeline_memberships_insert_client_not_personal on public.pipeline_memberships is
  'WT-6: restrictive policy blocking pipeline_memberships INSERTs with role=client when the target pipelines parent workspace.type=personal. SECURITY DEFINER accept_client_invite bypasses this — only direct PostgREST is affected.';


-- ─── 5. channels_insert_client_not_personal ───────────────────────────────
-- Client channels (is_client=true) on personal workspaces have no
-- purpose — there's no client to be a member of them. Blocks the direct
-- PostgREST INSERT that would land such a row. Internal (non-client)
-- channel INSERTs are untouched.
create policy channels_insert_client_not_personal on public.channels
as restrictive
for insert
with check (
  is_client = false
  or (
    select w.type
    from public.pipelines p
    join public.workspaces w on w.id = p.workspace_id
    where p.id = pipeline_id
  ) <> 'personal'
);

comment on policy channels_insert_client_not_personal on public.channels is
  'WT-6: restrictive policy blocking channels INSERTs where is_client=true and the target pipelines parent workspace.type=personal. Personal workspaces have no client portal surface.';


-- ─── 6. workspaces.type immutability — trigger function ───────────────────
-- BEFORE UPDATE trigger. Raises if NEW.type IS DISTINCT FROM OLD.type.
-- Type change is intentionally out of scope until a future in-place
-- conversion design lands. The trigger fires for ALL writes including
-- SECURITY DEFINER (unlike RLS), so a future RPC implementing in-place
-- conversion will need to ALTER TABLE ... DISABLE TRIGGER inside its
-- transaction (and re-enable on the way out, or rely on the
-- transaction-local scope).
--
-- SQLSTATE: 0A000 (feature_not_supported) is the cleanest fit —
-- communicates "this is intentionally not supported yet" rather than
-- "you did something wrong."
create or replace function public.prevent_workspace_type_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type is distinct from old.type then
    raise exception
      'Workspace type is immutable. In-place conversion (personal <-> agency) is not yet supported.'
      using errcode = '0A000';
  end if;
  return new;
end;
$$;

comment on function public.prevent_workspace_type_change() is
  'WT-6: BEFORE UPDATE trigger function that locks workspaces.type after creation. In-place conversion deferred to a future WT-7 / WISHLIST design.';


-- ─── 7. workspaces.type immutability — trigger ────────────────────────────
-- `BEFORE UPDATE OF type` scopes the trigger to UPDATEs that touch the
-- type column. UPDATEs to other columns (name, slug, ai_consent) don't
-- fire the trigger — saves a no-op trigger call on every workspace
-- rename or AI-consent edit.
drop trigger if exists workspaces_prevent_type_change on public.workspaces;

create trigger workspaces_prevent_type_change
before update of type on public.workspaces
for each row
execute function public.prevent_workspace_type_change();


-- ============================================================================
-- VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- (a) Confirm the five RESTRICTIVE policies exist with the right
--     `permissive='RESTRICTIVE'` flag.
--   select schemaname, tablename, policyname, permissive, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and policyname in (
--       'workspace_invites_insert_not_personal',
--       'workspace_memberships_insert_not_personal',
--       'client_invites_insert_not_personal',
--       'pipeline_memberships_insert_client_not_personal',
--       'channels_insert_client_not_personal'
--     )
--   order by tablename, policyname;
--   -- Expected: 5 rows. permissive column reads 'RESTRICTIVE' for all
--   -- (Supabase / PostgreSQL surface the column value as 'PERMISSIVE'
--   -- or 'RESTRICTIVE'). cmd reads 'INSERT' for all.
--
-- (b) Confirm the trigger + function exist with the right shape.
--   select t.tgname, t.tgtype, p.proname, p.prosecdef
--   from pg_trigger t
--   join pg_proc p on p.oid = t.tgfoid
--   where t.tgname = 'workspaces_prevent_type_change';
--   -- Expected: 1 row. proname = prevent_workspace_type_change.
--
-- (c) Smoke test — agency workspace INSERT regression (must SUCCEED).
--     Run AS A LOGGED-IN USER who owns an AGENCY workspace; substitute
--     <agency-ws-id> with the real id.
--   begin;
--   insert into public.workspace_invites (workspace_id, email, role, invited_by)
--   values ('<agency-ws-id>'::uuid, 'wt6-smoke@example.com', 'member', auth.uid());
--   -- Expected: 1 row inserted.
--   rollback;
--
-- (d) Smoke test — personal workspace direct INSERT (must FAIL).
--     Run AS A LOGGED-IN USER who owns a PERSONAL workspace.
--   begin;
--   insert into public.workspace_invites (workspace_id, email, role, invited_by)
--   values ('<personal-ws-id>'::uuid, 'wt6-smoke@example.com', 'member', auth.uid());
--   -- Expected: ERROR 42501 'new row violates row-level security policy'.
--   rollback;
--
-- (e) Smoke test — client_invites direct INSERT on personal pipeline (must FAIL).
--     Substitute <personal-pipeline-id> with the id of a pipeline whose
--     parent workspace is personal.
--   begin;
--   insert into public.client_invites (pipeline_id, email, invited_by)
--   values ('<personal-pipeline-id>'::uuid, 'wt6-client@example.com', auth.uid());
--   -- Expected: ERROR 42501 RLS denial.
--   rollback;
--
-- (f) Smoke test — type immutability (must FAIL).
--     Run as the owner of a personal workspace.
--   update public.workspaces set type = 'agency' where id = '<personal-ws-id>'::uuid;
--   -- Expected: ERROR 0A000 'Workspace type is immutable ...'
--
-- (g) Regression — SECURITY DEFINER path still works. Two attempts:
--     (g1) create_workspace_with_owner('WT6 Smoke Personal', 'personal')
--           — must SUCCEED for any user who doesn't already own a
--           personal workspace, and FAIL with 23505 ('only one personal
--           workspace') for one who does.
--     (g2) Re-run the agency-workspace create — should SUCCEED unchanged.
--   -- Cleanup any test rows: delete public.workspaces where name like 'WT6 Smoke%';
-- ============================================================================
