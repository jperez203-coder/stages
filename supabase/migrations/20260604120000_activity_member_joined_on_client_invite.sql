-- ============================================================================
-- Dashboard Activity feed: wire `member_joined` writer on client invite accept
-- ============================================================================
-- Followup to the 4b-3-e batch. The dashboard Activity query at
-- src/app/w/(workspace)/[slug]/page.tsx ~lines 210-225 selects up to
-- 5 cross-pipeline events filtered to four types:
--
--   member_joined, stage_advanced, pipeline_submitted, pipeline_created
--
-- Audit on 2026-05-25 showed only `stage_advanced` had a writer (the
-- existing auto_advance_stage trigger from 20260509120000_rls_policies.sql).
-- The other three types were queried-but-never-written — schema there,
-- no INSERT site anywhere in the code.
--
-- Per the per-event triage:
--
--   * member_joined        → SMALL CLEAN ADDITION. THIS MIGRATION.
--   * pipeline_created     → SMALL CLEAN ADDITION but actor=workspace
--                            owner/admin = Jordan in solo case →
--                            filtered by dashboard's .neq("actor_id",
--                            user.id) → invisible to him today.
--                            DROPPED until multi-member workspaces
--                            become a real use case (Phase 6 Team plan).
--   * pipeline_submitted   → REQUIRES the unbuilt submit-pipeline
--                            feature first (no RPC, no UI exists;
--                            only legacy prototype references and a
--                            protective RLS trigger). FLAGGED as a
--                            future slice, not wired.
--
-- ── WHAT THIS MIGRATION DOES ────────────────────────────────────────
--
-- CREATE OR REPLACE on public.accept_client_invite. The function body
-- is byte-for-byte identical to the version in
-- supabase/migrations/20260514120000_client_invites_align.sql EXCEPT
-- for one new local var declaration and one new block right after the
-- pipeline_memberships INSERT — both pure additions, no edits to any
-- existing line. The signature, return shape, security context,
-- search_path, grants, and every existing validation/raise/insert
-- statement are unchanged.
--
-- Added:
--   1. `actor_label text;` in the DECLARE block.
--   2. After the membership insert:
--        select coalesce(display_name, email, 'unknown') into actor_label
--          from public.profiles where id = actor;
--        if actor_label is null then
--          actor_label := 'unknown';
--        end if;
--        insert into public.activity_events
--          (pipeline_id, actor_id, actor_name, type, stage_name)
--        values (inv.pipeline_id, actor, actor_label, 'member_joined', null);
--
-- The actor_label resolution (coalesce profiles.display_name → email
-- → 'unknown') mirrors the auto_advance_stage trigger's pattern from
-- 20260509120000_rls_policies.sql lines 459-463 verbatim. Reusing the
-- existing pattern keeps any future "show avatars in the activity
-- feed" enhancement consistent across event types.
--
-- stage_name = null because this isn't a stage event. The column is
-- nullable in the activity_events table (initial schema confirmed);
-- it's only set for stage_advanced rows.
--
-- ── WHY CLIENT-INVITE PATH ONLY (workspace-invite EXCLUDED) ─────────
--
-- accept_workspace_invite inserts into workspace_memberships, NOT
-- pipeline_memberships — a teammate joining a workspace gains access
-- to all the workspace's pipelines, not a specific one. The
-- activity_events.pipeline_id column is NOT NULL (initial schema
-- enforces it), so there's no single pipeline to attach a
-- workspace-join event to without either:
--   (a) noisy fan-out: one event per pipeline in the workspace, or
--   (b) schema change: allow activity_events.pipeline_id IS NULL
--       for workspace-scoped events + dashboard query union.
--
-- Both are out of scope for this slice. The much more common solo-
-- agency flow is client-portal invite acceptance (Casey joins
-- Pipeline A), which IS scoped to one pipeline cleanly. Workspace-
-- invite acceptances simply won't show in the Activity feed; revisit
-- if/when an agency reports it missing.
--
-- ── VISIBILITY FOR SOLO JORDAN ─────────────────────────────────────
--
-- Dashboard query filters .neq("actor_id", user.id) — the viewer's
-- own actions don't show in their own feed. For member_joined the
-- actor is the JOINING CLIENT (Casey, or any other portal invitee),
-- never Jordan. So Jordan WILL see these events. This is the one
-- writer of the three triaged that actually makes his feed non-empty
-- today (alongside stage_advanced events Casey triggers when she
-- toggles client_visible tasks done).
--
-- ── WHAT IS NOT TOUCHED ─────────────────────────────────────────────
--
--   * Dashboard query at page.tsx ~210-238 (the .neq filter stays).
--   * src/components/dashboard/ActivityCard.tsx (renderer unchanged).
--   * activity_events_select / activity_events_insert RLS policies.
--   * activity_events table schema (no new columns).
--   * accept_workspace_invite (excluded — see above).
--   * Any other RPC, trigger, or app code.
--
-- ┌─ DOWN PLAN
-- │   Re-apply the original accept_client_invite from migration
-- │   20260514120000_client_invites_align.sql (lines 214-302) via
-- │   CREATE OR REPLACE. The added DECLARE line and INSERT block
-- │   simply disappear; no schema state to revert.
-- │
-- │   Optional: purge member_joined rows written under the new writer
-- │   if you want a clean slate (rare; orphan events are harmless):
-- │     delete from public.activity_events where type = 'member_joined';
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


