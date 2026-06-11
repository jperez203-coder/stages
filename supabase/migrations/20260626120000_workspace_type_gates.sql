-- ============================================================================
-- Stages — workspace_type gates (WT-4)
-- ============================================================================
-- Server-side enforcement of the Model C product rules for personal
-- workspaces. Three concerns wrapped into one migration because they're
-- inseparable at the data layer:
--
--   1. init_workspace_billing trigger: skip workspace_billing row creation
--      when the new workspace's type='personal'. Model C: personal
--      workspaces are free, no Stripe subscription, no trial state ever.
--
--   2. create_workspace_with_owner RPC: enforce 1-personal-per-user limit
--      (locked product decision — flat across all plan tiers; not tiered).
--      Personal-workspace inserts beyond the first raise unique_violation.
--
--   3. Cleanup: defensively remove workspace_billing rows tied to any
--      existing type='personal' workspaces. Jordan may have created test
--      personal workspaces during WT-3 verification while the unmodified
--      trigger was still running — those rows are stale post-WT-4 and
--      would confuse the billing tab, the seat-sync cron, and the dup-
--      blocks in the checkout routes. One-time cleanup; the modified
--      trigger above prevents recurrence.
--
--   4. accept_workspace_invite RPC: reject acceptance when the target
--      workspace's type='personal'. Personal workspaces don't accept
--      member invites — UI gates land in WT-5 but the security floor is
--      here.
--
--   5. accept_client_invite RPC: same gate for client invites. Personal
--      workspaces have no client portal surface.
--
-- API-route gates (billing/checkout, billing/founding-upgrade,
-- invites/send, client-invites/send, cron/sync-seats) land in the same
-- commit as application code, NOT in this migration. RLS hardening lands
-- in WT-6 — this migration intentionally does NOT touch RLS policies.
--
-- ── INVARIANT POST-APPLY ────────────────────────────────────────────────
-- For every public.workspaces row of type='personal':
--   * Zero rows in public.workspace_billing referencing it.
--   * Zero rows in public.workspace_invites referencing it (defensively;
--     none should exist today because the UI hasn't yet been gated, but
--     post-WT-5 + WT-6 this becomes structurally enforced).
--
-- ── DOWN PLAN ───────────────────────────────────────────────────────────
-- │
-- │   -- 1. Restore the prior trigger function body (no personal skip).
-- │   --    Copy init_workspace_billing verbatim from
-- │   --    supabase/migrations/20260623120000_track_b_trial_architecture.sql
-- │   --    and CREATE OR REPLACE.
-- │
-- │   -- 2. Restore the prior create_workspace_with_owner body (no
-- │   --    personal-limit check). Copy from
-- │   --    supabase/migrations/20260625120000_workspace_type.sql.
-- │
-- │   -- 3. Restore the prior accept_workspace_invite + accept_client_invite
-- │   --    bodies (no workspace-type gate). Copy from
-- │   --    supabase/migrations/20260513120000_workspace_invites.sql and
-- │   --    20260514120000_client_invites_align.sql respectively.
-- │
-- │   -- 4. Re-running the original init_workspace_billing trigger over
-- │   --    every personal workspace's existing row would be the
-- │   --    "complete" rollback, but that's a manual step:
-- │   --      insert into public.workspace_billing (...)
-- │   --      select w.id, ... from public.workspaces w where w.type = 'personal'
-- │   --      on conflict (workspace_id) do nothing;
-- │   --    Skip unless an explicit reason demands billing rows for personal
-- │   --    workspaces — i.e. the product decision flipped.
-- │
-- └────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Modified init_workspace_billing trigger function ──────────────────
-- The trigger registration itself (drop/create trigger statements in
-- 20260623120000) does NOT need to change — only the function body. After
-- this CREATE OR REPLACE, the existing on_workspace_created_init_billing
-- trigger automatically picks up the new body for every future workspace
-- INSERT.
create or replace function public.init_workspace_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- WT-4: Model C — personal workspaces never need billing. Skip row
  -- creation entirely and return NEW so the workspaces INSERT continues
  -- (AFTER INSERT trigger return value is ignored by the planner, but
  -- returning NEW is the documented convention and avoids surprising
  -- a future maintainer who reads this expecting standard behavior).
  if new.type = 'personal' then
    return new;
  end if;

  -- Agency workspaces: identical body to the 20260623120000 version.
  -- 14-day Track B trial. trial_ends_at + current_period_end both
  -- anchored to NEW.created_at (the row that just landed) so trial
  -- length is exactly 14 days regardless of clock skew between the
  -- INSERT and the trigger fire.
  --
  -- ON CONFLICT DO NOTHING: first-writer-wins. Founders' manually-
  -- granted rows + backfill migration rows + any future seed path
  -- are NOT clobbered. Trigger is additive only.
  insert into public.workspace_billing (
    workspace_id,
    stripe_subscription_id,
    subscription_status,
    plan,
    trial_ends_at,
    current_period_end,
    day12_notified_at,
    day28_notified_at
  ) values (
    new.id,
    null,
    'trialing',
    null,
    new.created_at + interval '14 days',
    new.created_at + interval '14 days',
    null,
    null
  )
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

