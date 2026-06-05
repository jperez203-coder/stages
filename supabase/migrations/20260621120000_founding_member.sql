-- ============================================================================
-- Track A founding member flow — schema (Slice 5)
--
-- Two new columns + column-GRANT lockdown on profiles.is_founding_member +
-- partial index for the day-28 cron query.
--
-- Track A is the FB-DM-convert offer: 30 days free, no card required, then
-- 50% off for life IF a card is added before the 30-day window expires.
-- Founders are minted via manual SQL grant (no self-serve sign-up flow
-- ships in this slice — honor system on the closing of the offer).
--
-- LOCKED DECISIONS (founder-approved before write):
--   * is_founding_member RLS posture: column-level GRANT, NOT trigger
--     (Option A from the slice 5 plan thread 1). Authenticated cannot
--     UPDATE this column at all — the column permission is revoked at the
--     GRANT layer, before RLS or any trigger fires.
--   * Day-28 nudge dedup via day28_notified_at column + 0-72h cron window.
--     Idempotent, cron-skip resilient. Email template renders remaining
--     time dynamically so "3 days" / "2 days" / "tomorrow" all work from
--     one template.
--   * No founding_tier text vs is_founding_member boolean — boolean stays.
--     Future second cohort (different offer) would migrate to enum then.
--   * No founding_offer_expires_at — flag is eternal. "Once a founding
--     member, always a founding member" — the coupon is applied whenever
--     they finally upgrade, even months later.
--
-- DOWN PLAN:
--   drop index workspace_billing_day28_pending_idx;
--   alter table public.workspace_billing drop column day28_notified_at;
--   revoke update (display_name, company_name, last_active_workspace_id,
--                  last_active_pipeline_id) on public.profiles from authenticated;
--   grant update on public.profiles to authenticated, anon;  -- restore default
--   drop index profiles_founding_member_idx;
--   alter table public.profiles drop column is_founding_member;
-- The Stripe-side coupon is NOT dropped by this rollback — separate cleanup
-- via stripe.coupons.del() if ever needed.
-- ============================================================================


-- ─── profiles.is_founding_member ─────────────────────────────────────────────
alter table public.profiles
  add column is_founding_member boolean not null default false;

comment on column public.profiles.is_founding_member is
  'Track A founding member flag. Once true, always true. Drives the 50% '
  'lifetime coupon application at upgrade time + the day-28 banner/email '
  'path. Set ONLY via service-role (manual SQL grant template until '
  'self-serve ships). Column UPDATE is locked at the GRANT layer below.';

-- Partial index — the cohort is small; only index TRUE rows.
create index profiles_founding_member_idx
  on public.profiles (id)
  where is_founding_member = true;


-- ─── Column GRANT lockdown on profiles UPDATE ───────────────────────────────
--
-- Postgres UPDATE permission can be scoped to a column subset via GRANT.
-- Default Supabase grants give the authenticated role broad UPDATE on
-- public.profiles (RLS then gates row access). We REVOKE that broad UPDATE
-- and re-grant on the explicit subset of columns that ARE user-writeable
-- today. `is_founding_member` is OMITTED from the allowlist — authenticated
-- callers attempting `update profiles set is_founding_member = true ...`
-- get 42501 (insufficient_privilege) from the column-permission check
-- BEFORE RLS or any trigger fires.
--
-- Service role bypasses RLS AND column-level GRANTs, so the manual SQL grant
-- template Jordan uses to mark founders
--   (`update profiles set is_founding_member = true where email = $1;`)
-- continues to work — the Supabase SQL editor runs as service_role.
--
-- Column allowlist (derived by grepping every src/ user-route call site
-- that mutates profiles):
--   display_name              — settings/account, portal/accept/[token]
--   company_name              — settings/account, onboarding/create-workspace
--   last_active_workspace_id  — onboarding, accept-invite, WorkspaceSelector,
--                               HeaderWorkspaceSwitcher
--   last_active_pipeline_id   — w/[slug]/p/new (last-visited tracking)
--
-- NOT in the allowlist (no user route writes these today; locking is safe):
--   id, email, created_at, avatar_url, is_founding_member
--
-- IF A FUTURE FEATURE NEEDS TO WIDEN THIS (e.g. user-uploaded avatars),
-- the fix is a one-line follow-up migration:
--   `grant update (avatar_url) on public.profiles to authenticated;`
-- Don't add new user-route UPDATEs of profiles columns without first
-- adding the column here — they'll silently fail with 42501.
--
-- The full GRANT change is documented for any future SECURITY DEFINER
-- function that wants to mutate is_founding_member: such a function MUST
-- perform an explicit authorization check in its body. The GRANT layer
-- only protects against direct PostgREST UPDATEs from authenticated; it
-- doesn't protect against a SECURITY DEFINER function written without
-- thought. Be deliberate.

