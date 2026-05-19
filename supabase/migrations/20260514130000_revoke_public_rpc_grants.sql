-- ============================================================================
-- Phase 3.4 (step 7a polish) — revoke PUBLIC EXECUTE on RPCs
-- ============================================================================
-- PostgreSQL defaults `EXECUTE` to PUBLIC on every function unless you
-- explicitly REVOKE it first. Our five RPCs each added explicit GRANTs to
-- anon / authenticated, but never removed the inherited PUBLIC grant — so
-- every RPC has been callable by everyone (including unauthenticated
-- callers for the ACCEPT functions, which is wider than intended).
--
-- The function bodies all check `auth.uid() is null` before doing anything
-- sensitive, so this hasn't been a live security bug — but it's a hygiene
-- gap (defense-in-depth + smaller attack surface). Surfaced during 7a
-- verification's grants query.
--
-- This migration revokes PUBLIC from the five RPCs we've explicitly
-- granted to. The explicit grants to anon / authenticated survive: those
-- are direct grants, not inherited via PUBLIC.
--
-- NOT touched in this migration:
--   * Helper functions (is_workspace_member, can_edit_pipeline, etc.) —
--     they're invoked by RLS policies, which run in the authenticated
--     caller's role context. Revoking PUBLIC without re-granting to
--     authenticated would break RLS. Helper-level hygiene stays in the
--     wider PHASE_3_4_PLAN.md item #4 pass for a deliberate audit later.
--   * Trigger functions (handle_new_user, etc.) — invoked by trigger
--     machinery, not user RPC calls. PUBLIC grant is moot.
--
-- ┌─ DOWN PLAN
-- │
-- │   grant execute on function public.create_workspace_with_owner(text)   to public;
-- │   grant execute on function public.get_workspace_invite_preview(uuid)  to public;
-- │   grant execute on function public.accept_workspace_invite(uuid)       to public;
-- │   grant execute on function public.get_client_invite_preview(uuid)     to public;
-- │   grant execute on function public.accept_client_invite(uuid)          to public;
-- │
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================

revoke execute on function public.create_workspace_with_owner(text)   from public;
revoke execute on function public.get_workspace_invite_preview(uuid)  from public;
revoke execute on function public.accept_workspace_invite(uuid)       from public;
revoke execute on function public.get_client_invite_preview(uuid)     from public;
revoke execute on function public.accept_client_invite(uuid)          from public;


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- Confirm PUBLIC is no longer in the grants list, but anon / authenticated
-- explicit grants remain:
--
--   select grantee, routine_name, privilege_type
--   from information_schema.role_routine_grants
--   where routine_schema = 'public'
--     and routine_name in (
--       'create_workspace_with_owner',
--       'get_workspace_invite_preview',
--       'accept_workspace_invite',
--       'get_client_invite_preview',
--       'accept_client_invite'
--     )
--   order by routine_name, grantee;
--
-- Expected: no rows with grantee = 'PUBLIC' for the five functions.
--   create_workspace_with_owner   → authenticated only
--   get_workspace_invite_preview  → anon, authenticated
--   accept_workspace_invite       → authenticated only
--   get_client_invite_preview     → anon, authenticated
--   accept_client_invite          → authenticated only
-- ============================================================================
