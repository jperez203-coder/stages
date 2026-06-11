-- ============================================================================
-- Stages — client_invites.role column + RPC updates (PI-1 + PI-2)
-- ============================================================================
-- Adds role to the client_invites table + threads it through the two
-- RPCs that read/write it. Foundation for the pipeline-invite sprint:
-- once this lands, the schema accepts 'admin' / 'member' values, but no
-- UI or API exposes that path yet (PI-3 ships the API gate; PI-6 ships
-- the UI). Today's client-invite flow continues to produce role='client'
-- rows via the column default.
--
-- ── ROLE VALUES (CHECK constraint) ──────────────────────────────────────
--
--   'client'  — external client. Default. Accepts → /portal/{pipeline_id}
--               (client portal view). Inserted into pipeline_memberships
--               with role='client'. Existing behavior — every row pre-
--               migration backfills to this value automatically via the
--               NOT NULL DEFAULT 'client'.
--
--   'member'  — internal team member. Accepts → /w/{workspace_slug}/p/{pipeline_id}
--               (agency canvas, NOT the portal). Inserted with role='member'
--               in pipeline_memberships. UI invite picker (PI-6) exposes
--               this option.
--
--   'admin'   — internal team admin. Same accept landing as 'member' but
--               higher capability per the CLAUDE.md role matrix. NOT
--               exposed in the initial UI invite picker (PI-6). Schema
--               accepts the value so SQL-side assignment + future picker
--               expansion are unblocked. Owner ('owner') is workspace-
--               level only and NOT a valid invite role — excluded from
--               the CHECK.
--
-- ── BACKWARD COMPATIBILITY ──────────────────────────────────────────────
--
--   * NOT NULL DEFAULT 'client' backfills every existing row in a single
--     statement. No separate UPDATE pass.
--   * /api/client-invites/send pre-PI-3 doesn't supply role on INSERT;
--     the default kicks in → continues producing 'client' rows.
--   * accept_client_invite's signature is unchanged (single uuid arg) —
--     same RPC, byte-for-byte same call surface from the accept page.
--     The body reads inv.role instead of hardcoding 'client'. Old invite
--     rows (and new ones pre-PI-3) have role='client' so behavior is
--     identical.
--   * get_client_invite_preview signature unchanged; JSON return adds
--     a 'role' field. Consumer (src/app/portal/accept/[token]/page.tsx
--     line 95) destructures specific fields — additive JSON changes
--     are safe.
--
-- ── DOWN PLAN ───────────────────────────────────────────────────────────
-- │
-- │   -- 1. Restore the prior accept_client_invite body (hardcodes
-- │   --    'client' in the INSERT, no 'role' in the return JSON).
-- │   --    Copy from supabase/migrations/20260626120000_workspace_type_gates.sql
-- │   --    and CREATE OR REPLACE.
-- │
-- │   -- 2. Restore the prior get_client_invite_preview body (no 'role'
-- │   --    in the return JSON). Copy from
-- │   --    supabase/migrations/20260514120000_client_invites_align.sql
-- │   --    and CREATE OR REPLACE.
-- │
-- │   -- 3. Drop the column. Safe to do AFTER the RPC bodies no longer
-- │   --    reference it (steps 1 + 2 above must run first or the RPCs
-- │   --    error at next invocation).
-- │   alter table public.client_invites drop column role;
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Add the role column ───────────────────────────────────────────────
alter table public.client_invites
  add column role text not null default 'client'
  constraint client_invites_role_check check (role in ('admin', 'member', 'client'));


-- ─── 2. Column comment ────────────────────────────────────────────────────
comment on column public.client_invites.role is
  'Role the recipient will hold after accepting the invite. client = external client (accepts -> /portal/{pipeline_id}, role=client in pipeline_memberships); member = internal team member (accepts -> /w/{slug}/p/{pipeline_id} agency canvas, role=member); admin = internal team admin (same accept landing as member, higher capability per the CLAUDE.md role matrix). Default client preserves pre-PI-1 behavior for unmodified callers. owner is workspace-level and intentionally excluded from the CHECK.';


