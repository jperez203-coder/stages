-- ============================================================================
-- Stripe billing — slice 1 foundation (Track B)
--
-- Two new tables that mirror Stripe state into Postgres so the app can read
-- billing identity / status without an out-of-band Stripe API call on every
-- page render. RLS is row-only and strict — separate tables instead of
-- adding columns to profiles/workspaces because:
--
--   * Postgres RLS can't filter columns from rows a user is allowed to read.
--     Adding stripe_customer_id to profiles would either leak it across
--     workspace memberships (via the existing profiles_select policy) or
--     require column-level GRANT gymnastics — both fragile.
--   * Billing rows update frequently from webhooks; isolating in their own
--     hot-update tables avoids constant pg_xact / lock contention with the
--     main profiles / workspaces rows.
--   * Future entity migration (e.g. SalesEdge LLC → C-corp) is easier when
--     billing is a distinct surface that can be re-pointed without touching
--     identity tables.
--
-- Locked decisions (founder-confirmed before write):
--   * subscription_status is NOT NULL with NO DEFAULT — every INSERT must
--     supply a Stripe-aligned status. Eliminates silent 'none' rows from
--     missed webhook mappings.
--   * Only the checkout.session.completed webhook handler INSERTs
--     workspace_billing rows (Slice 2). All other webhooks UPDATE. No race
--     between event types, no need for a default placeholder status.
--   * Status allowlist tracks Stripe's subscription status enum exactly:
--     incomplete, trialing, active, past_due, canceled, unpaid, paused.
--     Any new Stripe status surfacing in the wild (e.g. they add a new
--     state) requires a migration to extend the CHECK; don't silently
--     widen the allowlist in app code.
--   * `plan` allowlist is currently ('solo','team') — Track B's two tiers.
--     Track A (founding members) will land later and may add a value here.
--
-- Write surface (no INSERT/UPDATE policies for authenticated):
--   * Both tables expect writes to come from server-side code using the
--     service-role key. Stripe webhook handlers (Slice 2) and the
--     checkout-init server action are the only writers. The privacy harness
--     (test-stripe-billing-rls.mjs) seeds rows the same way.
--   * user_billing has a self-UPDATE policy as defense in depth — the user
--     themselves never SHOULD mutate their own stripe_customer_id from the
--     client, but if a future feature needs it (e.g. "regenerate customer
--     for a stale email change"), the policy already exists.
--
-- READ surface (RLS-allowed SELECTs):
--   * user_billing: self only. user_id = auth.uid().
--   * workspace_billing: workspace owner OR admin only. Members + clients
--     get zero rows — they have no business knowing billing status. The
--     /settings/billing UI (Slice 4) will gate visibility on this naturally
--     because the SELECT returns nothing for non-privileged callers.
--
-- DOWN PLAN: if we need to roll back, the order is:
--   drop policy workspace_billing_select on public.workspace_billing;
--   drop policy user_billing_select on public.user_billing;
--   drop policy user_billing_update on public.user_billing;
--   drop trigger workspace_billing_touch on public.workspace_billing;
--   drop trigger user_billing_touch on public.user_billing;
--   drop table public.workspace_billing;
--   drop table public.user_billing;
--   drop function public.touch_updated_at();  -- only if no other table uses it
-- The Stripe-side Customer / Subscription / Price objects are NOT dropped
-- by this rollback — they live in Stripe and would need separate cleanup.
-- ============================================================================

-- ─── Shared updated_at helper ────────────────────────────────────────────────
-- Generic BEFORE-UPDATE trigger that stamps NEW.updated_at. Defined here
-- because no prior migration introduced it; future tables can reuse this
-- single function. CREATE OR REPLACE keeps the migration idempotent if a
-- later migration also tries to define it (last-write-wins on bodies that
-- match; harmless redefinition since the body is trivial).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is
  'Generic BEFORE UPDATE trigger that stamps NEW.updated_at = now(). '
  'Reusable across any table with an updated_at timestamptz column.';

-- ─── user_billing ────────────────────────────────────────────────────────────
-- One row per Stages user that has an associated Stripe Customer. Created
-- LAZILY at first paid action (Slice 2 checkout) — fresh signups do NOT get
-- a row until they engage with billing. Means a brand-new signup will have
-- zero rows here, which is the correct "no Stripe relationship yet" state.
create table public.user_billing (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_billing is
  'Per-user Stripe billing identity. One row per Stages user that has a '
  'Stripe Customer record. Populated lazily at first paid action.';

comment on column public.user_billing.stripe_customer_id is
  'Stripe Customer ID (cus_…). UNIQUE — guards against double-creation from '
  'concurrent checkout flows or webhook retries. May be NULL briefly during '
  'a multi-step provisioning flow that inserts the row before the Stripe '
  'API call returns; in practice we always have it before INSERT.';

alter table public.user_billing enable row level security;

-- Self-SELECT only — billing identity is private.
create policy user_billing_select on public.user_billing
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Self-UPDATE only — defense in depth; not normally exercised from client code.
create policy user_billing_update on public.user_billing
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- No INSERT / DELETE policies — service-role writes only. Slice 2's
-- checkout-init handler INSERTs; nothing in v1 deletes (we'll soft-handle
-- account closure in Slice 4).

create trigger user_billing_touch
  before update on public.user_billing
  for each row execute function public.touch_updated_at();

-- ─── workspace_billing ───────────────────────────────────────────────────────
-- One row per workspace that has an active Stripe Subscription. Mirrors
-- the subset of Stripe subscription state we surface in the app UI.
create table public.workspace_billing (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  stripe_subscription_id text unique,
  -- NOT NULL with NO DEFAULT — every INSERT must supply a Stripe-aligned
  -- status. Stripe's subscription status enum, verbatim. Adding a value
  -- here requires a migration; don't silently widen the allowlist in app
  -- code. (Stripe occasionally adds states — incomplete_expired existed
  -- briefly, paused was added in 2023 — when that happens, write a
  -- migration to extend this constraint.)
  subscription_status text not null
    constraint workspace_billing_status_check check (subscription_status in (
      'incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'
    )),
  plan text not null default 'solo'
    constraint workspace_billing_plan_check check (plan in ('solo', 'team')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workspace_billing is
  'Per-workspace Stripe subscription mirror. One row per workspace with an '
  'active or historical Stripe subscription. Populated by '
  'checkout.session.completed webhook (Slice 2); updated by all other '
  'subscription.* and invoice.* webhooks.';

comment on column public.workspace_billing.subscription_status is
  'Stripe subscription status. Allowlist mirrors Stripe''s enum exactly. '
  'Adding a value requires a migration to extend the CHECK constraint.';

comment on column public.workspace_billing.plan is
  'Internal plan key. solo = $29/seat/mo, team = $39/seat/mo. Distinct from '
  'stripe_price_id (which lives in Stripe) — the plan key is the stable '
  'app-facing identifier; price IDs change when we rev pricing.';

alter table public.workspace_billing enable row level security;

-- Owner or admin SELECT only. Members + clients get zero rows.
create policy workspace_billing_select on public.workspace_billing
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = workspace_billing.workspace_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
    )
  );

-- No INSERT / UPDATE / DELETE policies — service-role writes only.
-- Webhook handlers in Slice 2 are the only callers that mutate this table.

create trigger workspace_billing_touch
  before update on public.workspace_billing
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- POST-APPLY VERIFICATION — paste each query below into the Supabase SQL
-- editor after running the migration; the expected outputs are inline. Any
-- mismatch = the migration partially applied or a name drifted.
-- ============================================================================
--
-- VERIFY 1 — tables exist with the columns we expect.
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name in ('user_billing', 'workspace_billing')
-- order by table_name, ordinal_position;
--
-- Expected: 4 rows for user_billing (user_id, stripe_customer_id,
-- created_at, updated_at) and 7 rows for workspace_billing (workspace_id,
-- stripe_subscription_id, subscription_status, plan, trial_ends_at,
-- current_period_end, created_at, updated_at — 8 rows actually). All
-- *_id columns NO NULL. subscription_status NOT NULL, no default.
-- plan NOT NULL default 'solo'. trial_ends_at + current_period_end nullable.
--
-- VERIFY 2 — RLS is enabled on both tables.
--
-- select tablename, rowsecurity from pg_tables
-- where schemaname = 'public'
--   and tablename in ('user_billing', 'workspace_billing');
--
-- Expected: rowsecurity = true for both rows.
--
-- VERIFY 3 — policies installed.
--
-- select polname, polcmd, pg_get_expr(polqual, polrelid) as using_clause
-- from pg_policy
-- where polrelid in (
--   'public.user_billing'::regclass,
--   'public.workspace_billing'::regclass
-- )
-- order by polrelid, polname;
--
-- Expected: 3 policies total:
--   user_billing_select   (r)  using: (user_id = (select auth.uid()))
--   user_billing_update   (w)  using: (user_id = (select auth.uid()))
--   workspace_billing_select (r) using: exists(...workspace_memberships...)
--
-- VERIFY 4 — CHECK constraints landed.
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.workspace_billing'::regclass
--   and contype = 'c';
--
-- Expected: workspace_billing_status_check + workspace_billing_plan_check
-- with the allowlists shown above.
--
-- VERIFY 5 — updated_at trigger fires (smoke test).
--
-- begin;
--   insert into public.user_billing (user_id, stripe_customer_id)
--   values ((select id from public.profiles limit 1), 'cus_test_smoke');
--   select user_id, stripe_customer_id, created_at, updated_at
--   from public.user_billing where stripe_customer_id = 'cus_test_smoke';
--   update public.user_billing
--   set stripe_customer_id = 'cus_test_smoke_2'
--   where stripe_customer_id = 'cus_test_smoke';
--   select stripe_customer_id, created_at, updated_at
--   from public.user_billing where stripe_customer_id = 'cus_test_smoke_2';
-- rollback;
--
-- Expected: updated_at on second SELECT is strictly greater than
-- created_at (the trigger stamped it on UPDATE). ROLLBACK leaves no test
-- data behind.
-- ============================================================================
