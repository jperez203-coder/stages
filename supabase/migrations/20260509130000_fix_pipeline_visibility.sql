-- ============================================================================
-- Stages — Fix: pipeline-level agency members couldn't SELECT their pipeline
-- ============================================================================
-- Bug discovered during Phase 3.3 RLS verification (Test 16):
--
-- The pipelines_select policy only granted visibility to workspace_memberships
-- holders OR pipeline clients. Pipeline-level agency members (anyone added
-- directly via pipeline_memberships with role='owner'/'admin'/'member' but
-- WITHOUT a workspace_memberships row) failed both clauses, so the pipeline
-- was invisible to them. This in turn meant:
--   * Pipeline admins/members could not see their own pipeline
--   * Their UPDATEs against pipelines silently affected zero rows
--     (PostgreSQL RLS requires SELECT visibility for UPDATE row matching)
--   * The protect_pipeline_submission trigger never fired for admin attempts,
--     because the UPDATE never matched any row in the first place
--   * Subqueries like (select workspace_id from pipelines where id = ?) in
--     other policies returned null for these users, breaking related policies
--     transitively (pipeline_memberships_insert/_delete)
--
-- Same shape error in workspaces_select: a pipeline-only agency teammate
-- couldn't see the workspace their pipeline lives in, breaking the switcher
-- and any UI that joins workspace name through pipeline.
--
-- Fix: extend both SELECT policies to include the pipeline-level agency case.
-- Clients are still excluded from workspaces_select by design (they reach
-- pipelines via magic-link, never via workspace browsing).
-- ============================================================================


-- ─── pipelines_select ──────────────────────────────────────────────────────
-- Add `is_pipeline_agency_member(id)` so anyone explicitly added to the
-- pipeline as owner/admin/member can see it, regardless of workspace
-- membership status. Existing clauses preserved.
drop policy if exists pipelines_select on public.pipelines;
create policy pipelines_select on public.pipelines
for select using (
  public.is_workspace_member(workspace_id)
  or public.is_pipeline_agency_member(id)
  or public.is_pipeline_client(id)
);


-- ─── workspaces_select ─────────────────────────────────────────────────────
-- Add: anyone with an agency-side pipeline_memberships row in any pipeline of
-- this workspace can see the workspace. Clients (role='client') remain
-- excluded — the policy comment in the original migration explicitly notes
-- clients reach pipelines via magic-link, not via workspace browsing.
drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
for select using (
  public.is_workspace_member(id)
  or exists (
    select 1
    from public.pipeline_memberships pm
    join public.pipelines p on p.id = pm.pipeline_id
    where p.workspace_id = workspaces.id
      and pm.user_id = (select auth.uid())
      and pm.role in ('owner', 'admin', 'member')
  )
);


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- Confirm both policies now exist with the new bodies:
--   select policyname, qual from pg_policies
--   where schemaname = 'public'
--     and tablename in ('pipelines', 'workspaces')
--     and cmd = 'SELECT';
--
-- Re-run RLS_TEST.md tests 1-21. Every test should pass; Test 16 in
-- particular should now produce the protect_pipeline_submission trigger error
-- instead of a silent zero-row UPDATE.
-- ============================================================================
