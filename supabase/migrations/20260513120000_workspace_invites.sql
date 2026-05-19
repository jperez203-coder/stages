-- ============================================================================
-- Phase 3.4 (step 6a) — workspace_invites schema + helper + RPCs
-- ============================================================================
-- Foundation for the agency invite flow. Three pieces:
--
--   1. New `workspace_invites` table — UUID tokens (which double as PKs and
--      URL slugs at /accept-invite/[token]), per-row role + email + invited_by,
--      7-day TTL default, accepted_at + accepted_by for the audit trail.
--      ON DELETE CASCADE from workspaces (delete a workspace, pending invites
--      go with it — the "revoked / no longer valid" UX collapses into this).
--      ON DELETE SET NULL on invited_by and accepted_by (auth.users deletion
--      doesn't cascade-delete the invite history).
--
--   2. New helper `is_workspace_owner_or_admin(workspace_id)` — replaces
--      `is_workspace_owner` in the workspace_invites RLS policies per the
--      step 6 plan's locked decision. Lets workspace admins invite (subject
--      to role-cap-of-admin enforced by the table's CHECK constraint), which
--      matches how small-agency owners actually delegate routine onboarding.
--
--   3. Two RPCs:
--      * get_workspace_invite_preview(invite_token) — public (anon + authn).
--        Returns invite details for the /accept-invite/[token] landing page.
--        Status is one of 'pending' / 'expired' / 'accepted' / 'not_found'.
--        Bypasses RLS via security definer so the invitee (who isn't yet a
--        member of the workspace) can see the preview.
--      * accept_workspace_invite(invite_token) — authenticated only. Atomic:
--        validates the token, verifies the caller's email matches the invite
--        (case-insensitive — the security gate against forwarded links),
--        inserts workspace_memberships row, marks accepted_at. Single
--        transaction so partial failures roll back cleanly.
--
-- Token = primary key. We chose UUID over nanoid for native PG support and
-- avoided having a separate `id`/`token` pair to keep things simple — for our
-- use case (single token per invite, regenerate-via-revoke-and-recreate),
-- one column suffices.
--
-- Email column stores the case the inviter typed (for display) but is
-- matched case-insensitively everywhere. There's a functional index on
-- lower(email) for future "is this email already invited?" queries.
--
-- ┌─ DOWN PLAN (manual rollback recipe)
-- │
-- │   drop function if exists public.accept_workspace_invite(uuid);
-- │   drop function if exists public.get_workspace_invite_preview(uuid);
-- │   drop policy if exists workspace_invites_delete on public.workspace_invites;
-- │   drop policy if exists workspace_invites_insert on public.workspace_invites;
-- │   drop policy if exists workspace_invites_select on public.workspace_invites;
-- │   drop table if exists public.workspace_invites;
-- │   drop function if exists public.is_workspace_owner_or_admin(uuid);
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Helper: is_workspace_owner_or_admin ────────────────────────────────
-- Same pattern as the existing is_workspace_member / is_workspace_owner
-- helpers — security definer + stable + search_path = '' for RLS-safe use
-- inside policies without infinite recursion. Owner OR admin (workspace_
-- memberships role); excludes plain 'member' since members can't invite.
create or replace function public.is_workspace_owner_or_admin(ws_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_memberships
    where workspace_id = ws_id
      and user_id = (select auth.uid())
      and role in ('owner', 'admin')
  );
$$;


-- ─── 2. workspace_invites table ────────────────────────────────────────────
create table public.workspace_invites (
  token         uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references public.workspaces(id) on delete cascade,
  email         text        not null,
  role          text        not null check (role in ('admin', 'member')),
  invited_by    uuid        references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '7 days'),
  accepted_at   timestamptz,
  accepted_by   uuid        references auth.users(id) on delete set null
);

create index workspace_invites_workspace_id_idx
  on public.workspace_invites (workspace_id);
create index workspace_invites_email_idx
  on public.workspace_invites (lower(email));

comment on table public.workspace_invites is
  'Pending and historical workspace invites. token doubles as PK and URL slug. '
  'Accepted invites are retained for audit; revoked invites are hard-deleted.';


-- ─── 3. RLS ────────────────────────────────────────────────────────────────
alter table public.workspace_invites enable row level security;

-- SELECT: workspace owners + admins see the invite list for their workspace.
-- Members never see invites (no business need; reduces surface area).
-- Invitees never read this table directly — they hit the security-definer
-- get_workspace_invite_preview RPC, which bypasses RLS to surface the invite
-- by token even though the invitee isn't a workspace member yet.
create policy workspace_invites_select on public.workspace_invites
for select using (public.is_workspace_owner_or_admin(workspace_id));

