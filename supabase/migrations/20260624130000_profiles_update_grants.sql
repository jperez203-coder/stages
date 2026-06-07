-- ============================================================================
-- Slice 0.1 smoke-test follow-up: capture profiles UPDATE grant as migration
-- ============================================================================
--
-- ⚠ ALREADY APPLIED to production on 2026-06-06 via ad-hoc SQL during the
-- Slice 0.1 smoke test. This migration file exists for restore parity (so a
-- DB rebuild from migrations re-applies the same state) and for the audit
-- trail. GRANT is idempotent — re-applying against the current prod state
-- is a no-op, so it's safe if accidentally re-run.
--
-- ── THE GAP ────────────────────────────────────────────────────────────
--
-- Slice 0.1 (AI consent infrastructure) added a `profiles.ai_consent`
-- JSONB column with the user-level Level 4 toggle. RLS on profiles already
-- permits own-row UPDATE via the existing `profiles_update` policy
-- (id = auth.uid()).
--
-- But the smoke test's first user-toggle attempt failed with:
--   ERROR: 42501  permission denied for table profiles
--
-- Root cause: PostgreSQL checks **table-level GRANT** before RLS evaluation.
-- The `authenticated` role had column-level UPDATE grants on a 5-column
-- allowlist (set by migration 20260621120100_founding_member_grant_amendment.sql):
--   canvas_hint_dismissed, company_name, display_name,
--   last_active_pipeline_id, last_active_workspace_id
--
-- Neither `ai_consent` (added by Slice 0.1) nor `avatar_url` (added by
-- 20260510120000_profile_enrichment.sql, never explicitly granted) was in
-- the allowlist. Every attempt to UPDATE either column from the user-scoped
-- client hit the GRANT check and 42501'd before RLS could approve it.
--
-- ── WHY COLUMN-LEVEL GRANTS (NOT TABLE-LEVEL) ──────────────────────────
--
-- Principle of least privilege. The `authenticated` role can UPDATE rows
-- in `public.profiles` per RLS, but only the columns explicitly allowlisted
-- here. This is belt-and-suspenders against bugs in the RLS policy itself:
-- if a `profiles_update` WITH CHECK clause ever drifts in a future migration
-- and lets users write columns they shouldn't (is_founding_member being
-- the canonical risk), the GRANT layer is the second line of defense.
--
-- ── ⚠ CRITICAL EXCLUSION: is_founding_member ──────────────────────────
--
-- `is_founding_member` is INTENTIONALLY NOT in the GRANT list. It must
-- NEVER be granted to authenticated. If a user could UPDATE this column
-- via direct PostgREST, they could self-grant the 50%-off-forever founding
-- discount (coupon STAGES_FOUNDING_LIFETIME). Eternal-policy locked
-- decision per CLAUDE.md: founding-member status is set server-side only
-- (via the Slice 5 grant migration), never by user action.
--
-- ── COLUMNS NOT IN GRANT LIST (and why each) ────────────────────────────
--
-- Every column on public.profiles that's NOT in the GRANT below:
--
--   id                      — primary key. RLS WITH CHECK would block any
--                             change, but no need to even hand the column
--                             to authenticated.
--   email                   — auth-managed. Mirrored from auth.users.email
--                             via the `sync_profile_email` trigger. Any
--                             direct UPDATE would desync the mirror and
--                             enable account-impersonation tactics.
--   created_at              — immutable audit field. Defaults at insert,
--                             never updated by design.
--   is_founding_member      — CRITICAL EXPLOIT VECTOR (see above).
--
-- ── DOWN PLAN ──────────────────────────────────────────────────────────
--
--   revoke update (ai_consent, avatar_url) on table public.profiles
--     from authenticated;
--
--   -- Reverts JUST the two columns this migration adds. The 5 columns
--   -- granted by the prior amendment (canvas_hint_dismissed, etc.)
--   -- remain because they were granted by a different migration.
-- ============================================================================


grant update (
  display_name,              -- user's own display name
  last_active_workspace_id,  -- UX hint: last workspace the user navigated
  avatar_url,                -- user's own profile picture URL (Google OAuth + planned upload UI)
  last_active_pipeline_id,   -- UX hint: last pipeline the user navigated
  canvas_hint_dismissed,     -- one-time UI dismissal flag for the canvas coachmark
  company_name,              -- user's own agency / company name
  ai_consent                 -- Slice 0.1: user's AI consent preferences JSONB
) on table public.profiles to authenticated;


-- The authenticated allowlist on public.profiles is now (alphabetical):
--   ai_consent                 ← added by THIS migration (Slice 0.1)
--   avatar_url                 ← added by THIS migration (gap fill)
--   canvas_hint_dismissed      ← from 20260621120100
--   company_name               ← from 20260621120000
--   display_name               ← from 20260621120000
--   last_active_pipeline_id    ← from 20260621120000
--   last_active_workspace_id   ← from 20260621120000
--
-- TOTAL: 7 columns granted to authenticated.
--
-- NOT granted to authenticated (4 columns): id, email, created_at,
-- is_founding_member.


-- ============================================================================
-- VERIFICATION QUERIES (commented — already-passing in prod as of 2026-06-06)
-- ============================================================================
--
-- (a) Confirm the full column-level UPDATE allowlist for `authenticated`
--     on public.profiles. Replaces VERIFY 5 from the prior grant migration
--     with the expanded post-Slice-0.1 allowlist.
--
--   select grantee, array_agg(column_name order by column_name) as columns
--   from information_schema.column_privileges
--   where table_schema = 'public'
--     and table_name = 'profiles'
--     and privilege_type = 'UPDATE'
--   group by grantee
--   order by grantee;
--
--   Expected:
--     authenticated → {ai_consent, avatar_url, canvas_hint_dismissed,
--                      company_name, display_name, last_active_pipeline_id,
--                      last_active_workspace_id}  (7 cols)
--     postgres       → all 11 cols  (unchanged)
--     service_role   → all 11 cols  (unchanged)
--
-- (b) Confirm `is_founding_member` is STILL absent from the authenticated
--     allowlist. This is the explicit-exclusion canary: if this query
--     EVER returns a row for the authenticated role + is_founding_member,
--     the founding-discount exploit is open.
--
--   select 1
--   from information_schema.column_privileges
--   where table_schema = 'public'
--     and table_name = 'profiles'
--     and column_name = 'is_founding_member'
--     and grantee = 'authenticated'
--     and privilege_type = 'UPDATE';
--   -- Expected: zero rows. Any row here is an incident.
--
-- ============================================================================
