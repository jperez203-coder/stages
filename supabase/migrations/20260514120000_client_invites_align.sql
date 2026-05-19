-- ============================================================================
-- Phase 3.4 (step 7a) — client_invites alignment + accept RPCs
-- ============================================================================
-- Brings the existing client_invites table in line with workspace_invites'
-- shape, then adds the two RPCs the accept flow needs. Confirmed zero rows
-- pre-migration; token type conversion is risk-free.
--
-- Existing client_invites pre-migration:
--   token         text primary key
--   pipeline_id   uuid not null references pipelines(id) on delete cascade
--   client_email  text not null
--   invited_by    uuid references auth.users(id) on delete set null
--   created_at    timestamptz not null default now()
--   accepted      boolean not null default false
--   accepted_at   timestamptz
--
-- Five structural changes:
--   1. Drop `accepted` boolean — redundant with `accepted_at IS NULL`.
--      Single source of truth pattern (same as workspace_invites).
--   2. Rename `client_email` → `email` for symmetry with workspace_invites.
--      Lets the accept-page UI and RPC code stay structurally parallel
--      across both invite types.
--   3. Convert `token` from text to uuid + default `gen_random_uuid()`.
--      Symmetry with workspace_invites; native PG generator; URL-safe
--      format consistency.
--   4. Add `expires_at` (30-day default — longer than agency's 7 days
--      because clients are often less responsive than internal teammates,
--      and the CLAUDE.md client-session spec also runs 30 days).
--   5. Add `accepted_by` for audit trail (same shape as workspace_invites).
--
-- Plus a functional index on lower(email) for future case-insensitive
-- "is this email already invited?" queries.
--
-- RLS policies from 20260509120000 are untouched — they reference only
-- `pipeline_id` (gated by `can_edit_pipeline`), which doesn't change.
-- Same authz model as before: workspace owners + pipeline owners +
-- pipeline admins can SELECT / INSERT / DELETE invites for the pipeline;
-- workspace admins without pipeline-level standing cannot. Intentional —
-- matches the existing per-pipeline access pattern.
--
-- Two RPCs added (mirror workspace_invites pattern):
--   * get_client_invite_preview(invite_token) — public (anon + authn).
--     Returns invite + pipeline + workspace + inviter info for the
--     /portal/accept/[token] landing page's state-driven render.
--   * accept_client_invite(invite_token) — authenticated only. Atomically
--     validates token + email match + single-use + expiry + not-already-
--     pipeline-member, inserts pipeline_memberships row with role='client',
--     marks accepted_at + accepted_by. Returns pipeline + workspace info
--     for post-accept routing to /portal/[pipeline_id].
--
-- ┌─ DOWN PLAN
-- │
-- │   drop function if exists public.accept_client_invite(uuid);
-- │   drop function if exists public.get_client_invite_preview(uuid);
-- │   drop index if exists public.client_invites_email_idx;
-- │
-- │   alter table public.client_invites alter column token drop default;
-- │   alter table public.client_invites
-- │     alter column token set data type text using token::text;
-- │
-- │   alter table public.client_invites drop column if exists accepted_by;
-- │   alter table public.client_invites drop column if exists expires_at;
-- │   alter table public.client_invites rename column email to client_email;
-- │
-- │   alter table public.client_invites
-- │     add column accepted boolean not null default false;
-- │   update public.client_invites set accepted = (accepted_at is not null);
-- │
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Schema changes ────────────────────────────────────────────────────

-- 1.1 Drop redundant boolean
alter table public.client_invites drop column accepted;

-- 1.2 Rename for symmetry with workspace_invites
alter table public.client_invites rename column client_email to email;

-- 1.3 TTL — 30 days for client invites (vs 7 for agency)
alter table public.client_invites
  add column expires_at timestamptz not null default (now() + interval '30 days');

-- 1.4 Audit trail
alter table public.client_invites
  add column accepted_by uuid references auth.users(id) on delete set null;

-- 1.5 Token type conversion (zero-rows-confirmed → safe)
alter table public.client_invites
  alter column token set data type uuid using token::uuid;
