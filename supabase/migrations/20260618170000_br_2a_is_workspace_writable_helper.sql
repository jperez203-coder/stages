-- ============================================================================
-- BR-2a: is_workspace_writable helper function
-- ============================================================================
-- Adds a SECURITY DEFINER, STABLE SQL helper that mirrors the 5-gate
-- evaluation in src/lib/billing-guard.ts:159-261. The helper is shipped
-- ALONE this slice — no RPC or RLS body changes yet. BR-2b applies it
-- to the 9 user-callable write RPCs; BR-3 applies it to write-path RLS
-- policies on directly-mutated tables.
--
-- WHY HOIST THE GATE LOGIC TO SQL?
-- ─────────────────────────────────
-- billing-guard.ts runs in Next.js server context — API routes, server
-- actions, server components. It does NOT run for direct PostgREST
-- writes from client components OR for SECURITY DEFINER RPCs invoked
-- via supabase.rpc(). The trial-end audit (BR-0 report) confirmed:
-- 9 write RPCs + 18 direct PostgREST sites with zero billing check.
-- Putting the same predicate in SQL lets RPCs + RLS share the rule.
--
-- The TypeScript implementation stays — both layers consume the same
-- predicate definition; BR-4 will refactor the TS helper to RPC into
-- this function so there's one source of truth.
--
-- PREDICATE — return TRUE if any of these hold; otherwise FALSE:
--   Gate 1: subscription_status = 'active'
--   Gate 2: 'trialing' AND stripe_subscription_id IS NOT NULL
--           (Stripe-managed trial — webhook flips on deadline)
--   Gate 3: 'trialing' AND sub_id IS NULL AND trial_ends_at > now()
--           (manual trial pre-deadline — Track B 14-day, Track A 30-day)
--   Gate 4: 'trialing' AND sub_id IS NULL AND trial_ends_at <= now()
--           AND any owner profiles.is_founding_member = true
--           (eternal founding policy — no hard cliff for founders)
--   Else:   FALSE (fail-closed posture)
--
-- EDGE CASES → all return FALSE
-- ──────────────────────────────
--   * workspace_id doesn't exist                → no workspace_billing
--     row → inner SELECT returns 0 rows → outer COALESCE(NULL, false)
--   * Personal workspace (WT-4 init trigger     → same as above; no
--     skips workspace_billing creation)            billing row to read
--   * subscription_status IS NULL               → all 4 gates yield
--                                                 NULL via SQL three-
--                                                 valued logic; outer
--                                                 COALESCE → false
--   * No owner with is_founding_member=true on  → gate 4 EXISTS clause
--     a workspace in gate 4 conditions             returns false → fall
--                                                 through to overall
--                                                 FALSE
--
-- OWNER LOOKUP for gate 4: ANY owner row with is_founding_member=true.
-- A workspace with multiple owners passes gate 4 if any single owner
-- is a founder. Matches the eternal-founding policy intent: founders
-- get the soft trial for every workspace they have ownership in.
--
-- SECURITY DEFINER + search_path = '' — required so the helper can read
-- workspace_billing, workspace_memberships, and profiles regardless of
-- the caller's RLS context (e.g. when invoked from BR-3 policy bodies,
-- the caller may not normally have direct read access to these tables).
-- All table references inside the function body are fully-qualified
-- with public. — search-path injection defense.
--
-- STABLE — within a single statement, same workspace_id yields the
-- same result. Lets PG cache the result during multi-row RLS policy
-- evaluation (BR-3): a bulk task UPDATE on N rows under the same
-- workspace evaluates the helper ONCE, not N times.
--
-- VOLATILITY NOTE
-- ───────────────
-- now() is itself STABLE (returns the start-of-transaction timestamp,
-- same value across the whole statement). So our use of now() inside a
-- STABLE function is sound — the function's STABLE contract holds
-- because now() doesn't change mid-statement.
--
-- DEFAULT GRANT
-- ─────────────
-- GRANT EXECUTE to authenticated. anon does not get EXECUTE — no
-- public surface should be calling this; only authenticated callers
-- (RPCs, RLS, server code) need it.
--
-- ┌─ DOWN PLAN
-- │
-- │   drop function if exists public.is_workspace_writable(uuid);
-- │
-- │   Safe to drop ONLY when BR-2b's RPC body updates AND BR-3's RLS
-- │   policy updates have been reverted — otherwise dependent RPCs/
-- │   policies will fail with "function does not exist."
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================

