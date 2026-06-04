-- ============================================================================
-- Stripe webhook dedup + audit log — slice 2 (Track B)
--
-- Stripe occasionally re-delivers webhook events: network blip, 5xx from
-- our endpoint, deliberate replay from the Stripe Dashboard "Resend"
-- button. Naively re-running every handler would be safe for the
-- idempotent ones we ship in slice 2 (UPSERT on workspace_id PK,
-- UPDATE on stripe_subscription_id) — but the moment a future handler
-- isn't idempotent (e.g. one that increments a counter, emits a Resend
-- notification email, or writes an audit row), a re-delivery causes
-- duplicate side effects.
--
-- This table is the explicit dedup layer + permanent audit trail. Two
-- jobs:
--   1. DEDUP — every webhook handler INSERTs (event_id) ON CONFLICT DO
--      NOTHING at the top. If the row already existed AND was processed
--      successfully, the handler short-circuits with 200. If it existed
--      but processed=false, it re-attempts (Stripe-retry-after-our-5xx
--      semantics).
--   2. AUDIT — `payload` JSONB captures the full event Stripe sent. When
--      a customer support question comes in ("you didn't bill me right /
--      you canceled when I didn't"), the row is the source-of-truth for
--      what we received and when.
--
-- Locked decisions (founder-confirmed in slice 2 plan):
--   * `event_id` is the PK — Stripe guarantees uniqueness across all
--     events your account ever receives.
--   * `payload jsonb` (not text) so we can index/query later if support
--     volume warrants. No GIN index in slice 2 — wait for a real query.
--   * NO RLS POLICIES — RLS is enabled (Supabase guardrail), but with
--     no SELECT/INSERT/UPDATE/DELETE policy, authenticated + anon roles
--     get zero rows on SELECT and 42501 on writes. Service-role bypasses
--     RLS and is the only writer. Webhook events contain Stripe payloads
--     (Customer IDs, amounts, internal metadata) — no user has any
--     business reading them via the app.
--   * `processed_successfully` defaults to false on INSERT, flipped to
--     true after the handler completes without error. A row with
--     processed=false AFTER the expected processing window is the
--     support-debugging signal for "this event errored partway."
--
-- DOWN PLAN:
--   drop table public.stripe_events;
-- No data loss concerns — this is a write-once cache that Stripe can
-- replay on demand if we ever needed to rebuild it (within their
-- retention window). The two billing tables don't depend on this row;
-- they're the source-of-truth.
-- ============================================================================

create table public.stripe_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now(),
  payload jsonb,
  processed_successfully boolean not null default false
);

comment on table public.stripe_events is
  'Stripe webhook dedup + audit. Service-role only; RLS enabled with no '
  'policies so authenticated + anon roles see zero rows. Webhook handler '
  'INSERTs on receipt (ON CONFLICT DO NOTHING dedup), UPDATEs '
  'processed_successfully=true on handler completion.';

comment on column public.stripe_events.event_id is
  'Stripe event ID (evt_…). UNIQUE PK — Stripe guarantees uniqueness '
  'across all events to your account, which is why we use it directly '
  'instead of a generated UUID.';

comment on column public.stripe_events.processed_successfully is
  'false on INSERT, true after handler runs without error. A row with '
  'processed_successfully=false after the expected processing window '
  'indicates a partially-processed event — see stripe_events_unprocessed_idx '
  'for monitoring / support queries.';

-- Partial index for the support / monitoring query
-- "show me unprocessed events, newest first":
--   select event_id, event_type, received_at from stripe_events
--   where processed_successfully = false order by received_at desc;
-- Partial keeps the index tiny — only failed/in-flight rows are indexed,
-- which should be 0 in steady state.
create index stripe_events_unprocessed_idx
  on public.stripe_events (received_at desc)
  where processed_successfully = false;

-- RLS enabled with NO policies. Denies all SELECT/INSERT/UPDATE/DELETE
-- from authenticated + anon roles. Service-role bypasses RLS and is the
-- only writer (webhook handler via getSupabaseAdmin()).
alter table public.stripe_events enable row level security;


-- ============================================================================
-- POST-APPLY VERIFICATION — paste each query into Supabase SQL editor
-- after running the migration; expected outputs are inline.
-- ============================================================================
--
-- VERIFY 1 — table exists with the right columns.
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'stripe_events'
-- order by ordinal_position;
--
-- Expected: 5 rows in order — event_id (text, NO, null), event_type
-- (text, NO, null), received_at (timestamptz, NO, now()), payload
-- (jsonb, YES, null), processed_successfully (boolean, NO, false).
--
-- VERIFY 2 — RLS enabled AND no policies installed.
--
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public' and tablename = 'stripe_events';
-- -- expect: rowsecurity = true (or 't')
--
-- select count(*) as policy_count from pg_policies
-- where schemaname = 'public' and tablename = 'stripe_events';
-- -- expect: policy_count = 0
--
-- VERIFY 3 — partial index landed.
--
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public' and tablename = 'stripe_events'
-- order by indexname;
--
-- Expected: 2 rows —
--   stripe_events_pkey (CREATE UNIQUE INDEX … (event_id))
--   stripe_events_unprocessed_idx (CREATE INDEX … (received_at DESC)
--     WHERE processed_successfully = false)
--
-- ============================================================================
