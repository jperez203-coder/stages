-- ============================================================================
-- Slice S1 Phase 3 Fix 4: workspaces_insert — RLS-layer C1 client-boundary
-- enforcement via can_create_workspace() helper
-- ============================================================================
--
-- Closes the 🚨 CRITICAL finding in docs/RLS-AUDIT.md § 3.1. Highest-risk
-- fix of the Phase 3 sequence — save for last so Phase 2's test harness
-- can validate pre-fix exploitability + post-fix block.
--
-- ── THE GAP ────────────────────────────────────────────────────────────
--
-- Current workspaces_insert policy (from 20260509120000_rls_policies.sql):
--
--   create policy workspaces_insert on public.workspaces
--   for insert with check ((select auth.uid()) is not null);
--
-- WITH CHECK is just "signed in" — any authenticated user can directly
-- POST to /rest/v1/workspaces with their JWT and create a workspace row.
-- The C1 boundary rule (pure clients must NOT be able to create
-- workspaces — CLAUDE.md → Security Model + locked Phase 3 decision in
-- 20260605120000_block_pure_clients_from_create_workspace.sql) is
-- enforced ONLY at the application layer in the
-- create_workspace_with_owner RPC.
--
-- A pure client who opens DevTools and runs
--   await supabase.from('workspaces').insert({ name: 'My escape hatch' })
-- succeeds. They bypass the RPC's check entirely and now have a foothold
-- to insert workspace_memberships for themselves and pivot to agency-
-- side surface.
--
-- ── THE FIX ────────────────────────────────────────────────────────────
--
-- Two parts in one migration:
--
--   1. A SECURITY DEFINER helper function public.can_create_workspace(uuid)
--      that implements the locked three-case rule from the existing RPC
--      (20260605120000) — byte-identical semantics, just lifted into a
--      reusable predicate for RLS to call.
--
--   2. DROP + CREATE workspaces_insert with WITH CHECK calling the helper.
--
-- The existing application-layer check inside create_workspace_with_owner
-- STAYS — defense-in-depth. RPC callers hit the RPC's check first
-- (clearer error message). Direct-PostgREST callers hit the new RLS
-- policy. Both layers enforce the same rule.
--
-- ── THE LOCKED THREE-CASE RULE (Q1 lock, mirrors 20260605120000) ──────
--
--   BLOCK iff has_client AND NOT has_agency       ← pure client
--   ALLOW if zero contexts                         ← brand-new signup
--   ALLOW if any agency context                    ← adding workspaces
--
--   has_agency:
--     - has at least one workspace_memberships row (any role), OR
--     - has at least one pipeline_memberships row with agency-side role
--       (owner / admin / member). This matters for users who only ever
--       participate via direct pipeline invites and never get a
--       workspace_memberships row — they're agency-side participants.
--
--   has_client:
--     - has at least one pipeline_memberships row with role = 'client'.
--
-- Edge cases verified against the RPC behavior:
--   - Brand-new signup (zero memberships of any kind): has_client = false
--     → NOT (false AND …) = true → allowed. Critical for onboarding —
--     WorkspaceSelector auto-routes new sign-ups to /onboarding/create-
--     workspace.
--   - Mixed-role user (client on one pipeline + admin on another, no
--     workspace_memberships): has_client = true, has_agency = true (via
--     pipeline_memberships agency role) → NOT (true AND NOT true) =
--     NOT (true AND false) = NOT false = true → allowed. Agency status
--     takes precedence when overlap exists, matching the RPC's locked
--     behavior.
--   - Pure client (client memberships only, zero workspace + zero
--     agency-role pipeline memberships): has_client = true, has_agency =
--     false → NOT (true AND NOT false) = NOT true = false → blocked.
--
-- ── DOES SECURITY DEFINER RPC INSERT STILL WORK? ──────────────────────
--
-- Yes. create_workspace_with_owner is SECURITY DEFINER → runs as the
-- function owner (postgres role in Supabase), which bypasses RLS. The
-- INSERT inside the RPC is not gated by the new policy. RPC callers
-- continue to be gated by the RPC's own check at the top of the
-- function body (lines 138-151 of 20260605120000).
--
-- The new policy specifically catches the direct-PostgREST path that
-- the RPC's check never sees.
--
-- ── WHY SECURITY DEFINER ON THE HELPER ─────────────────────────────────
--
-- The helper reads pipeline_memberships and workspace_memberships rows
-- that aren't visible to the calling user via their normal RLS view
-- (a pure client can see their own pipeline_memberships but doesn't
-- necessarily have privilege to introspect existence of a workspace_
-- membership outside their own). SECURITY DEFINER runs the predicate
-- with elevated privileges so the EXISTS subqueries return correct
-- truth values regardless of caller's RLS view.
--
-- The function is STABLE — same inputs return same output within a
-- single statement, which lets PostgreSQL cache the result during RLS
-- evaluation across multiple rows (matters at scale if a single INSERT
-- ever batched multiple workspace rows — not today, but cheap insurance).
--
-- set search_path = '' is the SECURITY DEFINER safety standard — every
-- table reference must be fully qualified (public.pipeline_memberships,
-- never just pipeline_memberships) so a search_path-injection attacker
-- cannot redirect the function's table references to a malicious
-- schema. All references below are fully qualified.
--
-- ── POST-APPLY GRANT DISCOVERY (2026-06-07) ───────────────────────────
--
-- The first version of this migration only revoked EXECUTE from PUBLIC:
--   revoke execute on function public.can_create_workspace(uuid) from public;
--
-- I (Claude) assumed that revoking from PUBLIC would transitively cover
-- anon and authenticated. It does not. In Supabase, `anon` and
-- `authenticated` are DISTINCT roles that receive their own EXECUTE
-- grants via the supabase_auth_admin default-grants chain. Revoking
-- from PUBLIC leaves the explicit role-level grants intact.
--
-- Probe (b) caught this post-apply: anon_can_call returned true even
-- after the public revoke. An ad-hoc SQL was applied to close the gap:
--   revoke execute on function public.can_create_workspace(uuid) from anon;
--
-- That REVOKE is now baked into Section 2 below so a restore from
-- migrations matches the prod state.
--
-- ⚠ ALREADY APPLIED to production on 2026-06-07. This file represents
-- the final prod state including the post-apply anon REVOKE. GRANT and
-- REVOKE statements are idempotent — re-applying against current prod
-- is a no-op, so the file is safe if accidentally re-run.
--
-- Lesson for future SECURITY DEFINER + grant-lock migrations: explicitly
-- revoke from EVERY role that should not have EXECUTE, not just PUBLIC.
-- Verify with has_function_privilege('<role>', '<fn>', 'EXECUTE') for
-- each role in the audit set (probe (b) below does this — keep that
-- shape as the standard verification pattern).
--
-- ── DOWN PLAN ──────────────────────────────────────────────────────────
--
-- Restore the pre-fix state byte-for-byte:
--
--   drop policy if exists workspaces_insert on public.workspaces;
--   create policy workspaces_insert on public.workspaces
--     for insert with check ((select auth.uid()) is not null);
--   drop function if exists public.can_create_workspace(uuid);
--
-- Note: the DOWN re-opens the C1 bypass. Only use for emergency
-- rollback if Phase 3 Fix 4 caused a regression in the onboarding
-- flow that can't be quickly diagnosed.
-- ============================================================================


