-- ============================================================================
-- PI-followup-2: add_pipeline_member SECURITY DEFINER RPC
--
-- Closes a postgres "infinite recursion detected in policy for relation
-- 'pipeline_memberships'" crash that surfaced when the /api/pipeline-
-- memberships/add endpoint (introduced in PI-followup-1) ran a direct
-- INSERT into pipeline_memberships via PostgREST.
--
-- ROOT CAUSE
-- ──────────
-- The pipeline_memberships INSERT triggers two nested RLS evaluations
-- that ultimately re-query pipeline_memberships mid-INSERT:
--   1. The AFTER INSERT trigger `pipeline_memberships_seed_channels`
--      (20260525120000) inserts into channel_memberships, whose INSERT
--      policy is `can_edit_pipeline(...)` — which selects from
--      pipeline_memberships.
--   2. PostgREST's `.insert(...).select(...).single()` chain runs a
--      RETURNING SELECT, which evaluates pipeline_memberships_select →
--      is_pipeline_agency_member → another pipeline_memberships query.
--
-- Although those helpers are SECURITY DEFINER, postgres still detects
-- the policy-on-pipeline_memberships → table-pipeline_memberships
-- recursion path under certain plans (especially with the seed-channels
-- trigger participating) and raises 42P17.
--
-- FIX
-- ───
-- Same shape as create_workspace_with_owner and accept_client_invite:
-- a SECURITY DEFINER RPC that resolves the pipeline, runs all authz
-- checks inline (no helpers that query pipeline_memberships), does the
-- INSERT, and returns the payload. SECURITY DEFINER bypasses every RLS
-- policy on every table the function touches — including the cascading
-- channel_memberships INSERT inside the seed-channels trigger.
--
-- The route still pre-validates for clean error messages, but the RPC
-- is the only path that performs the actual write.
-- ============================================================================

create or replace function public.add_pipeline_member(
  pipeline_id uuid,
  target_user_id uuid,
  target_role text default 'member'
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
begin
  -- ── Auth ───────────────────────────────────────────────────────────────
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- ── Validate target_role ───────────────────────────────────────────────
  -- Mirrors the route-layer enum. 'owner' is intentionally excluded —
  -- only workspace owners may exist at the pipeline-owner role and they
  -- get it implicitly via workspace_memberships, not via this RPC.
  if target_role not in ('member', 'admin') then
    raise exception 'Invalid role for direct add: % (must be member or admin)', target_role
      using errcode = '22023';
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

  -- ── Workspace-type floor (WT-4) ────────────────────────────────────────
  if ws_type = 'personal' then
    raise exception 'Personal workspaces do not support team members.'
      using errcode = '42501';
  end if;

  -- ── Authz: same gate as can_edit_pipeline, inlined ─────────────────────
  -- Workspace owner/admin OR pipeline owner/admin of this pipeline.
  -- Inlined (not via helper) so the SECURITY DEFINER bypass is preserved
  -- through the entire stack — no helper that re-enters RLS.
  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = ws_id and user_id = actor and role in ('owner', 'admin')
  ) and not exists (
    select 1 from public.pipeline_memberships pm
    where pm.pipeline_id = add_pipeline_member.pipeline_id
      and pm.user_id = actor
      and pm.role in ('owner', 'admin')
  ) then
    raise exception 'Not authorized to add members to this pipeline'
      using errcode = '42501';
  end if;

  -- ── Billing-exploit defense: target MUST be a workspace seat ───────────
  -- pipeline_memberships is a NARROWING layer over the billable seat
  -- (workspace_memberships). Without this check, an agency owner could
  -- direct-add pipeline members without ever writing the row the
  -- seat-sync cron counts.
  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = ws_id and user_id = target_user_id
  ) then
    raise exception 'Target user is not a workspace member; add them as a workspace seat first.'
      using errcode = '42501';
  end if;

  -- ── Already a pipeline member? ─────────────────────────────────────────
  if exists (
    select 1 from public.pipeline_memberships pm
    where pm.pipeline_id = add_pipeline_member.pipeline_id
      and pm.user_id = target_user_id
  ) then
    raise exception 'User is already a member of this pipeline'
      using errcode = '23505';
  end if;

  -- ── INSERT (SECURITY DEFINER bypasses RLS + trigger-side RLS) ──────────
  insert into public.pipeline_memberships (pipeline_id, user_id, role)
  values (add_pipeline_member.pipeline_id, target_user_id, target_role);

  return json_build_object(
    'ok', true,
    'pipeline_id', add_pipeline_member.pipeline_id,
    'user_id', target_user_id,
    'role', target_role
  );
end;
$$;

grant execute on function public.add_pipeline_member(uuid, uuid, text) to authenticated;

comment on function public.add_pipeline_member(uuid, uuid, text) is
  'PI-followup-2: SECURITY DEFINER add-pipeline-member RPC. Backs /api/pipeline-memberships/add. Sidesteps a pipeline_memberships RLS recursion that surfaced via the seed-channel-memberships trigger and PostgREST RETURNING SELECT. Enforces target-must-be-workspace-seat to preserve Team-plan billing integrity.';
