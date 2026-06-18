-- ============================================================================
-- NF-2.6: widen get_channel_mention_audience to match send_channel_message
--
-- NF-2.5 closed the portal-side picker gap by exposing channel_memberships
-- joined with profiles + pipeline_memberships role. That fixed the picker
-- for users who already had a channel_memberships row.
--
-- But cyan rendering on the portal was still broken. The break:
-- seed_channel_memberships_on_pipeline_join (migration 20260525120000)
-- only auto-joins agency-role pipeline members to is_client=false
-- channels and only auto-joins clients to is_client=true channels.
-- Agency teammates have NO channel_memberships row for the client
-- channel — yet NF-1's send_channel_message RPC happily resolves
-- mentions of them, because its audience is wider:
--   workspace_memberships ∪ pipeline_memberships (any role).
-- So mentions[] on a client-channel message can contain user_ids
-- the NF-2.5 RPC's channel_memberships-only query never surfaces.
-- Those user_ids miss the portal-side authorCacheRef → the cache
-- lookup in renderMessageWithMentions fails → plain text instead of
-- a cyan chip.
--
-- FIX: this CREATE OR REPLACE widens the RPC's audience to match
-- send_channel_message exactly. Now any user who COULD be mentioned
-- in the channel surfaces in the RPC's result — whether they have an
-- explicit channel_memberships row, a pipeline_memberships row, or
-- only a workspace_memberships row. Picker filtering on the client
-- side (mentionablePeopleForActiveChannel in ChatBody) narrows back
-- down to the channel's actual presence; the broader RPC result just
-- makes sure the renderer has profiles for every mention[] user_id
-- the message could carry.
--
-- ROLE DERIVATION (new): pipeline_memberships role wins; falls back
-- to workspace_memberships role; defaults to 'member' if neither
-- exists (defensive — shouldn't happen given the audience inclusion
-- rule above). Returning the strongest available role keeps the
-- picker's role badge accurate ("Owner" vs "Client" vs "Member").
--
-- AUTHZ + SIGNATURE: unchanged. Same SECURITY DEFINER, same
-- search_path = '', same (uuid) → json shape, same callers
-- (PortalChatPage). No app-code change required.
--
-- ┌─ DOWN PLAN
-- │
-- │   Revert by reapplying the NF-2.5 definition from
-- │   20260617120000_get_channel_mention_audience_rpc.sql (the
-- │   channel_memberships-only body). Function signature + grants
-- │   unchanged; pure body swap.
-- │
-- └──────────────────────────────────────────────────────────────────────
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
  -- Unchanged from NF-2.5. Three arms (matches channel_messages access):
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
  -- NF-2.6 widening: audience = UNION of
  --   * channel_memberships for this channel
  --   * pipeline_memberships for the parent pipeline (any role)
  --   * workspace_memberships for the parent workspace (any role)
  -- DISTINCT by user_id (the UNION de-dupes naturally). Role comes from
  -- pipeline_memberships when present (the more specific signal), falls
  -- back to workspace_memberships role, else 'member' default.
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
            'role', coalesce(pm.role, wm.role, 'member')
          ) as audience_row,
          coalesce(
            lower(pr.display_name),
            lower(pr.email),
            pr.id::text
          ) as sort_key
        from (
          select cm.user_id
          from public.channel_memberships cm
          where cm.channel_id = p_channel_id
          union
          select pm.user_id
          from public.pipeline_memberships pm
          where pm.pipeline_id = parent_pipeline_id
          union
          select wm.user_id
          from public.workspace_memberships wm
          where wm.workspace_id = parent_workspace_id
        ) audience
        join public.profiles pr on pr.id = audience.user_id
        left join public.pipeline_memberships pm
          on pm.user_id = audience.user_id
         and pm.pipeline_id = parent_pipeline_id
        left join public.workspace_memberships wm
          on wm.user_id = audience.user_id
         and wm.workspace_id = parent_workspace_id
      ) ordered
    ),
    '[]'::json
  );
end;
$$;

-- GRANT EXECUTE re-affirmed defensively. CREATE OR REPLACE preserves
-- existing grants, but a from-scratch deploy needs the explicit grant.
grant execute on function public.get_channel_mention_audience(uuid) to authenticated;

comment on function public.get_channel_mention_audience(uuid) is
  'NF-2.5/NF-2.6: SECURITY DEFINER RPC returning the @mention audience for a channel — UNION of channel_memberships, pipeline_memberships, and workspace_memberships for the parent pipeline/workspace, joined with profiles + role. Wider than channel access on purpose: ensures portal-side authorCacheRef can resolve any user_id that send_channel_message could write into channel_messages.mentions[].';