-- INSERT: workspace owners + admins. invited_by must be the caller (so an
-- admin can't fake an invite as if it came from the owner). The CHECK on
-- the role column already restricts what role values are accepted ('admin'
-- or 'member') — owner-invites are blocked at the schema level.
create policy workspace_invites_insert on public.workspace_invites
for insert with check (
  public.is_workspace_owner_or_admin(workspace_id)
  and invited_by = (select auth.uid())
);

-- DELETE: workspace owners + admins. Revoke = hard delete (no soft-delete
-- column; if you can see it, you can revoke it).
create policy workspace_invites_delete on public.workspace_invites
for delete using (public.is_workspace_owner_or_admin(workspace_id));

-- No UPDATE policy — accepted_at and accepted_by are set ONLY by the
-- accept_workspace_invite RPC (security definer). Any direct UPDATE attempt
-- (from app code or SQL) fails the default-deny.


-- ─── 4. RPC: get_workspace_invite_preview ──────────────────────────────────
-- Returns the invite details the /accept-invite/[token] landing page needs
-- to render its state-dependent UI. Public (anon + authenticated) so the
-- page can render BEFORE the user signs in.
--
-- Returns JSON with one of four statuses + the supporting fields:
--   * 'pending'    — invite is open. Returns all fields.
--   * 'expired'    — past expires_at. Returns workspace + inviter fields so
--                    the recipient knows what they missed.
--   * 'accepted'   — single-use already exercised. Returns workspace fields
--                    so the page can say "you've already accepted this; sign
--                    in to access [workspace]."
--   * 'not_found'  — token doesn't exist (never created, or revoked via
--                    hard delete, or workspace was deleted and cascaded).
--                    Collapses revoked + workspace-deleted into one UX.
--
-- inviter_is_active_member is a separate boolean so the client can render
-- "Former member invited you" UX when the inviter has since been removed
-- from the workspace (per the locked edge case).
create or replace function public.get_workspace_invite_preview(invite_token uuid)
returns json language plpgsql security definer stable
set search_path = ''
as $$
declare
  inv             public.workspace_invites%rowtype;
  ws_name         text;
  ws_slug         text;
  inviter_display text;
  inviter_email   text;
  inviter_active  boolean := false;
  resolved_status text;
begin
  select * into inv from public.workspace_invites where token = invite_token;
  if not found then
    return json_build_object('status', 'not_found');
  end if;

  -- Derive status. Order matters: 'accepted' wins over 'expired' (a
  -- successfully-used invite is a finalized state, not a stale one).
  if inv.accepted_at is not null then
    resolved_status := 'accepted';
  elsif inv.expires_at <= now() then
    resolved_status := 'expired';
  else
    resolved_status := 'pending';
  end if;

  -- Look up workspace (FK + ON DELETE CASCADE means this should always
  -- find a row, but defensive in case of a concurrent delete).
  select name, slug into ws_name, ws_slug
  from public.workspaces where id = inv.workspace_id;
  if ws_name is null then
    return json_build_object('status', 'not_found');
  end if;

  -- Inviter info. invited_by may be NULL if the inviter's auth.users row
  -- was deleted (ON DELETE SET NULL). Active-member check is independent
  -- of whether the row still exists.
  if inv.invited_by is not null then
    select coalesce(p.display_name, u.email, 'Unknown'), u.email
      into inviter_display, inviter_email
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = inv.invited_by;

    inviter_active := exists (
      select 1 from public.workspace_memberships
      where workspace_id = inv.workspace_id
        and user_id = inv.invited_by
    );
  end if;

  return json_build_object(
    'status', resolved_status,
    'workspace_name', ws_name,
    'workspace_slug', ws_slug,
    'email', inv.email,
    'role', inv.role,
    'inviter_display_name', inviter_display,
    'inviter_email', inviter_email,
    'inviter_is_active_member', inviter_active,
    'expires_at', inv.expires_at,
    'accepted_at', inv.accepted_at
  );
end;
$$;


