-- ============================================================================
-- 4b-1 follow-up #2: profiles_select branch 6 — security-definer fix
-- ============================================================================
-- BUG: branch 6 added in 20260528120000 is logically correct but
-- OPERATIONALLY UNEVALUABLE for client callers because its inline
-- EXISTS subquery reads `public.workspace_memberships`, which has its
-- own RLS policy gated on `is_workspace_member`. Client callers have
-- no workspace_memberships row → `is_workspace_member` returns false
-- → workspace_memberships_select denies every row to them → the
-- EXISTS subquery joins to zero rows → the predicate is false even
-- when the underlying data fully matches.
--
-- Concrete symptom: Casey (pure pipeline_client, no workspace_memberships)
-- opens the portal chat. Messages authored by Jordan (workspace_owner,
-- no pipeline_memberships row on this pipeline — accesses via workspace
-- ownership only) render as "Deleted user" because chat-data's server
-- profile fetch can't read Jordan's profile row. branch 6 was
-- supposed to cover this, but the inner workspace_memberships read is
-- RLS-blocked for Casey.
--
-- Direct-bool tests of branch 6 returned TRUE in the Supabase SQL
-- editor — but the editor runs as service_role by default, which
-- bypasses RLS entirely. That confirmed the LOGIC of branch 6 but not
-- its evaluability under a real client's auth context.
--
-- FIX: convert branch 6 from an inline EXISTS to a security-definer
-- helper call (same pattern that branch 5 uses via
-- `users_share_pipeline`). The helper bypasses the inner RLS on
-- workspace_memberships during evaluation, so the predicate becomes
-- evaluable for clients without widening their actual SELECT access
-- to workspace_memberships rows.
--
-- ─── FOREVER RULE (read this before adding new profiles_select branches)
--
--   Any branch whose inner EXISTS reads a table the caller can't see
--   under that table's own SELECT RLS MUST use a security-definer
--   helper. Otherwise the predicate is unevaluable for callers who
--   lack visibility into the inner table — even when the underlying
--   data fully matches.
--
--   Quick test for whether a branch needs the helper treatment:
--     1. Identify the caller archetype the branch is meant to serve
--        (client, agency member, workspace owner, etc.).
--     2. For each table the inner EXISTS reads, check that table's
--        SELECT policy and ask "would this caller be allowed to see
--        the specific rows the join needs?"
--     3. If the answer is NO for ANY table, wrap the branch in a
--        security-definer helper that bypasses internal RLS for those
--        reads. Otherwise the branch will silently fail for that
--        caller archetype.
--
--   Existing branches and their evaluability:
--     1 (self):                 trivial — always evaluable
--     2 (shared workspace_membership): both callers are workspace_members,
--        both can read each other's workspace_memberships rows ✓
--     3 (shared pipeline_membership, RLS-filtered): client callers
--        cannot read other users' pipeline_memberships, so this branch
--        only fires for agency-to-agency pairs. Kept for back-compat;
--        functionally superseded by branch 5 (helper-based) for
--        client→agency direction.
--     4 (workspace owner/admin → pipeline_member):
--        callers here are workspace owners/admins, who CAN read
--        workspace_memberships (their own) and pipelines + pipeline_
--        memberships (via is_workspace_member / is_pipeline_agency_member).
--        Evaluable ✓ — no helper needed.
--     5 (users_share_pipeline helper):
--        helper bypasses pipeline_memberships RLS for the inner read,
--        which is why it works for client→agency direction.
--     6 (NEW: pipeline_member → workspace owner, via helper):
--        caller may be a client (no workspace_memberships row), so the
--        inner workspace_memberships read MUST be bypassed → helper. ✓
--
-- ┌─ DOWN PLAN
-- │
-- │   -- Revert to the 6-branch policy from 20260528120000 where
-- │   -- branch 6 was an inline EXISTS. (NOTE: this revert reintroduces
-- │   -- the unevaluable-for-clients bug — only run if you also have a
-- │   -- replacement plan for the workspace-owner-visible-to-client
-- │   -- relationship.)
-- │   drop policy if exists profiles_select on public.profiles;
-- │   create policy profiles_select on public.profiles
-- │   for select using (
-- │     id = (select auth.uid())
-- │     or exists ( ... branch 2 ... )
-- │     or exists ( ... branch 3 ... )
-- │     or exists ( ... branch 4 ... )
-- │     or public.users_share_pipeline(...)
-- │     or exists ( ... branch 6 inline EXISTS ... )
-- │   );
-- │
-- │   drop function if exists
-- │     public.caller_pipeline_in_workspace_owned_by(uuid, uuid);
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Helper: caller_pipeline_in_workspace_owned_by ──────────────────────
-- Returns true if `caller_user` has a pipeline_memberships row on any
-- pipeline that belongs to a workspace where `owner_user` is a workspace
-- owner. Used by profiles_select branch 6 to evaluate the "pipeline_member
-- can see workspace owner" relationship without requiring the caller
-- to have direct workspace_memberships SELECT access.
--
-- security definer + stable + search_path locked — same hygiene pattern
-- as users_share_pipeline (20260527120000) and the other RLS helpers
-- (is_pipeline_agency_member, can_edit_pipeline, etc.).