-- ─── 1. can_create_workspace(uuid) helper ─────────────────────────────────

create or replace function public.can_create_workspace(actor uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  -- Locked three-case rule. Mirrors the application-layer check in
  -- public.create_workspace_with_owner (20260605120000 lines 138-151).
  -- Returns true unless the caller is a pure client.
  select
    actor is not null
    and not (
      -- has_client: at least one client pipeline_memberships row
      exists (
        select 1
        from public.pipeline_memberships
        where user_id = actor
          and role = 'client'
      )
      and not (
        -- has_agency: at least one workspace_membership OR at least one
        -- pipeline_memberships row with an agency-side role.
        exists (
          select 1
          from public.workspace_memberships
          where user_id = actor
        )
        or exists (
          select 1
          from public.pipeline_memberships
          where user_id = actor
            and role in ('owner', 'admin', 'member')
        )
      )
    );
$$;


-- ─── 2. Grants — least-privilege EXECUTE allowlist ────────────────────────

-- Default PostgreSQL grants EXECUTE to PUBLIC on new functions. Revoke
-- that and re-grant only to authenticated, matching the existing
-- project pattern (see e.g. 20260608120000_save_pipeline_as_template_rpc).
--
-- IMPORTANT: revoking from PUBLIC does NOT transitively revoke from
-- `anon` or `authenticated` in Supabase — they're distinct roles with
-- their own default-grant chains. Each role that should not have
-- EXECUTE must be revoked explicitly. The anon REVOKE below was added
-- post-apply on 2026-06-07 after probe (b) caught the gap; see the
-- POST-APPLY GRANT DISCOVERY note in the header.
--
-- anon is intentionally excluded — anonymous callers can never satisfy
-- workspaces_insert anyway (auth.uid() is null), but RLS policy
-- evaluation should fail with permission-denied earlier in the pipeline
-- rather than executing the function body for a zero-information call.

revoke execute on function public.can_create_workspace(uuid) from public;
revoke execute on function public.can_create_workspace(uuid) from anon;
grant   execute on function public.can_create_workspace(uuid) to   authenticated;


-- ─── 3. workspaces_insert — DROP + CREATE with helper-gated WITH CHECK ────

drop policy if exists workspaces_insert on public.workspaces;

create policy workspaces_insert on public.workspaces
for insert
with check ( public.can_create_workspace((select auth.uid())) );


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
--
-- (a) Confirm the helper function exists with the expected shape.
--
--   select proname,
--          pg_get_function_identity_arguments(oid) as args,
--          prosecdef as is_security_definer,
--          provolatile,
--          (select array_agg(unnest) from unnest(proconfig)) as proconfig
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'can_create_workspace';
--   -- Expected: 1 row.
--   --   args = 'actor uuid'
--   --   is_security_definer = true
--   --   provolatile = 's' (stable)
--   --   proconfig contains 'search_path='
--
-- (b) Confirm grants on the helper — authenticated has EXECUTE, public
--     does NOT.
--
--   select has_function_privilege('authenticated',
--            'public.can_create_workspace(uuid)', 'EXECUTE') as auth_can_call,
--          has_function_privilege('anon',
--            'public.can_create_workspace(uuid)', 'EXECUTE') as anon_can_call,
--          has_function_privilege('public',
--            'public.can_create_workspace(uuid)', 'EXECUTE') as public_can_call;
--   -- Expected: auth_can_call = true. anon_can_call = false.
--   -- public_can_call = false. (Note: 'public' here is the special
--   --  pseudo-role, not the schema.)
--
-- (c) Confirm the policy now calls the helper instead of the open
--     auth.uid() IS NOT NULL check.
--
--   select policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and tablename = 'workspaces'
--     and policyname = 'workspaces_insert';
--   -- Expected: 1 row.
--   --   qual = NULL (INSERT policies don't have a USING clause)
--   --   with_check contains 'can_create_workspace' as a substring.
--
-- (d) Helper behavior probe — call directly for the four cases.
--     Each call's actor uuid should be a real user_id from auth.users.
--     If you're not sure who to use, the founder (jordanperez1270@gmail.com)
--     is an agency owner with workspace_memberships — case 3 below.
--
--   -- Case 1: NULL actor (simulated anon)
--   select public.can_create_workspace(null::uuid);
--   -- Expected: false (actor IS NOT NULL check fails)
--
--   -- Case 2: pure client — pick a user_id whose only memberships are
--   --         pipeline_memberships role='client'. Casey
--   --         (jordanperez1270+client@gmail.com) per project handoff fits.
--   select public.can_create_workspace('<casey_user_id>');
--   -- Expected: false (has_client AND NOT has_agency)
--
--   -- Case 3: agency owner — Jordan.
--   select public.can_create_workspace('<jordan_user_id>');
--   -- Expected: true (has_agency via workspace_memberships)
--
--   -- Case 4: simulate brand-new signup by picking any auth.users row
--   --         whose user_id has zero rows in BOTH workspace_memberships
--   --         AND pipeline_memberships. If no such user exists in prod,
--   --         skip — the function's logic for this case is provable from
--   --         the SQL (zero rows in both EXISTS subqueries → has_client
--   --         is false → outer AND short-circuits → result is true).
--   select public.can_create_workspace('<brand_new_user_id>');
--   -- Expected: true
--
-- (e) End-to-end direct-PostgREST exploit probe (the canonical Phase 3
--     proof-of-fix). REQUIRES a pure-client test fixture.
--
--   Pre-migration: as Casey (or any pure client), open DevTools, run
--     await supabase.from('workspaces').insert({ name: 'C1 bypass test' });
--   Expected pre-migration: 201, row inserted (THE EXPLOIT).
--
--   Post-migration: same call.
--   Expected post-migration: 4xx with RLS denial — "new row violates
--   row-level security policy for table workspaces".
--
--   Cleanup: if any C1-bypass-test workspaces exist from earlier
--   sessions, the founder will delete them via service-role after
--   verifying the fix held.
--
-- (f) End-to-end legitimate-onboarding regression probe.
--
--   As Jordan (an agency owner), use the app's normal "Create workspace"
--   path (/onboarding/create-workspace) to create a workspace. Expected:
--   workspace is created successfully — both the RPC's check and the
--   new RLS policy's helper allow it.
--
-- ============================================================================
