-- ============================================================================
-- Slice S2 Phase 2: audit_public_buckets() SECURITY DEFINER RPC helper
-- ============================================================================
--
-- Backs the Tier 2 / S2.5 standing-invariant canary in
-- scripts/test-rls-phase3.mjs: detects any storage bucket whose `public`
-- flag is not explicitly `false`.
--
-- Per docs/STORAGE-AUDIT.md § 3 + CLAUDE.md → Security Model → "Storage
-- bucket policies", the locked posture is: every Stages bucket MUST be
-- private (`public = false`). Today this is true — Slice S2 Phase 1
-- confirmed both `stage_attachments` and `pipeline_files` are
-- `public = false`. The canary alarms if any bucket ever drifts — e.g.
-- a maintainer accidentally flips a bucket public via the Supabase
-- dashboard, or a new bucket gets created without the explicit
-- `public = false` setting.
--
-- ── WHY SECURITY DEFINER ───────────────────────────────────────────────
--
-- Maintains the all-real-JWT pattern locked for the test harness in
-- Slice S1 Phase 2 (commit a473156, audit_grant_without_rls). The RPC
-- runs as the function owner (postgres) so the canary's view of
-- storage.buckets is consistent regardless of what default-grants
-- Supabase may apply now or in the future. Authenticated callers can
-- invoke the RPC; the result is unfiltered truth.
--
-- ── STRICT public != false (not permissive) ───────────────────────────
--
-- Per Slice S2 Phase 2 Q2 lock: returns a row for ANY bucket where
-- `public IS NULL OR public = true`. Equivalent to
-- `coalesce(public, true) = true`. The strict form catches:
--
--   - `public = true` — the actual exploit posture.
--   - `public IS NULL` — default-uncertainty. Defensive coding requires
--     explicit state; future Supabase schema migrations could change
--     defaults without notice.
--
-- Zero rows = healthy (all buckets explicitly `public = false`).
--
-- The naive form `where public != false` would NOT match NULL rows
-- because `NULL != false` evaluates to NULL, not true — so we have to
-- spell out the IS NULL / = true alternation explicitly.
--
-- ── set search_path = '' (defense against search_path injection) ──────
--
-- Standard SECURITY DEFINER hardening. Every object reference inside
-- the body is schema-qualified explicitly (storage.buckets).
--
-- ── GRANT POSTURE (Fix-4 lesson) ──────────────────────────────────────
--
-- In Supabase, `anon` and `authenticated` are distinct roles. Revoking
-- from PUBLIC does NOT transitively cover them. This migration revokes
-- explicitly from both PUBLIC and anon, then grants only to
-- authenticated. Same shape as audit_grant_without_rls (commit a473156).
--
-- ── RETURN SHAPE ──────────────────────────────────────────────────────
--
-- Returns a table (one row per offending bucket) so the test harness
-- can surface WHICH bucket is misconfigured on failure, not just a
-- count.
--
-- ── DOWN PLAN ─────────────────────────────────────────────────────────
--
--   drop function if exists public.audit_public_buckets();
-- ============================================================================


create or replace function public.audit_public_buckets()
returns table (
  bucket_id text,
  public    boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    b.id::text as bucket_id,
    b.public   as public
  from storage.buckets b
  where b.public is null or b.public = true
  order by b.id;
$$;


-- ─── Grants — least-privilege EXECUTE allowlist (Fix-4 lesson) ────────────

revoke execute on function public.audit_public_buckets() from public;
revoke execute on function public.audit_public_buckets() from anon;
grant   execute on function public.audit_public_buckets() to   authenticated;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
--
-- (a) Function exists with right signature + security context.
--
--   select proname, prosecdef, provolatile,
--          pg_catalog.pg_get_function_identity_arguments(oid) as args,
--          pg_catalog.pg_get_function_result(oid) as result_type
--   from pg_catalog.pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'audit_public_buckets';
--   -- Expected: 1 row.
--   --   prosecdef=true. provolatile='s'. args=''.
--   --   result_type='TABLE(bucket_id text, public boolean)'.
--
-- (b) Grants tight: authenticated only.
--
--   select grantee, privilege_type
--   from information_schema.routine_privileges
--   where routine_schema = 'public'
--     and routine_name = 'audit_public_buckets';
--   -- Expected: 1 row.
--   --   grantee='authenticated', privilege_type='EXECUTE'.
--   -- (Should NOT include public or anon.)
--
-- (c) Canary returns zero rows in current healthy state.
--
--   select * from public.audit_public_buckets();
--   -- Expected: 0 rows. Both Stages buckets (stage_attachments,
--   -- pipeline_files) are public=false per the Slice S2 Phase 1 audit.
--   -- Any row here = a bucket has public IS NULL or public = true.
--   -- Investigate which bucket immediately.
-- ============================================================================