create or replace function public.caller_pipeline_in_workspace_owned_by(
  caller_user uuid,
  owner_user uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.pipeline_memberships pm
    join public.pipelines p on p.id = pm.pipeline_id
    join public.workspace_memberships wm on wm.workspace_id = p.workspace_id
    where pm.user_id = caller_user
      and wm.user_id = owner_user
      and wm.role = 'owner'
  );
$$;


-- ─── 2. profiles_select — replace with 6-branch version (branch 6 helper-ized)
-- Branches 1-5 are byte-identical to the 20260528120000 / 20260527120000
-- versions. Only branch 6 changes: from an inline EXISTS to the new
-- security-definer helper. See the FOREVER RULE comment above for why.

drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
for select using (
  -- 1. self
  id = (select auth.uid())

  -- 2. shared workspace_memberships
  or exists (
    select 1
    from public.workspace_memberships my
    join public.workspace_memberships theirs
      on theirs.workspace_id = my.workspace_id
    where my.user_id = (select auth.uid())
      and theirs.user_id = public.profiles.id
  )

  -- 3. shared pipeline_memberships (visible-via-RLS variant — only
  --    evaluable agency-to-agency; client→agency goes through branch 5)
  or exists (
    select 1
    from public.pipeline_memberships my
    join public.pipeline_memberships theirs
      on theirs.pipeline_id = my.pipeline_id
    where my.user_id = (select auth.uid())
      and theirs.user_id = public.profiles.id
  )

  -- 4. workspace owner/admin → any pipeline_member in their workspace.
  --    Caller is always agency-side here (workspace owner/admin), so
  --    workspace_memberships + pipelines + pipeline_memberships are
  --    all readable to them under their own RLS. No helper needed.
  or exists (
    select 1
    from public.workspace_memberships my
    join public.pipelines p on p.workspace_id = my.workspace_id
    join public.pipeline_memberships pm on pm.pipeline_id = p.id
    where my.user_id = (select auth.uid())
      and my.role in ('owner', 'admin')
      and pm.user_id = public.profiles.id
  )

  -- 5. users_share_pipeline (security-definer helper from 20260527120000).
  --    Bypasses internal pipeline_memberships RLS so client→agency
  --    direction works for shared-pipeline pairs.
  or public.users_share_pipeline(
    (select auth.uid()),
    public.profiles.id
  )

  -- 6. NEW shape: pipeline_member → workspace OWNER of their workspace,
  --    via security-definer helper. Branch 6 was added in 20260528120000
  --    as an inline EXISTS, but the inner workspace_memberships read
  --    was RLS-blocked for client callers (who can't see any
  --    workspace_memberships row), making the predicate unevaluable
  --    for them. This helper bypasses that inner RLS — same pattern
  --    as branch 5's users_share_pipeline.
  --
  --    Scoped strictly to role='owner' inside the helper. Admins reach
  --    pipelines via explicit pipeline_memberships rows → covered by
  --    branches 3 and 5; not added here.
  or public.caller_pipeline_in_workspace_owned_by(
    (select auth.uid()),
    public.profiles.id
  )
);


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Helper exists with the right security context:
--   select proname, prosecdef, provolatile,
--          pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'caller_pipeline_in_workspace_owned_by';
--   Expected: 1 row, prosecdef=true, provolatile='s',
--   args='caller_user uuid, owner_user uuid'.
--
-- 2. profiles_select now references the new helper (look for
--    'caller_pipeline_in_workspace_owned_by' AND
--    'users_share_pipeline' in polqual — both helpers should appear):
--   select polqual::text
--   from pg_policy
--   where polrelid = 'public.profiles'::regclass
--     and polname = 'profiles_select';
--
-- 3. Functional — under Casey's auth context (impersonated), reading
--    Jordan's profile now succeeds where 20260528120000's branch 6
--    silently failed:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims to
--     '{"sub":"<casey-uuid>","role":"authenticated"}';
--
--   select id, display_name, email
--   from public.profiles
--   where id = '<jordan-uuid>';
--   -- Post-this-migration: 1 row with Jordan's display_name + email.
--   -- Post-20260528120000 (without this migration): 0 rows (the bug).
--
--   rollback;
--
-- 4. Direct helper call sanity-check (run as anyone with execute grant):
--   select public.caller_pipeline_in_workspace_owned_by(
--     '<casey-uuid>'::uuid,
--     '<jordan-uuid>'::uuid
--   );
--   -- Expected: true.
--
--   select public.caller_pipeline_in_workspace_owned_by(
--     '<casey-uuid>'::uuid,
--     '<some-unrelated-user-uuid>'::uuid
--   );
--   -- Expected: false.
--
-- 5. Negative — cross-workspace isolation still holds. Casey looking up
--    a workspace_owner of a DIFFERENT workspace (where Casey has no
--    pipeline_memberships) → 0 rows.
--
-- 6. End-to-end UI: reload /portal/<7a-id>/chat as Casey. Jordan's
--    messages now render with his real display_name + avatar (or
--    email-prefix fallback if display_name is null), not "Deleted user".
-- ============================================================================