alter table public.client_invites
  alter column token set default gen_random_uuid();

-- 1.6 Case-insensitive email lookup index
create index client_invites_email_idx
  on public.client_invites (lower(email));


-- ─── 2. RPC: get_client_invite_preview ─────────────────────────────────────
-- Public (anon + authenticated). Returns invite details for the
-- /portal/accept/[token] landing page so the UI can render state-dependent
-- content before the recipient signs in. Same four statuses as the
-- workspace_invites equivalent: 'pending', 'expired', 'accepted',
-- 'not_found' (covers token-missing, revoked, AND pipeline-deleted).
--
-- inviter_is_active_pipeline_member is the client-invite analogue of
-- workspace_invites' inviter_is_active_member. Checks whether the inviter
-- still has agency-side access to this pipeline (workspace owner OR
-- pipeline owner/admin/member). When false, the UI can render the
-- "Former member" suffix.
create or replace function public.get_client_invite_preview(invite_token uuid)
returns json language plpgsql security definer stable
set search_path = ''
as $$
declare
  inv             public.client_invites%rowtype;
  pip_id          uuid;
  pip_name        text;
  ws_name         text;
  ws_slug         text;
  inviter_display text;
  inviter_email   text;
  inviter_active  boolean := false;
  resolved_status text;
begin
  select * into inv from public.client_invites where token = invite_token;
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  if inv.accepted_at is not null then
    resolved_status := 'accepted';
  elsif inv.expires_at <= now() then
    resolved_status := 'expired';
  else
    resolved_status := 'pending';
  end if;

  -- Look up pipeline + parent workspace. ON DELETE CASCADE on pipeline_id
  -- should mean an invite never outlives its pipeline, but defensive in
  -- case of a concurrent delete.
  select p.id, p.name, w.name, w.slug
    into pip_id, pip_name, ws_name, ws_slug
  from public.pipelines p
  join public.workspaces w on w.id = p.workspace_id
  where p.id = inv.pipeline_id;
  if pip_id is null then
    return json_build_object('status', 'not_found');
  end if;

  -- Inviter info + active-member check
  if inv.invited_by is not null then
    select coalesce(p.display_name, u.email, 'Unknown'), u.email
      into inviter_display, inviter_email
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = inv.invited_by;

    -- "Active" = inviter still has agency-side access to the pipeline.
    -- Mirrors is_pipeline_agency_member's logic but for an arbitrary
    -- user_id (not just auth.uid()), so inlined rather than using the
    -- helper.
    inviter_active := exists (
      select 1
      from public.pipelines p
      where p.id = inv.pipeline_id
        and (
          exists (
            select 1 from public.workspace_memberships wm
            where wm.workspace_id = p.workspace_id
              and wm.user_id = inv.invited_by
              and wm.role = 'owner'
          )
          or exists (
            select 1 from public.pipeline_memberships pm
            where pm.pipeline_id = p.id
              and pm.user_id = inv.invited_by
              and pm.role in ('owner', 'admin', 'member')
          )
        )
    );
  end if;

  return json_build_object(
    'status',                            resolved_status,
    'pipeline_id',                       pip_id,
    'pipeline_name',                     pip_name,
    'workspace_name',                    ws_name,
    'workspace_slug',                    ws_slug,
    'email',                             inv.email,
    'inviter_display_name',              inviter_display,
    'inviter_email',                     inviter_email,
    'inviter_is_active_pipeline_member', inviter_active,
    'expires_at',                        inv.expires_at,
    'accepted_at',                       inv.accepted_at
  );
end;
$$;


-- ─── 3. RPC: accept_client_invite ──────────────────────────────────────────
-- Authenticated only. Atomic transaction: validates → inserts pipeline
-- membership → marks invite accepted. Either everything commits or
-- nothing does.
--
-- Distinct SQLSTATEs per failure mode for client branching:
--   42501 — not authenticated, auth user missing, OR email mismatch
--   22023 — not found / revoked, expired, OR pipeline gone
--   23505 — already accepted (single-use), OR caller already has a
--           pipeline_memberships row for this pipeline (the PK on
--           (pipeline_id, user_id) means one role max — they can't be
--           both agency-side AND client)
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


