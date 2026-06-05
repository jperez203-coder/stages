-- ============================================================================
-- Track A founding cron RPCs — Slice 5
--
-- Two SECURITY DEFINER functions backing the day-28 + day-30 cron routes:
--
--   1. find_founding_day28_candidates() — returns the SETOF rows the
--      day-28 cron should nudge. JOIN across workspace_billing + workspaces
--      + workspace_memberships + profiles, gated on the locked criteria
--      (Track A trialing within 72h of expiry, founding owner, not yet
--      notified).
--
--   2. expire_founding_trials() — UPDATEs trialing → canceled for Track A
--      founders whose trial_ends_at is in the past, returns the count of
--      rows updated. Single SQL statement; idempotent (rows already
--      canceled stay canceled because the filter requires status=trialing).
--
-- Both run with elevated privileges (postgres-owned, SECURITY DEFINER) so
-- they can read profiles.is_founding_member (column GRANT lockdown
-- denies that column to authenticated; service-role bypass works but
-- the function form is more reusable and self-documenting).
--
-- EXECUTE granted to service_role only; revoked from PUBLIC, anon,
-- authenticated. The cron routes (Bearer-token CRON_SECRET auth) use the
-- service-role admin client and call these via supabase-js .rpc(...).
--
-- DOWN PLAN:
--   drop function public.expire_founding_trials();
--   drop function public.find_founding_day28_candidates();
-- No data side effects from rolling back the functions themselves —
-- workspace_billing.day28_notified_at + subscription_status are set by
-- the cron routes that CALL these functions, not by the functions in
-- isolation. The cron routes UPDATE day28_notified_at after enqueuing
-- emails; expire_founding_trials writes subscription_status directly.
-- ============================================================================


-- ─── find_founding_day28_candidates ─────────────────────────────────────────
-- Returns one row per (workspace, owner) tuple eligible for the day-28
-- nudge. Multi-owner workspaces yield multiple rows; that's intentional —
-- each owner gets emailed once. The caller (cron route) UPDATEs
-- workspace_billing.day28_notified_at AFTER successfully enqueueing the
-- email; subsequent cron runs see the timestamp and exclude the row.
--
-- Window is 0-72h: a missed cron cycle never causes a founder to miss
-- their nudge — the next eligible cron picks them up before expiry. The
-- email template renders the actual remaining time at send so "3 days"
-- / "2 days" / "tomorrow" / "today" all read accurately even though
-- the cron is daily.

create or replace function public.find_founding_day28_candidates()
returns table (
  workspace_id uuid,
  trial_ends_at timestamptz,
  workspace_slug text,
  workspace_name text,
  owner_user_id uuid,
  owner_email text,
  owner_display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    wb.workspace_id,
    wb.trial_ends_at,
    w.slug          as workspace_slug,
    w.name          as workspace_name,
    p.id            as owner_user_id,
    p.email         as owner_email,
    p.display_name  as owner_display_name
  from public.workspace_billing wb
  join public.workspaces w
    on w.id = wb.workspace_id
  join public.workspace_memberships wm
    on wm.workspace_id = wb.workspace_id
   and wm.role = 'owner'
  join public.profiles p
    on p.id = wm.user_id
  where wb.subscription_status = 'trialing'
    and wb.stripe_subscription_id is null
    and wb.day28_notified_at is null
    and wb.trial_ends_at >  now()
    and wb.trial_ends_at <= now() + interval '72 hours'
    and p.is_founding_member = true
    and p.email is not null;
$$;

comment on function public.find_founding_day28_candidates() is
  'Track A day-28 cron: returns (workspace, owner) tuples to nudge. '
  'Service-role only; called from /api/cron/enqueue-founding-day28.';

revoke all on function public.find_founding_day28_candidates() from public, anon, authenticated;
grant execute on function public.find_founding_day28_candidates() to service_role;


-- ─── expire_founding_trials ─────────────────────────────────────────────────
-- Flips Track A founders' trialing rows to canceled once trial_ends_at
-- has passed. Returns the count of rows updated so the cron route can
-- log a summary.
--
-- Idempotent — rows already at status='canceled' don't match the
-- subscription_status='trialing' filter, so a re-run is a no-op even if
-- the day-30 cron fires multiple times in a row.

create or replace function public.expire_founding_trials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_count integer;
begin
  with expired as (
    update public.workspace_billing wb
    set subscription_status = 'canceled'
    where wb.subscription_status = 'trialing'
      and wb.stripe_subscription_id is null
      and wb.trial_ends_at < now()
      and exists (
        select 1
        from public.workspace_memberships wm
        join public.profiles p on p.id = wm.user_id
        where wm.workspace_id = wb.workspace_id
          and wm.role = 'owner'
          and p.is_founding_member = true
      )
    returning wb.workspace_id
  )
  select count(*) into expired_count from expired;
  return expired_count;
end;
$$;

comment on function public.expire_founding_trials() is
  'Track A day-30 cron: flips trialing → canceled for founder workspaces '
  'whose trial_ends_at is in the past. Returns count of rows updated. '
  'Service-role only; called from /api/cron/expire-founding-trials.';

revoke all on function public.expire_founding_trials() from public, anon, authenticated;
grant execute on function public.expire_founding_trials() to service_role;


-- ============================================================================
-- POST-APPLY VERIFICATION — paste each into Supabase SQL editor.
-- ============================================================================
--
-- VERIFY 1 — both functions exist with correct signatures.
--
-- select routine_name, routine_type, data_type, security_type
-- from information_schema.routines
-- where routine_schema = 'public'
--   and routine_name in (
--     'find_founding_day28_candidates',
--     'expire_founding_trials'
--   )
-- order by routine_name;
--
-- Expected: 2 rows. Both routine_type=FUNCTION, security_type=DEFINER.
-- find_founding_day28_candidates: data_type=record (returns SETOF).
-- expire_founding_trials: data_type=integer.
--
-- VERIFY 2 — EXECUTE granted only to service_role.
--
-- select grantee, privilege_type, routine_name
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name in (
--     'find_founding_day28_candidates',
--     'expire_founding_trials'
--   )
-- order by routine_name, grantee;
--
-- Expected: 2 rows, both with grantee=service_role, privilege_type=EXECUTE.
-- authenticated + anon + PUBLIC must NOT appear.
--
-- VERIFY 3 — smoke-call both functions (will return 0 rows / 0 count if
-- no founders are currently in the eligible window, which is the
-- expected state for a fresh DB).
--
-- select * from public.find_founding_day28_candidates();
-- -- Expected: 0 rows on a fresh DB (no founders granted yet)
--
-- select public.expire_founding_trials();
-- -- Expected: 0 (no founders to expire)
-- ============================================================================