create or replace function public.accept_client_invite(invite_token uuid)
returns json language plpgsql security definer
set search_path = ''
as $$
declare
  inv         public.client_invites%rowtype;
  pip_id      uuid;
  pip_name    text;
  ws_name     text;
  ws_slug     text;
  actor       uuid := (select auth.uid());
  actor_email text;
  actor_label text;  -- NEW: resolved display_name / email / 'unknown' for activity_events.actor_name
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select email into actor_email from auth.users where id = actor;
  if actor_email is null then
    raise exception 'Authenticated user not found' using errcode = '42501';
  end if;

  -- Security definer bypasses RLS so the invitee (not yet a pipeline
  -- member) can read the row for validation. The token in the URL is
  -- what authorises the read.
  select * into inv from public.client_invites where token = invite_token;
  if not found then
    raise exception 'Invite not found or has been revoked'
      using errcode = '22023';
  end if;

  if inv.accepted_at is not null then
    raise exception 'This invite has already been accepted'
      using errcode = '23505';
  end if;

  if inv.expires_at <= now() then
    raise exception 'This invite has expired'
      using errcode = '22023';
  end if;

  -- Email match (case-insensitive). Security gate against forwarded links.
  if lower(inv.email) != lower(actor_email) then
    raise exception 'This invite was sent to a different email address'
      using errcode = '42501';
  end if;

  -- Already-a-member check. PK on pipeline_memberships (pipeline_id,
  -- user_id) means at most one row — if it exists the caller already has
  -- some role on this pipeline (agency-side OR client). Clearer error
  -- than letting the PK collision raise unique_violation cryptically.
  if exists (
    select 1 from public.pipeline_memberships
    where pipeline_id = inv.pipeline_id and user_id = actor
  ) then
    raise exception 'You already have access to this pipeline'
      using errcode = '23505';
  end if;

  -- Defensive — cascade-delete on pipelines should remove invites, but
  -- catch the edge case.
  select p.id, p.name, w.name, w.slug
    into pip_id, pip_name, ws_name, ws_slug
  from public.pipelines p
  join public.workspaces w on w.id = p.workspace_id
  where p.id = inv.pipeline_id;
  if pip_id is null then
    raise exception 'Pipeline no longer exists' using errcode = '22023';
  end if;

  -- Atomic: insert membership + mark invite accepted in one transaction.
  -- can_submit and can_check_tasks default to false (defined on
  -- pipeline_memberships in the initial schema) — clients have neither
  -- by design.
  insert into public.pipeline_memberships (pipeline_id, user_id, role)
  values (inv.pipeline_id, actor, 'client');

  -- NEW: Activity feed writer for `member_joined`. actor_label resolution
  -- mirrors the auto_advance_stage trigger from 20260509120000_rls_policies.sql
  -- lines 459-463 verbatim — coalesce display_name → email → 'unknown'.
  -- stage_name = null because this isn't a stage event.
  select coalesce(display_name, email, 'unknown') into actor_label
    from public.profiles where id = actor;
  if actor_label is null then
    actor_label := 'unknown';
  end if;

  insert into public.activity_events (pipeline_id, actor_id, actor_name, type, stage_name)
  values (inv.pipeline_id, actor, actor_label, 'member_joined', null);

  update public.client_invites
  set accepted_at = now(), accepted_by = actor
  where token = invite_token;

  return json_build_object(
    'pipeline_id',    pip_id,
    'pipeline_name',  pip_name,
    'workspace_name', ws_name,
    'workspace_slug', ws_slug
  );
end;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- (a) Confirm the function definition includes the new INSERT.
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'accept_client_invite';
--   -- Expected: body contains
--   --   "insert into public.activity_events"
--   --   "member_joined"
--   -- AND still contains all original validations + the
--   --   "insert into public.pipeline_memberships" line.
--
-- (b) Confirm grants survived the CREATE OR REPLACE (they should — only
--     a body change, not a re-declaration).
--   select proname, has_function_privilege('authenticated', oid, 'EXECUTE') as auth_can_call
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'accept_client_invite';
--   -- Expected: 1 row, auth_can_call = true.
--
-- (c) Sanity: no schema change to activity_events.
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'activity_events'
--   order by ordinal_position;
--   -- Expected: identical to pre-migration state.
-- ============================================================================
