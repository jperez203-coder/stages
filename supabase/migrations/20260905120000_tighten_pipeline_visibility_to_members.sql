-- ============================================================================
-- Tighten pipelines_select: plain workspace members only see projects
-- they're explicitly added to. Owners/admins keep full visibility.
-- ============================================================================
-- Today, pipelines_select grants visibility via is_workspace_member(workspace_id)
-- ALONE — meaning any workspace member, including a plain 'member' role with
-- zero pipeline_memberships rows, can see every pipeline card in the sidebar
-- and dashboard, regardless of whether they were ever added to it.
--
-- This is already inconsistent with how the pipeline's actual CONTENT works:
-- stages_select and tasks_select (20260509120000_rls_policies.sql) gate on
-- is_pipeline_agency_member(pipeline_id) alone — no blanket workspace-member
-- clause. So today, an unassigned member already sees a pipeline card with
-- no readable stages or tasks inside it once they click in — a "ghost card."
-- This migration just brings pipelines_select in line with the standard its
-- own content already follows, rather than introducing a new pattern.
--
-- is_pipeline_agency_member(id) already covers exactly the intended rule
-- (20260614120000_admin_pipeline_access_and_create_perms.sql):
--   * workspace role IN ('owner', 'admin')              -> sees ALL pipelines
--   * pipeline_memberships role IN ('owner','admin','member') on THIS pipeline
--                                                        -> sees THIS pipeline
-- A plain workspace 'member' with no pipeline_memberships row satisfies
-- neither branch, so dropping the is_workspace_member(workspace_id) clause
-- is sufficient — no new helper function needed.
--
-- is_pipeline_client(id) is unchanged and stays for magic-link clients.
--
-- ┌─ DOWN PLAN
-- │   drop policy if exists pipelines_select on public.pipelines;
-- │   create policy pipelines_select on public.pipelines
-- │   for select using (
-- │     public.is_workspace_member(workspace_id)
-- │     or public.is_pipeline_agency_member(id)
-- │     or public.is_pipeline_client(id)
-- │   );
-- │   (restores the pre-existing behavior from 20260509130000)
-- └──────────────────────────────────────────────────────────────────────────

drop policy if exists pipelines_select on public.pipelines;

create policy pipelines_select on public.pipelines
for select using (
  public.is_pipeline_agency_member(id)
  or public.is_pipeline_client(id)
);


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- 1. Owner sees every pipeline in their workspace (unchanged):
--   select count(*) from pipelines where workspace_id = '<ws>';
--   -- as the owner: full count. As a plain member with 0 pipeline_memberships
--   -- rows: 0 rows.
--
-- 2. A plain member added to exactly one pipeline (pipeline_memberships
--   role='member') sees exactly that one pipeline, not the workspace's others.
--
-- 3. Admin (workspace role='admin') still sees every pipeline, matching
--   is_pipeline_agency_member's workspace-role branch.
--
-- 4. A client (pipeline_memberships role='client') is unaffected — still
--   sees only their own pipeline via is_pipeline_client.
-- ============================================================================
