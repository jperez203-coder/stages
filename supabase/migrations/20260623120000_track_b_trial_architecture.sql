-- ============================================================================
-- Slice 6: Track B trial architecture cleanup
--
-- Closes the "ghost trial" gap: marketing site promises a 14-day free
-- trial, but historically the app created no workspace_billing row at
-- signup. Result: banner copy lied ("Start your 14-day free trial" when
-- the user was implicitly already in one), the day-28 cron only fired
-- for founders, and there was no DB record to drive countdown copy or
-- expiry enforcement.
--
-- This migration ships four coordinated changes:
--   1. workspace_billing.plan becomes NULLABLE — "plan not yet chosen"
--      is the legitimate trial state before checkout. The existing
--      Slice 1 CHECK (plan in ('solo','team')) passes when plan is
--      NULL (CHECK constraints pass on NULL/unknown).
--   2. workspace_billing.day12_notified_at column for the Track B
--      day-12 cron dedup (mirrors day28_notified_at for founders).
--   3. Partial index on trial_ends_at for the day-12 cron query.
--      Steady state tiny — only rows still eligible for nudge are
--      indexed. Same shape as workspace_billing_day28_pending_idx.
--   4. AFTER INSERT trigger on public.workspaces that auto-inserts a
--      workspace_billing row with subscription_status='trialing',
--      trial_ends_at = workspaces.created_at + 14 days, plan=NULL.
--      SECURITY DEFINER so the trigger can write workspace_billing
--      regardless of the acting user's RLS. ON CONFLICT (workspace_id)
--      DO NOTHING so manually-granted founder rows or backfilled rows
--      are not clobbered. Mirrors the handle_new_user pattern exactly.
--
-- Sibling migration 20260623120100 backfills existing workspaces.
-- Apply this FIRST (the trigger landing before the backfill is safe;
-- backfill landing first would leave the trigger unset for any
-- workspace created between the two migrations).
--
-- DOWN PLAN
--   drop trigger if exists on_workspace_created_init_billing on public.workspaces;
--   drop function if exists public.init_workspace_billing();
--   drop index if exists public.workspace_billing_trackb_day12_candidates_idx;
--   alter table public.workspace_billing drop column if exists day12_notified_at;
--   -- Restore plan NOT NULL only after confirming no NULL rows exist:
--   --   update public.workspace_billing set plan = 'solo' where plan is null;
--   --   alter table public.workspace_billing alter column plan set not null;
--   --   alter table public.workspace_billing alter column plan set default 'solo';
-- ============================================================================


-- ─── 1. plan becomes nullable ───────────────────────────────────────────────
alter table public.workspace_billing
  alter column plan drop not null,
  alter column plan drop default;

comment on column public.workspace_billing.plan is
  'Stripe plan key after checkout. NULL during the no-card trial period '
  '(before the user has chosen Solo vs Team). Slice 2 webhook flips this '
  'to ''solo'' or ''team'' on checkout.session.completed. The CHECK '
  'constraint allows NULL (CHECK passes on NULL by definition).';


-- ─── 2. day12_notified_at column ────────────────────────────────────────────
alter table public.workspace_billing
  add column day12_notified_at timestamptz;

comment on column public.workspace_billing.day12_notified_at is
  'Track B: set when the day-12-of-trial nudge email is enqueued. NULL '
  'until then. Used as the dedup key by /api/cron/enqueue-trackb-day12. '
  'Mirrors day28_notified_at''s role for Slice 5 founders; same dedup '
  'pattern (UPDATE atomically after email enqueue succeeds).';


-- ─── 3. Partial index for the day-12 cron query ────────────────────────────
-- Filters match the cron's candidate query exactly. Composite indexes
-- on (status, day12_notified_at, trial_ends_at) would index every row;
-- this partial only indexes the eligible-candidates subset. Steady
-- state: nearly empty (most workspaces are pre-day-12, already-notified,
-- or already on a paid subscription).
--
-- Name follows the more explicit Track-B + candidates naming (vs. the
-- existing workspace_billing_day28_pending_idx pattern). Both shapes
-- are valid; this one signals intent more clearly to readers grepping
-- by feature name.
create index workspace_billing_trackb_day12_candidates_idx
  on public.workspace_billing (trial_ends_at)
  where subscription_status = 'trialing'
    and day12_notified_at is null
    and stripe_subscription_id is null;


