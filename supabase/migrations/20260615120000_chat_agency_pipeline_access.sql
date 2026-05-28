-- ============================================================================
-- Chat: allow agency pipeline members to read + post without an explicit
-- channel_memberships row
-- ============================================================================
--
-- BUG BEING FIXED
--   channel_messages SELECT and INSERT both gated solely on
--   is_channel_member(channel_id) — a literal channel_memberships row
--   existence check. But create_pipeline_with_channels seeds
--   channel_memberships ONLY for the pipeline CREATOR. There is no flow
--   anywhere that adds other agency users to channels. So ANY non-creator
--   agency user (a workspace admin with blanket access, a workspace member
--   added to a pipeline, a second owner) could neither READ nor POST chat
--   messages — is_channel_member returned false for them.
--
--   This was pre-existing (chat only ever worked for the creator); the
--   2026-06-14 admin-access migration just made it reachable, since admins
--   can now open pipelines they didn't create.
--
-- THE FIX
--   Widen BOTH policies' channel-member gate from:
--       is_channel_member(channel_id)
--   to:
--       is_channel_member(channel_id)
--       OR is_pipeline_agency_member(<channel's pipeline_id>)
--
--   Clients keep working via the is_channel_member path (they're added to
--   the client channel + are NOT agency members). Agency users now get in
--   via is_pipeline_agency_member, which already grants any
--   workspace-owner/admin OR pipeline owner/admin/member access to the
--   pipeline (see 20260614120000).
--
-- WHAT IS DELIBERATELY UNCHANGED (verbatim from the originals at
-- 20260509120000_rls_policies.sql:953-976):
--   * The is_internal sub-clause — internal messages stay visible only to
--     agency members of the parent pipeline. Clients still never see
--     is_internal=true rows (they fail is_pipeline_agency_member). This is
--     Layer 1 of the 3-layer internal-message privacy defense (CLAUDE.md);
--     it is preserved exactly.
--   * INSERT's `author_id = auth.uid()` impersonation guard.
--   * is_channel_member's own definition — untouched.
--   * channel_memberships, channels policies, create_pipeline_with_channels
--     — all untouched.
--   * channel_messages UPDATE/DELETE — none exist (messages immutable);
--     not added here.
--
-- SECURITY REVIEW
--   This widens agency-side access only. The new OR-branch is
--   is_pipeline_agency_member, which is itself scoped to the channel's own
--   pipeline (workspace isolation + cross-agency isolation unaffected — a
--   user with no standing on the pipeline still matches neither branch).
--   Client privacy is unchanged: clients route through is_channel_member,
--   and the is_internal clause still gates internal messages to agency
--   members. Net effect: any agency member of a pipeline can now read/post
--   in that pipeline's channels — which matches the product intent (chat is
--   the team's shared surface; there is no agency-subset private-channel
--   feature today).
--
-- DOWN PLAN
--   Re-run the original bodies from 20260509120000_rls_policies.sql:953-976
--   (drop + recreate with the is_channel_member-only gate).
--
-- APPLY VIA: Supabase Dashboard SQL editor (do NOT db push). Run the
-- verification block at the bottom afterward.
-- ============================================================================

-- ── SELECT ──────────────────────────────────────────────────────────────
drop policy if exists channel_messages_select on public.channel_messages;
create policy channel_messages_select on public.channel_messages
for select using (
  (
    public.is_channel_member(channel_id)
    or public.is_pipeline_agency_member(
      (select c.pipeline_id from public.channels c where c.id = channel_id)
    )
  )
  and (
    is_internal = false
    or public.is_pipeline_agency_member(
      (select c.pipeline_id from public.channels c where c.id = channel_id)
    )
  )
);

-- ── INSERT ──────────────────────────────────────────────────────────────
drop policy if exists channel_messages_insert on public.channel_messages;
create policy channel_messages_insert on public.channel_messages
for insert with check (
  (
    public.is_channel_member(channel_id)
    or public.is_pipeline_agency_member(
      (select c.pipeline_id from public.channels c where c.id = channel_id)
    )
  )
  and author_id = (select auth.uid())
  and (
    is_internal = false
    or public.is_pipeline_agency_member(
      (select c.pipeline_id from public.channels c where c.id = channel_id)
    )
  )
);

-- ============================================================================
-- VERIFY (run after applying):
-- select polname,
--        pg_get_expr(polqual, polrelid)      as using_clause,
--        pg_get_expr(polwithcheck, polrelid) as with_check_clause
-- from pg_policy
-- where polrelid = 'public.channel_messages'::regclass
--   and polname in ('channel_messages_select', 'channel_messages_insert');
--
-- Each clause should now show the
--   (is_channel_member(...) OR is_pipeline_agency_member(...))
-- channel-member gate, with the is_internal sub-clause unchanged and (for
-- insert) the author_id = auth.uid() guard intact.
-- ============================================================================
