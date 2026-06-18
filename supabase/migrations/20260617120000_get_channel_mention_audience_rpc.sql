-- ============================================================================
-- NF-2.5: get_channel_mention_audience SECURITY DEFINER RPC
--
-- Closes a portal-side gap discovered during NF-2.5 verification: clients
-- in /portal/[pipeline-id]/chat couldn't see the @mention picker, and
-- @mentions in their messages didn't render with cyan styling.
--
-- ROOT CAUSE
-- ──────────
-- The picker + cyan-render path both source from the `members:
-- ChromeMember[]` array passed into ChatBody. That array comes from
-- fetchCanvasChromeData → pipeline_memberships, filtered by the
-- pipeline_memberships_select RLS policy:
--   is_pipeline_agency_member(pipeline_id) OR user_id = auth.uid()
-- A client is not an agency member of the pipeline, so the only row
-- they can read is their own. Net: `members` = [self] for a client;
-- the picker filter drops self, leaving zero candidates and no popover.
-- Cyan rendering misses any mentioned agency user who hasn't already
-- posted in the channel (the cache's only other seed path).
--
-- Other layers already work for clients:
--   * channel_memberships_select lets them see fellow rows of their
--     own channel — so channel_memberships ID lookup is fine.
--   * profiles_select was widened in migration 20260527120000_portal-
--     _visibility_rls.sql so clients can read agency members' profiles
--     on the same pipeline.
-- The remaining gap is the role lookup (pipeline_memberships) + the
-- composition of those rows into a single audience list.
--
-- FIX
-- ───
-- A SECURITY DEFINER RPC that, given a channel_id, returns every user
-- with a channel_memberships row for that channel together with their
-- profile (display_name, avatar_url, email) AND their pipeline-level
-- role (joined from pipeline_memberships by user_id + parent pipeline_id).
-- Bypasses pipeline_memberships_select so clients get role info their
-- direct read can't surface; profiles + channel_memberships data is
-- equivalent to what they could already read via RLS, but we centralize
-- here so the caller side stays simple.
--
-- AUTHZ
-- ─────
-- The actor must have access to the channel:
--   (a) explicit channel_memberships row for the channel, OR
--   (b) workspace owner/admin of the parent pipeline's workspace, OR
--   (c) pipeline owner/admin/member of the parent pipeline
-- Mirrors the channel_messages_select gate posture (channel-member arm
-- + agency-of-parent-pipeline arm). Returns 42501 if denied.
--
-- IDEMPOTENT — pure read RPC; safe to call any number of times.
-- Returns json (array of {user_id, display_name, avatar_url, email,
-- role}) sorted by display_name then email for stable picker ordering.
-- Empty channel → empty array (NOT null), so callers can iterate without
-- a defensive null check.
-- ============================================================================

create or replace function public.get_channel_mention_audience(p_channel_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  actor uuid := (select auth.uid());
  parent_pipeline_id uuid;
  parent_workspace_id uuid;
begin
  -- ── Auth ───────────────────────────────────────────────────────────────
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- ── Resolve parent pipeline + workspace ────────────────────────────────
  select c.pipeline_id, p.workspace_id
    into parent_pipeline_id, parent_workspace_id
  from public.channels c
  join public.pipelines p on p.id = c.pipeline_id
  where c.id = p_channel_id;

  if parent_pipeline_id is null then
    raise exception 'Channel not found' using errcode = '22023';
  end if;

  -- ── Authz: caller must have access to this channel ─────────────────────
  -- Three arms (matches channel_messages access posture):
  --   1. explicit channel_memberships row for this channel
  --   2. workspace owner/admin of the parent workspace
  --   3. pipeline owner/admin/member of the parent pipeline
  if not exists (
    select 1 from public.channel_memberships
    where channel_id = p_channel_id and user_id = actor
  ) and not exists (
    select 1 from public.workspace_memberships
    where workspace_id = parent_workspace_id
      and user_id = actor
      and role in ('owner', 'admin')
  ) and not exists (
    select 1 from public.pipeline_memberships
    where pipeline_id = parent_pipeline_id
      and user_id = actor
      and role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Not authorized to view channel members'
      using errcode = '42501';
  end if;

  -- ── Return the channel's mention audience ──────────────────────────────
  -- LEFT JOIN pipeline_memberships so users in channel_memberships but
  -- (defensively) not in pipeline_memberships still surface — `role`
  -- defaults to 'member' in that case. Real-world this shouldn't happen
  -- (channel_memberships is always seeded after a pipeline_memberships
  -- row exists, per the seed-channels triggers), but we don't drop rows.
  return coalesce(
    (
      select json_agg(audience_row order by sort_key)
      from (
        select
          json_build_object(
            'user_id', pr.id,
            'display_name', pr.display_name,
            'avatar_url', pr.avatar_url,
            'email', pr.email,
            'role', coalesce(pm.role, 'member')
          ) as audience_row,
          coalesce(
            lower(pr.display_name),
            lower(pr.email),
            pr.id::text
          ) as sort_key
        from public.channel_memberships cm
        join public.profiles pr on pr.id = cm.user_id
        left join public.pipeline_memberships pm
          on pm.user_id = cm.user_id
         and pm.pipeline_id = parent_pipeline_id
        where cm.channel_id = p_channel_id
      ) ordered
    ),
    '[]'::json
  );
end;
$$;

grant execute on function public.get_channel_mention_audience(uuid) to authenticated;

comment on function public.get_channel_mention_audience(uuid) is
  'NF-2.5: SECURITY DEFINER RPC returning the @mention audience for a channel (channel_memberships ∪ profiles + role). Bypasses pipeline_memberships_select so portal clients can populate the picker + cyan-mention cache for agency members in their channel. Authz mirrors channel access (channel member OR agency of parent pipeline).';