-- ─── 4. Trigger function: auto-init workspace_billing on workspaces INSERT ─
create or replace function public.init_workspace_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  'AFTER INSERT trigger on public.workspaces that auto-creates the '
  'matching workspace_billing row in the no-card trial state. '
  'SECURITY DEFINER + on conflict do nothing. First-writer-wins.';


-- ─── 5. Trigger ────────────────────────────────────────────────────────────
drop trigger if exists on_workspace_created_init_billing on public.workspaces;
create trigger on_workspace_created_init_billing
after insert on public.workspaces
for each row
execute function public.init_workspace_billing();


-- ============================================================================
-- POST-APPLY VERIFICATION — paste each block; expected outputs inline.
-- ============================================================================
--
-- VERIFY 1 — plan column shape (was NOT NULL default 'solo'; now nullable, no default).
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'workspace_billing'
--   and column_name = 'plan';
-- -- Expected: 1 row — text, YES, null
--
-- VERIFY 2 — day12_notified_at column landed.
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'workspace_billing'
--   and column_name = 'day12_notified_at';
-- -- Expected: 1 row — timestamp with time zone, YES, null
--
-- VERIFY 3 — partial index installed.
--
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public'
--   and indexname = 'workspace_billing_trackb_day12_candidates_idx';
-- -- Expected: 1 row, indexdef ends with
-- --   WHERE ((subscription_status = 'trialing'::text)
-- --     AND (day12_notified_at IS NULL)
-- --     AND (stripe_subscription_id IS NULL))
--
-- VERIFY 4 — trigger registered on public.workspaces.
--
-- select tgname, tgenabled
-- from pg_trigger
-- where tgname = 'on_workspace_created_init_billing'
--   and tgrelid = 'public.workspaces'::regclass;
-- -- Expected: 1 row, tgenabled = 'O' (enabled, Origin)
--
-- VERIFY 5 — function exists with SECURITY DEFINER + search_path lock.
--
-- select proname, prosecdef, proconfig
-- from pg_proc
-- where proname = 'init_workspace_billing'
--   and pronamespace = 'public'::regnamespace;
-- -- Expected: 1 row, prosecdef = true, proconfig = {search_path=}
--
-- VERIFY 6 — smoke test: count of workspace_billing rows for a freshly-
-- inserted workspace inside a transaction. Confirms the trigger fires +
-- creates exactly one row with the expected shape. ROLLBACK leaves no
-- persistent state behind.
--
-- begin;
--   -- Snapshot the baseline count BEFORE the insert so the delta is
--   -- unambiguous (even if other workspaces are being created
--   -- concurrently by app traffic).
--   select count(*) as wb_count_before from public.workspace_billing;
--
--   insert into public.workspaces (id, name, slug)
--   values (
--     gen_random_uuid(),
--     'Slice 6 verify',
--     'slice-6-verify-' || extract(epoch from now())::text
--   );
--
--   select count(*) as wb_count_after from public.workspace_billing;
--   -- Expected: wb_count_after = wb_count_before + 1
--
--   -- Confirm the row's shape matches the trigger's INSERT.
--   select
--     stripe_subscription_id,
--     subscription_status,
--     plan,
--     day12_notified_at,
--     day28_notified_at,
--     (trial_ends_at - now())::interval as trial_remaining
--   from public.workspace_billing wb
--   join public.workspaces w on w.id = wb.workspace_id
--   where w.name = 'Slice 6 verify';
--   -- Expected: 1 row —
--   --   stripe_subscription_id   = NULL
--   --   subscription_status      = 'trialing'
--   --   plan                     = NULL
--   --   day12_notified_at        = NULL
--   --   day28_notified_at        = NULL
--   --   trial_remaining          ≈ 14 days (small floor-rounding ok)
-- rollback;
-- -- After rollback: wb_count_before == wb_count_after again (verify if
-- -- you want to double-check the rollback by running count() outside
-- -- the transaction block).
-- ============================================================================
