-- ============================================================================
-- Seat sync audit log — Slice 3 (Track B, per-seat quantity reconciliation)
--
-- Slice 2 created Stripe subscriptions with `quantity: 1` at checkout time
-- with an inline marker comment pointing here: Slice 3 is responsible for
-- reconciling actual agency-seat counts to Stripe before the first paid
-- invoice cycle (~14 days after each trial start).
--
-- Architecture chosen (Slice 3 planning): Option A — daily cron-only sync.
-- Up to 24h drift between membership change and Stripe quantity update,
-- which fits inside Track B's 14-day trial buffer (drift can at worst
-- extend the trial by 23h of free seats; never affects first-month
-- accuracy). Architecture deliberately leaves the door open to add a
-- reactive pg_net trigger layer later (Option B/C) without restructuring
-- the audit table or the sync route.
--
-- This table records every per-workspace sync attempt so support /
-- monitoring queries have a clear "what happened on this cron run for
-- this workspace?" answer. Log granularity is per-workspace per-run.
--
-- LOCKED DECISIONS (Jordan-approved before write):
--   * Log every workspace scan, not just deltas — gives a clear cron
--     heartbeat ("did the cron actually run?") without a separate cron
--     metrics table. Slight storage cost (100 workspaces × daily = 100
--     rows/day; bounded by total billing-active workspace count).
--   * RLS enabled with NO policies — same posture as stripe_events.
--     Authenticated + anon get zero rows; service-role bypasses. The
--     cron route is the only writer; future operator queries hit via
--     SQL editor (service-role) or a dedicated admin tool (also
--     service-role).
--   * `status` allowlist constrains the four cases we expect:
--       synced     — Stripe quantity differed; we called subscriptionItems.update and it succeeded
--       no_change  — current Stripe qty matches computed; no API call made
--       skipped    — workspace has no stripe_subscription_id (e.g. Track A pre-card founders); harmless skip
--       error      — API call or computation failed; error_message has details
--   * `from_qty` is nullable (we couldn't fetch from Stripe before syncing)
--     but `to_qty` is required — we always compute the local seat count
--     before reaching for Stripe, so to_qty is always known.
--   * `delta` is a generated column — DB does the arithmetic so the
--     monitoring "show me yesterday's actual changes" query is trivial.
--
-- DOWN PLAN:
--   drop table public.seat_sync_log;
-- No data loss concerns — this is a write-once audit cache that can be
-- rebuilt by running the cron N times. The two billing tables don't
-- depend on this row; they're the source-of-truth.
-- ============================================================================

create table public.seat_sync_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  stripe_subscription_id text,
  -- Local computed seat count at run time. Always present — we compute it
  -- before reaching for Stripe.
  to_qty integer not null,
  -- Stripe-side quantity at run time. May be null when we skipped the
  -- Stripe fetch (e.g. status='skipped') or if the fetch failed.
  from_qty integer,
  -- Generated delta — DB does the arithmetic. Postgres GENERATED ALWAYS
  -- columns are immutable and trivially indexable for monitoring queries
  -- like "show me workspaces whose seat count changed in the last week."
  delta integer generated always as (
    case when from_qty is not null then to_qty - from_qty else null end
  ) stored,
  ran_at timestamptz not null default now(),
  status text not null
    constraint seat_sync_log_status_check check (status in (
      'synced', 'no_change', 'skipped', 'error'
    )),
  -- Populated only when status='error'. Stripe error messages can be
  -- long — text not varchar to avoid arbitrary truncation.
  error_message text
);

comment on table public.seat_sync_log is
  'Per-workspace per-run audit of Track B seat sync attempts. Service-role '
  'only; RLS enabled with no policies. Written by /api/cron/sync-seats.';

comment on column public.seat_sync_log.delta is
  'Generated: to_qty - from_qty. Positive = seats added, negative = removed, '
  'null when from_qty unknown (skipped/error before Stripe fetch).';

-- Monitoring index: "show me changes in the last week."
create index seat_sync_log_workspace_ran_idx
  on public.seat_sync_log (workspace_id, ran_at desc);

-- Support index: "show me errors across all workspaces."
create index seat_sync_log_errors_idx
  on public.seat_sync_log (ran_at desc)
  where status = 'error';

-- RLS enabled with no policies — authenticated + anon see zero rows.
-- Service-role bypasses; webhook + cron handlers are the writers.
alter table public.seat_sync_log enable row level security;


-- ============================================================================
-- POST-APPLY VERIFICATION — paste each into Supabase SQL editor after
-- running the migration; expected outputs inline.
-- ============================================================================
--
-- VERIFY 1 — table shape (8 columns expected; note `delta` is generated).
--
-- select column_name, data_type, is_nullable, column_default, is_generated
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'seat_sync_log'
-- order by ordinal_position;
--
-- Expected (8 rows):
--   id                       uuid       NO   gen_random_uuid()  NEVER
--   workspace_id             uuid       NO   null               NEVER
--   stripe_subscription_id   text       YES  null               NEVER
--   to_qty                   integer    NO   null               NEVER
--   from_qty                 integer    YES  null               NEVER
--   delta                    integer    YES  null               ALWAYS
--   ran_at                   timestamptz NO  now()              NEVER
--   status                   text       NO   null               NEVER
--   error_message            text       YES  null               NEVER
--
-- VERIFY 2 — RLS enabled, zero policies.
--
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public' and tablename = 'seat_sync_log';
-- -- expect: rowsecurity = true
--
-- select count(*) as policy_count from pg_policies
-- where schemaname = 'public' and tablename = 'seat_sync_log';
-- -- expect: policy_count = 0
--
-- VERIFY 3 — CHECK constraint installed.
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.seat_sync_log'::regclass and contype = 'c';
--
-- Expected: seat_sync_log_status_check with the 4-value allowlist.
--
-- VERIFY 4 — indexes landed (3 total: PK + 2 we added).
--
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'seat_sync_log'
-- order by indexname;
--
-- Expected (3 rows):
--   seat_sync_log_errors_idx       CREATE INDEX … (ran_at DESC) WHERE status = 'error'
--   seat_sync_log_pkey             CREATE UNIQUE INDEX … (id)
--   seat_sync_log_workspace_ran_idx CREATE INDEX … (workspace_id, ran_at DESC)
-- ============================================================================