-- ─── 5. RPC: accept_workspace_invite ───────────────────────────────────────
-- Atomic acceptance: validates → inserts membership → marks invite. Either
-- everything commits or nothing does (single function body = single
-- transaction).
--
-- Failure modes, each with a distinct SQLSTATE the client can branch on:
--   * 42501 — not authenticated / authenticated user not found in auth.users
--   * 42501 — email mismatch (we reuse 42501 since both are auth-y failures;
--             the message differentiates)
--   * 22023 — invite not found (never existed, revoked, or workspace
--             deleted)
--   * 22023 — invite expired
--   * 22023 — workspace no longer exists (extra defensive)
--   * 23505 — invite already accepted (single-use violation)
--   * 23505 — caller is already a member (idempotency / friendly error)
--
-- Returns the workspace slug on success so the client can route to
-- /w/[slug] without a second round trip.
create or replace function public.accept_workspace_invite(invite_token uuid)
returns json language plpgsql security definer
set search_path = ''
as $$
declare
  inv         public.workspace_invites%rowtype;
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

  -- Fetch invite. Security definer bypasses workspace_invites RLS — the
  -- invitee isn't yet a member of the workspace and so couldn't read this
  -- row directly. The token in the URL is what authorises the read.
  select * into inv from public.workspace_invites where token = invite_token;
  if not found then
    raise exception 'Invite not found or has been revoked'
      using errcode = '22023';
  end if;

  -- Single-use enforcement.
  if inv.accepted_at is not null then
    raise exception 'This invite has already been accepted'
      using errcode = '23505';
  end if;

  -- Expiry check.
  if inv.expires_at <= now() then
    raise exception 'This invite has expired'
      using errcode = '22023';
  end if;

  -- Email match (case-insensitive). The security gate against a forwarded
  -- link being accepted by someone other than the intended recipient.
  if lower(inv.email) != lower(actor_email) then
    raise exception 'This invite was sent to a different email address'
      using errcode = '42501';
  end if;

  -- Already-a-member check. Idempotency / clearer error than letting the
  -- workspace_memberships PK collision raise unique_violation cryptically.
  if exists (
    select 1 from public.workspace_memberships
    where workspace_id = inv.workspace_id and user_id = actor
  ) then
    raise exception 'You are already a member of this workspace'
      using errcode = '23505';
  end if;

  -- Defensive: workspace still exists. (Cascade-delete on workspace removes
  -- the invite, so reaching this state should be impossible — but the
  -- check is cheap and the alternative is an FK violation later.)
  select name, slug into ws_name, ws_slug
  from public.workspaces where id = inv.workspace_id;
  if ws_name is null then
    raise exception 'Workspace no longer exists' using errcode = '22023';
  end if;

  -- Atomic: insert membership + mark invite accepted in one transaction.
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (inv.workspace_id, actor, inv.role);

  update public.workspace_invites
  set accepted_at = now(), accepted_by = actor
  where token = invite_token;

  return json_build_object(
    'workspace_id',   inv.workspace_id,
    'workspace_slug', ws_slug,
    'workspace_name', ws_name,
    'role',           inv.role
  );
end;
$$;


-- ─── 6. Grants ─────────────────────────────────────────────────────────────
-- Preview is callable by anyone (anon + authenticated) so the landing page
-- can render before the user signs in. Accept requires authentication; the
-- function itself rejects null auth.uid().
grant execute on function public.get_workspace_invite_preview(uuid)
  to anon, authenticated;
grant execute on function public.accept_workspace_invite(uuid)
  to authenticated;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Helper + RPCs exist with right security context:
--   select proname, prosecdef, provolatile,
--          pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in (
--       'is_workspace_owner_or_admin',
--       'get_workspace_invite_preview',
--       'accept_workspace_invite'
--     )
--   order by proname;
--   Expected: 3 rows. All prosecdef = true. is_workspace_owner_or_admin
--   provolatile = 's' (stable); RPCs are 'v' (volatile — they write) and
--   's' (preview is stable).
--
-- 2. Grants are right (anon for preview only):
--   select grantee, routine_name, privilege_type
--   from information_schema.role_routine_grants
--   where routine_schema = 'public'
--     and routine_name in (
--       'get_workspace_invite_preview', 'accept_workspace_invite'
--     )
--   order by routine_name, grantee;
--   Expected: preview → anon EXECUTE + authenticated EXECUTE; accept →
--   authenticated EXECUTE only (no anon row).
--
-- 3. RLS enabled + policies present:
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'workspace_invites'
--   order by cmd, policyname;
--   Expected: 3 policies — _select / _insert / _delete. No _update.
--
-- 4. Owner/admin/member access (run as each role under impersonation —
--    needs an existing workspace with multiple memberships; jordan's
--    Phase 3 setup has these). Owner + admin should be able to SELECT and
--    INSERT into workspace_invites for their workspace; member should not.
--
-- 5. RPC functional smoke (see Step 6a verification message for the exact
--    test plan covering all preview statuses + all accept failure paths).
-- ============================================================================
