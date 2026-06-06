-- ============================================================================
-- Slice 6 Part F: Track B day-12 cron candidate RPC
--
-- Mirrors Slice 5's find_founding_day28_candidates() (commit 3679a5c)
-- exactly — same shape, same security posture, different filters.
--
-- Returns one row per (workspace, owner) pair where:
--   * workspace_billing.subscription_status = 'trialing'
--   * workspace_billing.stripe_subscription_id IS NULL
--       (no Stripe sub yet — Slice 6 trigger-created or backfilled
--        trial; Stripe-managed sub trials are handled by Stripe's own
--        renewal-reminder emails)
--   * workspace_billing.trial_ends_at > now()
--       (not yet expired; expired-state banner takes over the nudge UX)
--   * workspace_billing.trial_ends_at <= now() + interval '48 hours'
--       (0-48h pre-expiry window — gives day-11.x and day-12 users their
--        nudge with ~24h to react)
--   * workspace_billing.day12_notified_at IS NULL
--       (cron-skip resilient: missing a day doesn't double-nudge anyone)
--   * profiles.is_founding_member = false
--       (Track B only; founders get the day-28 founding cron from
--        Slice 5)
--
-- The partial index workspace_billing_trackb_day12_candidates_idx
-- (Slice 6 Part A, commit fcea5d3) is engineered for this exact query
-- shape. Steady state nearly empty so the index lookup is effectively a
-- constant-time scan.
--
-- SECURITY DEFINER + search_path lockdown so the cron route's service-
-- role caller can invoke without RLS interference. EXECUTE revoked from
-- public/anon/authenticated and granted only to service_role — same
-- lockdown pattern as Slice 5's founder day-28 RPC + Slice 5's
-- expire_founding_trials RPC.
--
-- DOWN PLAN
--   drop function if exists public.find_trackb_day12_candidates();
--   -- That's it. No table or policy dependencies — the function is
--   -- read-only over existing tables.
-- ============================================================================

create or replace function public.find_trackb_day12_candidates()
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
security definer
set search_path = ''
stable
as $$
  select
    wb.workspace_id,
    wb.trial_ends_at,
    w.slug as workspace_slug,
    w.name as workspace_name,
    p.id            as owner_user_id,
    p.email as owner_email,
    p.display_name as owner_display_name
  from public.workspace_billing wb
  join public.workspaces w on w.id = wb.workspace_id
  join public.workspace_memberships wm on wm.workspace_id = wb.workspace_id
    and wm.role = 'owner'
  join public.profiles p on p.id = wm.user_id
  where wb.subscription_status = 'trialing'
    and wb.stripe_subscription_id is null
    and wb.trial_ends_at > now()
    and wb.trial_ends_at <= now() + interval '48 hours'
    and wb.day12_notified_at is null
    and p.is_founding_member = false;
$$;

comment on function public.find_trackb_day12_candidates() is
  'Slice 6 Part F: returns Track B trialing workspaces 0-48h pre-expiry '
  'that haven''t been nudged yet. Mirrors find_founding_day28_candidates '
  'for the founder cohort. Service-role only.';

revoke execute on function public.find_trackb_day12_candidates() from public, anon, authenticated;
grant execute on function public.find_trackb_day12_candidates() to service_role;


-- ============================================================================
-- POST-APPLY VERIFICATION
-- ============================================================================
--
-- VERIFY 1 — function registered as SECURITY DEFINER with search_path lock.
--
-- select proname, prosecdef, proconfig
-- from pg_proc
-- where proname = 'find_trackb_day12_candidates'
--   and pronamespace = 'public'::regnamespace;
-- -- Expected: 1 row, prosecdef = true, proconfig = {search_path=}
--
-- VERIFY 2 — EXECUTE grant matrix (only postgres + service_role).
--
-- select grantee, privilege_type
-- from information_schema.routine_privileges
-- where routine_schema = 'public'
--   and routine_name = 'find_trackb_day12_candidates'
-- order by grantee;
-- -- Expected: postgres EXECUTE, service_role EXECUTE.
-- -- NOT authenticated, NOT anon, NOT public.
--
-- VERIFY 3 — smoke call returns SETOF rows (empty if no eligible workspaces).
--
-- select * from public.find_trackb_day12_candidates();
-- -- Expected: 0 rows in steady state (no Slice 6 workspaces currently in
-- -- the 0-48h pre-expiry window without notification). 14 prod
-- -- workspaces backfilled by Part B may have some in window depending
-- -- on how their trial_ends_at landed via the greatest() floor.
-- ============================================================================