comment on function public.init_workspace_billing() is
  'AFTER INSERT trigger on public.workspaces. Personal workspaces (type=personal) skip workspace_billing row creation per Model C; agency workspaces auto-create the matching billing row in the no-card trial state. SECURITY DEFINER + on conflict do nothing.';


-- ─── 2. Updated create_workspace_with_owner — per-user personal limit ─────
-- Same signature as 20260625120000. Same auth + C1 + name-validation +
-- type-validation + duplicate-name + atomic-insert behavior. Adds ONE
-- new validation block between type validation and duplicate-name check
-- (matching the strategy direction's "after type validation, before
-- duplicate-name check" placement).
create or replace function public.create_workspace_with_owner(
  workspace_name text,
  workspace_type text default 'agency'
)
returns json language plpgsql security definer
set search_path = ''
as $$
declare
  new_workspace_id   uuid;
  new_workspace_slug text;
  cleaned_name       text;
  cleaned_type       text;
  actor              uuid := (select auth.uid());
  has_agency         boolean;
  has_client         boolean;
  personal_count     int;  -- WT-4: per-user personal-workspace count
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- C1 paywall bypass guard (carried verbatim from 20260605120000).
  has_agency := exists (
    select 1 from public.workspace_memberships where user_id = actor
  ) or exists (
    select 1 from public.pipeline_memberships
    where user_id = actor and role in ('owner', 'admin', 'member')
  );
  has_client := exists (
    select 1 from public.pipeline_memberships
    where user_id = actor and role = 'client'
  );
  if has_client and not has_agency then
    raise exception 'Clients cannot create workspaces; agency upgrade flow not yet available'
      using errcode = '42501';
  end if;

  -- Workspace name validation (unchanged).
  cleaned_name := trim(coalesce(workspace_name, ''));
  if cleaned_name = '' then
    raise exception 'Workspace name cannot be empty'
      using errcode = '22023';
  end if;
  if length(cleaned_name) > 80 then
    raise exception 'Workspace name cannot exceed 80 characters'
      using errcode = '22023';
  end if;

  -- Workspace type validation (carried from 20260625120000).
  cleaned_type := lower(trim(coalesce(workspace_type, '')));
  if cleaned_type not in ('agency', 'personal') then
    raise exception 'Workspace type must be agency or personal (got: %)', workspace_type
      using errcode = '22023';
  end if;

  -- WT-4: per-user personal-workspace limit. Flat 1-per-user cap across
  -- all plan tiers (locked product decision; not tiered). Scoped to
  -- workspaces the caller OWNS — being invited as a teammate to someone
  -- else's personal workspace isn't possible today (WT-4 also gates
  -- accept_workspace_invite against personal targets), but the OWN-only
  -- scope keeps the semantics clean if that ever becomes possible.
  --
  -- 23505 (unique_violation) is the right SQLSTATE: this IS a
  -- uniqueness constraint, just one that's enforced functionally
  -- because Postgres has no native "one row per group per user"
  -- constraint expressible as CHECK or UNIQUE.
  if cleaned_type = 'personal' then
    select count(*) into personal_count
    from public.workspace_memberships wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = actor
      and wm.role = 'owner'
      and w.type = 'personal';
    if personal_count >= 1 then
      raise exception 'You can only have one personal workspace. Delete your existing personal workspace to create a new one.'
        using errcode = '23505';
    end if;
  end if;

  -- Per-user duplicate-name check (carried verbatim).
  if exists (
    select 1
    from public.workspace_memberships wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = actor
      and wm.role = 'owner'
      and lower(trim(w.name)) = lower(cleaned_name)
  ) then
    raise exception 'You already have a workspace named "%". Pick a different name.', cleaned_name
      using errcode = '23505';
  end if;

  -- Insert workspace WITH the chosen type column.
  insert into public.workspaces (name, type)
  values (cleaned_name, cleaned_type)
  returning id, slug into new_workspace_id, new_workspace_slug;

  -- Owner membership in the same transaction.
  insert into public.workspace_memberships (workspace_id, user_id, role)
  values (new_workspace_id, actor, 'owner');

  return json_build_object(
    'id',   new_workspace_id,
    'slug', new_workspace_slug,
    'name', cleaned_name
  );
end;
$$;


-- ─── 3. Cleanup: drop workspace_billing rows for personal workspaces ──────
-- One-time cleanup. Jordan may have created test personal workspaces during
-- WT-3 verification, in which case the unmodified init_workspace_billing
-- trigger auto-created workspace_billing rows for them. Those rows are now
-- stale: the post-WT-4 product rules say personal workspaces don't have
-- billing state. Removing them keeps the billing tab + seat-sync cron +
-- checkout dup-blocks correct.
--
-- The modified trigger above prevents recurrence, so this DELETE is a
-- one-time pass. Safe to run unconditionally (DELETE with no matches is
-- a no-op).
delete from public.workspace_billing
where workspace_id in (
  select id from public.workspaces where type = 'personal'
);


-- ─── 4. accept_workspace_invite — reject personal-workspace targets ───────
-- Same signature, same security context, same return shape. The new check
-- sits between the invite fetch and the existing validation chain
-- (single-use → expiry → email-match → already-member → workspace-existence
-- → atomic-insert). Placed AFTER the invite fetch because the workspace_id
-- comes from the invite row; placed BEFORE the validation chain so a
-- personal-workspace target rejects cleanly even if the invite is otherwise
-- valid.
create or replace function public.accept_workspace_invite(invite_token uuid)
returns json language plpgsql security definer
set search_path = ''
as $$
declare
  inv         public.workspace_invites%rowtype;
  ws_name     text;
  ws_slug     text;
  ws_type     text;   -- WT-4
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

  -- WT-4: personal-workspace gate. Resolve target workspace's type and
  -- reject before the validation chain. Personal workspaces don't accept
  -- member invites — UI prevents creating such invites in the first
  -- place (WT-5), but the security floor is enforced here so a pre-WT-5
  -- pending invite OR a direct-RPC caller can't bypass.
  select type into ws_type from public.workspaces where id = inv.workspace_id;
  if ws_type = 'personal' then
    raise exception 'Personal workspaces do not accept member invites.'
      using errcode = '42501';
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

  -- Already-a-member check.
  if exists (
    select 1 from public.workspace_memberships
    where workspace_id = inv.workspace_id and user_id = actor
  ) then
    raise exception 'You are already a member of this workspace'
      using errcode = '23505';
  end if;

  -- Defensive: workspace still exists. (Cascade-delete on workspace
  -- removes the invite, so reaching this state should be impossible —
  -- but the check is cheap and the alternative is an FK violation later.)
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


-- ─── 5. accept_client_invite — reject personal-workspace targets ──────────
-- Same shape as accept_workspace_invite's gate. Resolves the target
-- workspace via the pipeline's parent. Placed AFTER the invite fetch and
-- BEFORE the validation chain (single-use → expiry → email-match → already-
-- member → pipeline-existence → atomic-insert).
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
  ws_type     text;   -- WT-4
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
  -- client portal surface (Model C).
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

  -- Atomic: insert membership + mark invite accepted in one transaction.
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


-- ============================================================================
-- VERIFICATION QUERIES (commented — run manually after apply)
-- ============================================================================
-- (a) Confirm the trigger function body now contains the personal-skip.
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'init_workspace_billing';
--   -- Expected: body contains "if new.type = 'personal' then return new;"
--
-- (b) Confirm the create_workspace_with_owner body contains the personal
--     limit check.
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'create_workspace_with_owner';
--   -- Expected: body contains "personal_count" and "only have one personal workspace".
--
-- (c) Confirm cleanup actually removed any stale workspace_billing rows
--     for personal workspaces.
--   select wb.workspace_id, w.type
--   from public.workspace_billing wb
--   join public.workspaces w on w.id = wb.workspace_id
--   where w.type = 'personal';
--   -- Expected: zero rows.
--
-- (d) Confirm every personal workspace has zero workspace_billing rows.
--   select w.id, w.name, w.type,
--          exists (select 1 from public.workspace_billing wb where wb.workspace_id = w.id) as has_billing
--   from public.workspaces w
--   where w.type = 'personal';
--   -- Expected: every row has has_billing = false.
--
-- (e) Confirm accept_workspace_invite + accept_client_invite bodies
--     contain the personal-workspace gate.
--   select proname, pg_get_functiondef(oid)
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('accept_workspace_invite', 'accept_client_invite');
--   -- Expected: both bodies contain "Personal workspaces do not".
--
-- (f) Smoke test: per-user personal limit. Run AS A LOGGED-IN USER who
--     currently owns zero personal workspaces. Should succeed first time,
--     fail the second.
--   select public.create_workspace_with_owner('Smoke Test Personal', 'personal');
--   -- Expected: JSON with id, slug, name.
--   select public.create_workspace_with_owner('Another Personal', 'personal');
--   -- Expected: ERROR 23505 'You can only have one personal workspace ...'
--   -- CLEANUP: delete public.workspaces where name in ('Smoke Test Personal');
-- ============================================================================
