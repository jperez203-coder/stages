-- ============================================================================
-- Slice S1 Phase 2: audit_grant_without_rls() SECURITY DEFINER RPC helper
-- ============================================================================
--
-- Backs the Tier 2 / T2.3 canary in scripts/test-rls-phase3.mjs: detects
-- any public-schema table that has been granted to authenticated/anon
-- without a corresponding RLS policy (the dangerous half of the dual-
-- layer failure mode documented in docs/RLS-AUDIT.md § 5 — GRANT permits,
-- RLS missing → silent exploit).
--
-- ── WHY SECURITY DEFINER ───────────────────────────────────────────────
--
-- information_schema views in PostgreSQL filter rows based on what the
-- calling role can see. Run AS authenticated, the views would only show
-- grants and policies the authenticated role can directly read — which
-- might exclude some grants and produce a false-clean result. The whole
-- point of the canary is to see the truth. SECURITY DEFINER runs the
-- function body as the function owner (postgres) and returns the
-- unfiltered truth.
--
-- Trade-off: the unfiltered truth exposes schema metadata (table names,
-- RLS state, grant subjects) to any authenticated caller. This metadata
-- is benign — same data is in pg_class / pg_policies / information_schema
-- when accessible — but the per-role filtering normally narrows it. We
-- accept the broader exposure for test reliability.
--
-- ── set search_path = '' (defense against search_path injection) ──────
--
-- Standard hardening for SECURITY DEFINER functions. Forces every object
-- reference inside the function body to be schema-qualified explicitly
-- (we use public.<table> and pg_class etc. directly), so a malicious
-- search_path can't shadow the names with attacker-controlled objects.
--
-- ── GRANT POSTURE (mirrors the lesson from Fix 4 / 20260624140300) ────
--
-- In Supabase, anon and authenticated are DISTINCT roles. Revoking from
-- PUBLIC does not transitively revoke from either. This migration
-- explicitly revokes from public AND anon, then grants only to
-- authenticated.
--
-- ── RETURN SHAPE ──────────────────────────────────────────────────────
--
-- Returns a table (one row per violating table) so the test harness can
-- surface WHICH tables are the problem on failure, not just the count.
-- Empty result = healthy (matches the original Phase 1 Query 5 expected
-- behavior post-Fix-1).
--
-- ── DOWN PLAN ──────────────────────────────────────────────────────────
--
--   drop function if exists public.audit_grant_without_rls();
-- ============================================================================


create or replace function public.audit_grant_without_rls()
returns table (
  table_name      text,
  rls_enabled     boolean,
  policy_count    integer,
  risky_grants    text[]
)
language sql
security definer
stable
set search_path = ''
as $$
  with user_facing_tables as (
    select distinct table_name::text as t
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('authenticated', 'anon')
    union
    select distinct table_name::text as t
    from information_schema.column_privileges
    where table_schema = 'public'
      and grantee in ('authenticated', 'anon')
  )
  select
    c.relname::text                                                 as table_name,
    c.relrowsecurity                                                as rls_enabled,
    (
      select count(*)::integer
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename  = c.relname
    )                                                               as policy_count,
    (
      select array_agg(distinct g.grantee || ':' || g.privilege_type order by g.grantee || ':' || g.privilege_type)
      from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.table_name   = c.relname
        and g.grantee in ('authenticated', 'anon')
    )                                                               as risky_grants
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join user_facing_tables u      on u.t   = c.relname::text
  where n.nspname  = 'public'
    and c.relkind  = 'r'
    and (
      c.relrowsecurity = false
      or (
        select count(*)
        from pg_catalog.pg_policies p
        where p.schemaname = 'public'
          and p.tablename  = c.relname
      ) = 0
    )
  order by c.relname;
$$;


-- ─── Grants — least-privilege EXECUTE allowlist (Fix-4 lesson) ────────────

revoke execute on function public.audit_grant_without_rls() from public;
revoke execute on function public.audit_grant_without_rls() from anon;
grant   execute on function public.audit_grant_without_rls() to   authenticated;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
--
-- (a) Function exists with the right signature + security context.
--
--   select proname, prosecdef, provolatile,
--          pg_catalog.pg_get_function_identity_arguments(oid) as args,
--          pg_catalog.pg_get_function_result(oid) as result_type
--   from pg_catalog.pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'audit_grant_without_rls';
--   -- Expected: 1 row. prosecdef=true. provolatile='s'.
--   --   args = '' (no parameters)
--   --   result_type = 'TABLE(table_name text, rls_enabled boolean, ...)'.
--
-- (b) Grants tight: authenticated only.
--
--   select grantee, privilege_type
--   from information_schema.routine_privileges
--   where routine_schema = 'public'
--     and routine_name = 'audit_grant_without_rls';
--   -- Expected: 1 row.
--   --   grantee='authenticated', privilege_type='EXECUTE'.
--   -- (Should NOT include public or anon.)
--
-- (c) Canary returns zero rows in current healthy state (post-Slice-S1-Phase-3).
--
--   select * from public.audit_grant_without_rls();
--   -- Expected: 0 rows. Any rows here mean a public-schema table has
--   -- anon/authenticated GRANTs without a corresponding RLS policy —
--   -- the dangerous half of the dual-layer failure mode. Investigate
--   -- the named tables immediately.
-- ============================================================================