-- ─── 4. Grants ─────────────────────────────────────────────────────────────
-- Preview is callable by anyone (anon + authenticated) — the landing page
-- needs to render before the recipient has signed in. Accept requires
-- authentication; the function rejects null auth.uid().
grant execute on function public.get_client_invite_preview(uuid)
  to anon, authenticated;
grant execute on function public.accept_client_invite(uuid)
  to authenticated;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Column structure post-migration:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'client_invites'
--   order by ordinal_position;
--   Expected: token (uuid, gen_random_uuid), pipeline_id, email,
--   invited_by, created_at, accepted_at, expires_at, accepted_by.
--   No `accepted` column, no `client_email` column.
--
-- 2. RLS policies survived:
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'client_invites'
--   order by cmd, policyname;
--   Expected: 3 policies — _select / _insert / _delete. No _update.
--
-- 3. RPCs exist with right security context:
--   select proname, prosecdef, provolatile,
--          pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('get_client_invite_preview', 'accept_client_invite')
--   order by proname;
--   Expected: 2 rows, prosecdef = true, preview volatile = 's',
--   accept volatile = 'v', args = 'invite_token uuid' each.
--
-- 4. Grants:
--   select grantee, routine_name, privilege_type
--   from information_schema.role_routine_grants
--   where routine_schema = 'public'
--     and routine_name in ('get_client_invite_preview',
--                          'accept_client_invite')
--   order by routine_name, grantee;
--   Expected: preview → anon + authenticated; accept → authenticated only.
--
-- 5. Index check:
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'client_invites'
--   order by indexname;
--   Expected: client_invites_email_idx (lower(email)),
--   client_invites_pipeline_idx (pipeline_id), client_invites_pkey (token).
--
-- 6. Functional smoke — create + preview + accept under impersonation.
--    Use Test Workspace 4b's pipeline_id and jordan+phasea as the
--    eventual accepter (replace UUIDs accordingly).
--
--    a) Seed a pending invite:
--       insert into public.client_invites (pipeline_id, email, invited_by)
--       values (
--         '<pipeline-id-in-test-workspace-4b>'::uuid,
--         'jordan+phasea@printzly.com',
--         '<jordanperez1270-uuid>'::uuid
--       )
--       returning token;
--    -- Copy the returned token for the next steps.
--
--    b) Preview (anon):
--       select public.get_client_invite_preview('<token>'::uuid);
--    -- Expected JSON: status='pending', pipeline_name, workspace_name,
--    -- workspace_slug, email='jordan+phasea@printzly.com', inviter info.
--
--    c) Accept as wrong user (jordanperez1270 — email mismatch):
--       begin;
--       set local role authenticated;
--       set local request.jwt.claims to
--         '{"sub":"<jordanperez1270-uuid>","role":"authenticated"}';
--       select public.accept_client_invite('<token>'::uuid);
--       rollback;
--    -- Expected: ERROR 42501 "different email address".
--
--    d) Accept as correct user (jordan+phasea):
--       begin;
--       set local role authenticated;
--       set local request.jwt.claims to
--         '{"sub":"<phasea-uuid>","role":"authenticated"}';
--       select public.accept_client_invite('<token>'::uuid);
--       rollback;
--    -- Expected: JSON with pipeline_id + workspace_slug. Rollback wipes
--    -- the change so the invite stays pending for further tests.
--
--    e) Already-a-member case: jordan+phasea is ALREADY a member of
--       test-workspace-4b from earlier verification — but at the
--       WORKSPACE level (workspace_memberships), not the pipeline level.
--       So this test should still SUCCEED (not raise "already a member")
--       because the check is for pipeline_memberships, which is empty
--       for jordan+phasea against any pipeline in 4b.
--    -- To test the "already a member" path, the SQL setup would need
--    -- to seed a pipeline_memberships row first then attempt accept.
--    -- Optional.
-- ============================================================================
