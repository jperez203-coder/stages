-- ===========================================================================
-- upgrade_interest — waitlist capture for paid-agency plans
-- 2026-06-12 (Phase 1, pre-Stripe)
-- ===========================================================================
--
-- PURPOSE
--   Capture interest from pure clients (and anyone else) in upgrading to a
--   paid Stages agency workspace, BEFORE Stripe billing exists. This is
--   the C1 swap-point's destination: when a pure client hits the
--   workspace-creation flow we currently silently bounce; from now on we
--   route them to /upgrade, where they can drop their email + plan
--   preference and we'll notify them when paid plans launch.
--
--   No Stripe / checkout / billing here — this table is interest
--   capture and discovery validation only. Real payment plumbing lands
--   as its own slice.
--
-- WRITERS
--   The /upgrade page form (any authenticated user, posting their own
--   user_id via the INSERT policy below). Anti-spam is the
--   `user_id = auth.uid()` WITH CHECK — a user can only submit on
--   behalf of themselves.
--
-- READERS
--   The same authenticated user (for "you're on the list" UX). Admin
--   reads + waitlist exports happen via the service role outside RLS.
--
-- CASCADE FOOTPRINT
--   user_id has ON DELETE SET NULL — if a Supabase auth.users row gets
--   deleted (rare; we don't auto-delete users, but admin actions or
--   future GDPR flows might), the waitlist row survives with NULL
--   user_id so the email + interest signal isn't lost for product
--   research.
--
-- DOWN PLAN
--   drop policy upgrade_interest_select on public.upgrade_interest;
--   drop policy upgrade_interest_insert on public.upgrade_interest;
--   drop index if exists public.upgrade_interest_user_idx;
--   drop index if exists public.upgrade_interest_email_idx;
--   drop table if exists public.upgrade_interest;
--
-- VERIFICATION QUERIES (run in SQL editor after applying)
--   select tablename from pg_tables where tablename = 'upgrade_interest';
--   select policyname, cmd from pg_policies where tablename = 'upgrade_interest';
--   -- Expect: 1 table, 2 policies (insert + select).
-- ===========================================================================

create table public.upgrade_interest (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid null references auth.users(id) on delete set null,
  email         text not null,
  source        text not null default 'switcher_cta',
  plan_interest text null,
  notes         text null,
  created_at    timestamptz not null default now()
);

-- Case-insensitive email lookup — admins / exports group by lowercased email.
create index upgrade_interest_email_idx
  on public.upgrade_interest(lower(email));

-- Per-user lookup for the "you're on the list" UX.
create index upgrade_interest_user_idx
  on public.upgrade_interest(user_id);

alter table public.upgrade_interest enable row level security;

-- INSERT — any authenticated user can submit their OWN interest. The
-- WITH CHECK binds user_id to auth.uid() so a malicious client can't
-- post on behalf of another user.
create policy upgrade_interest_insert
  on public.upgrade_interest for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- SELECT — users can read only their own rows. Powers the "you're on
-- the list" surface on /upgrade. Admin reads bypass RLS via service
-- role (waitlist exports happen there, not via the user-facing API).
create policy upgrade_interest_select
  on public.upgrade_interest for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No UPDATE / DELETE policies. Waitlist entries are append-only — if a
-- user changes their mind, they can submit a new row with updated
-- preferences. Keeps the signal log honest and auditable.
