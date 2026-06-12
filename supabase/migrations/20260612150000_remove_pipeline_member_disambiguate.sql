-- ============================================================================
-- PI-followup-5: disambiguate remove_pipeline_member DELETE
--
-- Prod verification surfaced a "column reference 'pipeline_id' is
-- ambiguous" runtime error when the Remove button on the Members
-- sub-tab fired. PostgreSQL couldn't resolve `pipeline_id` in the LHS
-- of the DELETE's WHERE clause — it can mean either the function
-- parameter or the column on the target relation.
--
-- The earlier WHERE clauses in the RPC body already disambiguate via
-- `pm.pipeline_id = remove_pipeline_member.pipeline_id` (table alias
-- on the LHS, function-name qualification on the RHS), but the final
-- DELETE referenced the unaliased table — its LHS `pipeline_id` had
-- no qualifier, hence the parser collision.
--
-- Fix: alias the target table in the DELETE so the LHS is unambiguously
-- the column. Body is byte-for-byte unchanged elsewhere. Same signature,
-- same SECURITY DEFINER + search_path. CREATE OR REPLACE preserves
-- grants but we re-affirm GRANT EXECUTE defensively for idempotency.
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

  -- ── DELETE (PI-followup-5: alias target table to disambiguate LHS) ─────
  delete from public.pipeline_memberships pm
  where pm.pipeline_id = remove_pipeline_member.pipeline_id
    and pm.user_id = target_user_id;

  return json_build_object(
    'ok', true,
    'pipeline_id', remove_pipeline_member.pipeline_id,
    'user_id', target_user_id
  );
end;
$$;

-- Defensive re-grant. CREATE OR REPLACE usually preserves grants, but
-- this keeps the apply path identical to a from-scratch deploy.
grant execute on function public.remove_pipeline_member(uuid, uuid) to authenticated;