-- ─── 3. accept_client_invite — read inv.role, return role in JSON ─────────
-- Same single-uuid signature. Byte-for-byte unchanged from the WT-4
-- version in 20260626120000_workspace_type_gates.sql EXCEPT:
--   (a) the pipeline_memberships INSERT writes inv.role instead of
--       hardcoded 'client', and
--   (b) the return JSON adds a 'role' field so the accept-landing page
--       (PI-5) can branch routing on it (client -> /portal/{id},
--       member/admin -> /w/{slug}/p/{id}).
-- All other behavior — auth check, personal-workspace reject (WT-4),
-- single-use, expiry, email match, already-member, pipeline-still-
-- exists check, atomic insert + invite update — is preserved.
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
  ws_type     text;
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

  -- Fetch invite. Security definer bypasses RLS so the invitee (not yet
  -- a pipeline member) can read the row for validation. The token in the
  -- URL is what authorises the read.
  select * into inv from public.client_invites where token = invite_token;
  if not found then
    raise exception 'Invite not found or has been revoked'
      using errcode = '22023';
  end if;

  -- WT-4: personal-workspace gate. Resolve the workspace through the
  -- pipeline FK and reject if personal. Personal workspaces have no
  -- client portal surface (Model C). Note: post-PI-1 the same reject
  -- applies to member/admin invites too — personal workspaces are solo
  -- by definition and don't accept ANY pipeline invites. Message kept
  -- byte-for-byte to avoid a behavioral diff on the WT-4 wording; a
  -- future polish can generalize the copy.
  select w.type into ws_type
  from public.pipelines p
  join public.workspaces w on w.id = p.workspace_id
  where p.id = inv.pipeline_id;
  if ws_type = 'personal' then
    raise exception 'Personal workspaces do not support client portals.'
      using errcode = '42501';
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

  -- Already-a-member check.
  if exists (
    select 1 from public.pipeline_memberships
    where pipeline_id = inv.pipeline_id and user_id = actor
  ) then
    raise exception 'You already have access to this pipeline'
      using errcode = '23505';
  end if;

  -- Defensive: pipeline still exists.
  select p.id, p.name, w.name, w.slug
    into pip_id, pip_name, ws_name, ws_slug
  from public.pipelines p
  join public.workspaces w on w.id = p.workspace_id
  where p.id = inv.pipeline_id;
  if pip_id is null then
    raise exception 'Pipeline no longer exists' using errcode = '22023';
  end if;

  -- PI-2: insert with the role from the invite row. Recipient cannot
  -- influence role — the inviter chose it at invite-create time and
  -- it lives on the row immutably. This is the security gate against
  -- a recipient passing a higher role at accept time (we don't accept
  -- a role parameter; the RPC signature is unchanged).
  insert into public.pipeline_memberships (pipeline_id, user_id, role)
  values (inv.pipeline_id, actor, inv.role);

  update public.client_invites
  set accepted_at = now(), accepted_by = actor
  where token = invite_token;

  -- PI-2: return role so the accept-landing page (PI-5) can branch
  -- routing — 'client' goes to /portal/{pipeline_id}, 'member'/'admin'
  -- go to /w/{workspace_slug}/p/{pipeline_id}. All other return fields
  -- unchanged.
  return json_build_object(
    'pipeline_id',    pip_id,
    'pipeline_name',  pip_name,
    'workspace_name', ws_name,
    'workspace_slug', ws_slug,
    'role',           inv.role
  );
end;
$$;


-- ─── 4. get_client_invite_preview — return role in JSON ───────────────────
-- Same signature, same security context, same body — only addition is
-- 'role' in the return JSON so the accept-landing page (PI-5) can
-- render role-appropriate copy BEFORE the user clicks accept. The
-- consumer (src/app/portal/accept/[token]/page.tsx) destructures
-- specific fields off the preview shape; adding 'role' is safe.
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

  -- PI-2: 'role' added to the return so PI-5 can render role-
  -- appropriate landing-page copy and route post-accept. All other
  -- fields unchanged.
  return json_build_object(
    'status',                            resolved_status,
    'pipeline_id',                       pip_id,
    'pipeline_name',                     pip_name,
    'workspace_name',                    ws_name,
    'workspace_slug',                    ws_slug,
    'email',                             inv.email,
    'role',                              inv.role,
    'inviter_display_name',              inviter_display,
    'inviter_email',                     inviter_email,
    'inviter_is_active_pipeline_member', inviter_active,
    'expires_at',                        inv.expires_at,
    'accepted_at',                       inv.accepted_at
  );
end;
$$;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- (a) Confirm the column exists with the right type + default + CHECK.
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'client_invites'
--     and column_name = 'role';
--   -- Expected: data_type='text', is_nullable='NO', column_default contains 'client'.
--
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'client_invites_role_check';
--   -- Expected: CHECK (role IN ('admin', 'member', 'client'))
--
-- (b) Confirm all pre-PI-1 rows backfilled to 'client'.
--   select role, count(*) from public.client_invites group by role order by role;
--   -- Expected: one row, role='client', count = total existing invites.
--   --           Zero 'member' or 'admin' rows (no UI/API exposes them yet).
--
-- (c) Confirm accept_client_invite body references inv.role for the
--     INSERT + returns role in JSON.
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'accept_client_invite';
--   -- Expected: body contains "values (inv.pipeline_id, actor, inv.role)"
--   --           AND "'role',           inv.role" in the json_build_object.
--   -- NOT in the body: the literal "'client'" string inside the INSERT.
--
-- (d) Confirm get_client_invite_preview body returns role in JSON.
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'get_client_invite_preview';
--   -- Expected: body contains "'role',                              inv.role"
--   --           in the json_build_object return.
--
-- (e) Confirm grants survived the CREATE OR REPLACE on both RPCs.
--   select proname,
--          has_function_privilege('authenticated', oid, 'EXECUTE') as auth_can_call,
--          has_function_privilege('anon', oid, 'EXECUTE') as anon_can_call
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('accept_client_invite', 'get_client_invite_preview');
--   -- Expected: accept_client_invite -> authenticated true, anon false.
--   --           get_client_invite_preview -> authenticated true, anon true.
--
-- (f) Smoke test — direct INSERT with role='member' SUCCEEDS at the
--     schema level. Run as a logged-in user who owns/admins a pipeline
--     in an AGENCY workspace; substitute the real pipeline id. This
--     bypasses the (not-yet-shipped) API gate but exercises the schema
--     + RLS path.
--   begin;
--   insert into public.client_invites (pipeline_id, email, role, invited_by)
--   values ('<agency-pipeline-id>'::uuid, 'pi1-smoke@example.com', 'member', auth.uid())
--   returning token, role;
--   -- Expected: 1 row, role='member'.
--   rollback;
--
-- (g) Smoke test — invalid role rejected by the CHECK.
--   begin;
--   insert into public.client_invites (pipeline_id, email, role, invited_by)
--   values ('<agency-pipeline-id>'::uuid, 'pi1-bad@example.com', 'owner', auth.uid());
--   -- Expected: ERROR 23514 'check constraint client_invites_role_check'
--   rollback;
-- ============================================================================
