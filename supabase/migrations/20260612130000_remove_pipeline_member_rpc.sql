-- ============================================================================
-- PI-followup-3: remove_pipeline_member SECURITY DEFINER RPC
--
-- Mirrors add_pipeline_member (PI-followup-2). Backs POST /api/pipeline-
-- memberships/remove, which is called from the X-affordance on each row
-- in the pipeline Members sub-tab "Current members" list.
--
-- Same RLS-bypass rationale as the add RPC: direct PostgREST DELETE on
-- pipeline_memberships would be subject to RLS evaluation that re-queries
-- pipeline_memberships (via can_edit_pipeline / is_pipeline_agency_member
-- helpers). Routing through a SECURITY DEFINER RPC bypasses RLS on every
-- table the function touches and pre-empts the recursion class.
--
-- Defenses
-- ────────
--   * Auth (actor != null).
--   * Workspace-type floor: personal workspaces have no team-member
--     concept (mirrors add).
--   * Authz: actor must be workspace owner/admin OR pipeline owner/admin
--     for this specific pipeline. Mirrors add — anyone who can add can
--     also remove.
--   * Self-removal block: actor cannot remove themselves. Forces another
--     owner/admin to do it, which keeps an audit trail and prevents a
--     lone admin from accidentally locking themselves out.
--   * Owner-protection: pipeline-owner rows cannot be removed via this
--     affordance. Owners are managed via the workspace seat flow, not
--     ad-hoc pipeline removal.
--   * Existence check: target must currently have a pipeline_memberships
--     row for this pipeline.
--
-- KNOWN GAP (flagged, not fixed in this commit per scope):
-- channel_memberships does NOT cascade-delete when pipeline_memberships
-- rows are removed (there's no FK constraint and no AFTER DELETE trigger).
-- A removed member will lose pipeline-level access (gated through the
-- pipeline_memberships check) but will still hold channel_memberships
-- rows pointing at channels on this pipeline. Whether they can still
-- READ those channels depends on the channel_memberships SELECT policy
-- (currently: `is_channel_member(channel_id)` OR
-- `is_pipeline_agency_member(...)`). The first arm matches if they
-- still hold the channel_memberships row → SELECT succeeds. Resolve in
-- a follow-up by either:
--   (a) adding an AFTER DELETE trigger on pipeline_memberships that
--       deletes corresponding channel_memberships, or
--   (b) tightening the channel_memberships SELECT policy to require a
--       live pipeline_memberships row.
-- ============================================================================

create or replace function public.remove_pipeline_member(
  pipeline_id uuid,
  target_user_id uuid
)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  ws_id uuid;
  ws_type text;
  target_role text;
begin
  -- ── Auth ───────────────────────────────────────────────────────────────
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- ── Resolve parent workspace ───────────────────────────────────────────
  select p.workspace_id, w.type
    into ws_id, ws_type
  from public.pipelines p
  join public.workspaces w on w.id = p.workspace_id
  where p.id = pipeline_id;

  if ws_id is null then
    raise exception 'Pipeline not found' using errcode = '22023';
  end if;

  -- ── Workspace-type floor ───────────────────────────────────────────────
  if ws_type = 'personal' then
    raise exception 'Personal workspaces do not support team members.'
      using errcode = '42501';
  end if;

  -- ── Authz (same gate as add) ───────────────────────────────────────────
  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = ws_id and user_id = actor and role in ('owner', 'admin')
  ) and not exists (
    select 1 from public.pipeline_memberships pm
    where pm.pipeline_id = remove_pipeline_member.pipeline_id
      and pm.user_id = actor
      and pm.role in ('owner', 'admin')
  ) then
    raise exception 'Not authorized to remove members from this pipeline'
      using errcode = '42501';
  end if;

  -- ── Self-removal block ─────────────────────────────────────────────────
  if target_user_id = actor then
    raise exception 'You can''t remove yourself; ask another owner/admin to do it.'
      using errcode = '42501';
  end if;

  -- ── Existence + owner-protection ───────────────────────────────────────
  select pm.role into target_role
  from public.pipeline_memberships pm
  where pm.pipeline_id = remove_pipeline_member.pipeline_id
    and pm.user_id = target_user_id;

  if target_role is null then
    raise exception 'Not a member of this pipeline' using errcode = '22023';
  end if;

  if target_role = 'owner' then
    raise exception 'Pipeline owner cannot be removed via this affordance.'
      using errcode = '42501';
  end if;

  -- ── DELETE ─────────────────────────────────────────────────────────────
  delete from public.pipeline_memberships
  where pipeline_id = remove_pipeline_member.pipeline_id
    and user_id = target_user_id;

  return json_build_object(
    'ok', true,
    'pipeline_id', remove_pipeline_member.pipeline_id,
    'user_id', target_user_id
  );
end;
$$;

grant execute on function public.remove_pipeline_member(uuid, uuid) to authenticated;

comment on function public.remove_pipeline_member(uuid, uuid) is
  'PI-followup-3: SECURITY DEFINER remove-pipeline-member RPC. Backs /api/pipeline-memberships/remove. Mirrors add_pipeline_member structure. Defenses: workspace-type floor, workspace-or-pipeline owner/admin authz, self-removal block, pipeline-owner-protection, existence check. KNOWN GAP: does not cascade-delete channel_memberships.';