create or replace function public.is_workspace_writable(p_workspace_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  -- COALESCE wraps the entire SELECT result so that:
  --   * No workspace_billing row → inner SELECT returns 0 rows →
  --     overall NULL → COALESCE → false.
  --   * Inner SELECT yields NULL via three-valued logic (subscription_-
  --     status NULL etc.) → COALESCE → false.
  -- Fail-closed posture matches billing-guard.ts gate 5.
  select coalesce((
    select
      -- Gate 1: paid active sub.
      wb.subscription_status = 'active'
      -- Gate 2: Stripe-managed trial. Stripe owns the deadline; webhook
      -- flips status when trial ends or payment fails.
      or (
        wb.subscription_status = 'trialing'
        and wb.stripe_subscription_id is not null
      )
      -- Gate 3: manual trial, pre-deadline. Covers BOTH Track A founder
      -- 30-day trial AND Track B 14-day trial seeded by the
      -- init_workspace_billing trigger.
      or (
        wb.subscription_status = 'trialing'
        and wb.stripe_subscription_id is null
        and wb.trial_ends_at > now()
      )
      -- Gate 4: manual trial, post-deadline + founder exemption.
      -- Eternal founding policy — no hard cliff. Any owner with
      -- is_founding_member=true qualifies the workspace.
      or (
        wb.subscription_status = 'trialing'
        and wb.stripe_subscription_id is null
        and wb.trial_ends_at <= now()
        and exists (
          select 1
          from public.workspace_memberships wm
          join public.profiles pr on pr.id = wm.user_id
          where wm.workspace_id = p_workspace_id
            and wm.role = 'owner'
            and pr.is_founding_member = true
        )
      )
    from public.workspace_billing wb
    where wb.workspace_id = p_workspace_id
  ), false);
$$;

grant execute on function public.is_workspace_writable(uuid) to authenticated;

comment on function public.is_workspace_writable(uuid) is
  'BR-2a: returns true when the workspace''s billing state permits write operations, mirroring the 5-gate evaluation in src/lib/billing-guard.ts. Fail-closed on missing rows / null status / unrecognized state. Used by BR-2b write RPCs and BR-3 write-path RLS policies as the single source of truth for "is this workspace currently writable?"';


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) Function exists, is SECURITY DEFINER + STABLE + search_path set.
--   select proname, prosecdef, provolatile, proconfig
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'is_workspace_writable';
--   -- Expected: prosecdef=true, provolatile='s' (stable), proconfig
--   -- contains 'search_path='.
--
-- (b) Helper returns expected values against Jordan's three known
--     workspaces. Substitute slugs if any name has changed.
--   select
--     w.slug,
--     w.type,
--     wb.subscription_status,
--     wb.stripe_subscription_id is not null as has_stripe_sub,
--     wb.trial_ends_at,
--     public.is_workspace_writable(w.id) as is_writable
--   from public.workspaces w
--   left join public.workspace_billing wb on wb.workspace_id = w.id
--   where w.slug in ('salesedge', 'test-workspace-4b', 'testing-again')
--   order by w.slug;
--   -- Expected:
--   --   salesedge         agency   active   …                   TRUE
--   --   test-workspace-4b agency   active   …                   TRUE
--   --   testing-again     personal (null — no billing row)      FALSE
--
-- (c) Sanity: gate-by-gate hand-validation. Each subquery exercises
--     one specific gate so we can confirm the helper agrees with the
--     hand-computation. Substitute workspace_ids if needed.
--   with target as (
--     select id from public.workspaces where slug = 'salesedge'
--   )
--   select
--     'salesedge' as workspace,
--     -- Hand-computed gate-1:
--     (
--       select wb.subscription_status = 'active'
--       from public.workspace_billing wb, target
--       where wb.workspace_id = target.id
--     ) as gate1_handcomputed,
--     -- Helper result:
--     (select public.is_workspace_writable(id) from target) as helper_result;
--   -- Expected: gate1_handcomputed = true, helper_result = true.
--
-- (d) Negative test: temporarily flip test-workspace-4b to 'past_due'
--     and confirm helper returns FALSE. (DON'T forget to flip back.)
--     This is the regression check that the helper actually responds
--     to status changes.
--   begin;
--   update public.workspace_billing
--   set subscription_status = 'past_due'
--   where workspace_id = '3163972f-0453-40ca-b4b8-c35caf2294fa';
--   select public.is_workspace_writable(
--     '3163972f-0453-40ca-b4b8-c35caf2294fa'::uuid
--   ) as is_writable;
--   -- Expected: false
--   rollback;  -- restores active state automatically
-- ============================================================================