revoke update on public.profiles from authenticated, anon;
grant update (
  display_name,
  company_name,
  last_active_workspace_id,
  last_active_pipeline_id
) on public.profiles to authenticated;
-- anon stays denied (no policy + no GRANT); service_role retains full
-- UPDATE via bypass.


-- ─── workspace_billing.day28_notified_at ────────────────────────────────────
-- Track A founders get ONE day-28 nudge email + the in-app banner appears
-- when status='trialing' AND trial_ends_at is within 72 hours. To make the
-- cron query idempotent + cron-skip resilient:
--   * day28_notified_at IS NULL filter ensures we email each founder ONCE.
--   * Cron sets day28_notified_at = now() atomically with email enqueue.
--   * 0-72h window means a missed cron cycle never causes a founder to
--     miss their nudge (next cron run picks them up).
--   * Email template renders remaining time dynamically ("3 days" / "2
--     days" / "tomorrow" / "today") so the wider window doesn't degrade
--     copy quality.
alter table public.workspace_billing
  add column day28_notified_at timestamptz;

comment on column public.workspace_billing.day28_notified_at is
  'Track A: set when the day-28-of-trial nudge email is enqueued. NULL '
  'until then. Used as the dedup key by /api/cron/enqueue-founding-day28. '
  'Once set, the row drops out of the partial index below; never cleared '
  'by app code (would re-fire the nudge).';

-- Partial index for the cron's hot query — only rows in the eligible
-- window are indexed. Steady state: tiny (most founders are either
-- pre-day-28 or already notified).
create index workspace_billing_day28_pending_idx
  on public.workspace_billing (trial_ends_at)
  where subscription_status = 'trialing' and day28_notified_at is null;


-- ============================================================================
-- POST-APPLY VERIFICATION — paste each into Supabase SQL editor.
-- ============================================================================
--
-- VERIFY 1 — profiles.is_founding_member column.
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'profiles'
--   and column_name = 'is_founding_member';
--
-- Expected: 1 row — is_founding_member, boolean, NO, false.
--
-- VERIFY 2 — column-level UPDATE privileges on profiles for authenticated.
--
-- select column_name, privilege_type
-- from information_schema.column_privileges
-- where table_schema = 'public' and table_name = 'profiles'
--   and grantee = 'authenticated' and privilege_type = 'UPDATE'
-- order by column_name;
--
-- Expected: 4 rows — display_name, company_name, last_active_workspace_id,
-- last_active_pipeline_id. is_founding_member is_NOT_ in the result.
-- email, id, created_at, avatar_url are also NOT in the result (locked
-- as a side effect; safe — no user route writes them today).
--
-- VERIFY 3 — workspace_billing.day28_notified_at column.
--
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'workspace_billing'
--   and column_name = 'day28_notified_at';
--
-- Expected: 1 row — day28_notified_at, timestamp with time zone, YES, null.
--
-- VERIFY 4 — both partial indexes installed.
--
-- select indexname, indexdef from pg_indexes
-- where schemaname = 'public'
--   and indexname in (
--     'profiles_founding_member_idx',
--     'workspace_billing_day28_pending_idx'
--   )
-- order by indexname;
--
-- Expected: 2 rows.
--   profiles_founding_member_idx           → … (id) WHERE (is_founding_member = true)
--   workspace_billing_day28_pending_idx    → … (trial_ends_at) WHERE
--      ((subscription_status = 'trialing'::text) AND (day28_notified_at IS NULL))
--
-- VERIFY 5 — lockdown smoke test (run as the calling user in SQL editor;
-- this should be SERVICE_ROLE in the editor so it succeeds. The privacy
-- harness will probe the authenticated-fail case via a real JWT later.)
--
-- select count(*) from public.profiles;
-- -- service-role: sees all rows
-- -- authenticated would see only the rows their RLS allows
--
-- Optional: confirm the GRANT statement was applied by inspecting role
-- privileges:
--
-- select grantee, array_agg(column_name order by column_name) as columns
-- from information_schema.column_privileges
-- where table_schema = 'public' and table_name = 'profiles'
--   and privilege_type = 'UPDATE'
-- group by grantee
-- order by grantee;
--
-- Expected:
--   authenticated → {company_name, display_name, last_active_pipeline_id, last_active_workspace_id}
--   service_role  → {avatar_url, company_name, created_at, display_name, email, id,
--                    is_founding_member, last_active_pipeline_id,
--                    last_active_workspace_id}   (all columns)
--   postgres / other roles → similar full coverage
-- ============================================================================
