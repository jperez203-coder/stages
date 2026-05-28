-- ============================================================================
-- Admin pipeline access + create-permission alignment
-- ============================================================================
--
-- PURPOSE
--   Give workspace-level ADMINS the same blanket pipeline access that
--   workspace OWNERS already have. Before this migration, the four
--   pipeline-access helper functions granted blanket (workspace-wide)
--   access only when the caller's workspace_memberships.role = 'owner'.
--   Workspace admins fell through to the pipeline_memberships branch,
--   meaning an admin could NOT see/edit/submit/check a pipeline unless
--   someone had explicitly inserted a pipeline_memberships row for them.
--
--   After this migration:
--     • OWNER  → blanket access to every pipeline in the workspace (unchanged)
--     • ADMIN  → blanket access to every pipeline in the workspace (NEW)
--     • MEMBER → per-pipeline access only; needs an explicit
--                pipeline_memberships row (unchanged)
--     • CLIENT → per-pipeline role='client' (unchanged, untouched here)
--
-- WHAT CHANGED
--   Exactly one line in each of four helpers: the workspace-role branch
--   flips from  `wm.role = 'owner'`  to  `wm.role in ('owner','admin')`.
--   The pipeline_memberships fallback branch in each function is preserved
--   verbatim, as are security definer / search_path / language / stability.
--
--   Helpers updated:
--     - is_pipeline_agency_member(p_id)   -- gates SELECT (see)
--     - can_edit_pipeline(p_id)           -- gates content edits
--     - can_submit_pipeline(p_id)         -- gates pipelines.submitted_*
--     - can_check_pipeline_task(p_id)     -- gates task done-toggle
--
--   Originals defined in 20260509120000_rls_policies.sql (lines 61-184).
--
-- CREATE-PERMISSION NOTE (no change needed)
--   The build spec also asked to restrict pipeline CREATION to owner/admin
--   so members cannot create pipelines. This is ALREADY enforced:
--   create_pipeline_with_channels (both the 4-arg overload in
--   20260520120000 and the 5-arg/template overload in 20260609120000)
--   gates on `is_workspace_owner_or_admin(workspace_id)`, which checks
--   `role in ('owner','admin')`. Members are already rejected at the RPC
--   with "You must be a workspace owner or admin to create pipelines".
--   No DDL change is required here for the create permission — this
--   migration only widens the four ACCESS helpers to include admins.
--
-- SECURITY REVIEW
--   This WIDENS access for workspace admins only. It does not touch:
--     - is_pipeline_client (client access path) — unchanged
--     - the pipeline_memberships branches (member/admin pipeline-level
--       rules, can_submit / can_check_tasks flags) — unchanged
--     - workspace isolation / cross-agency isolation — unchanged (every
--       branch still scopes by wm.workspace_id = p.workspace_id)
--   A workspace admin already had owner-adjacent powers (invite teammates,
--   etc.); this aligns pipeline access with that authority. Note this also
--   means a workspace admin can now submit ANY pipeline in the workspace
--   (via the widened can_submit_pipeline workspace branch) — intended per
--   "ADMINS: blanket pipeline access".
--
-- DOWN PLAN
--   To revert, CREATE OR REPLACE each of the four functions below with the
--   workspace-role branch restored to `wm.role = 'owner'` (i.e. restore the
--   bodies as they stand in 20260509120000_rls_policies.sql lines 61-184).
--
-- APPLY VIA: Supabase Dashboard SQL editor (do NOT db push). Run the
-- verification block at the bottom afterward.
-- ============================================================================

-- ── 1. is_pipeline_agency_member: gates whether the caller can SEE a pipeline.
create or replace function public.is_pipeline_agency_member(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role in ('owner', 'admin')
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'admin', 'member')
        )
      )
  );
$$;

-- ── 2. can_edit_pipeline: gates content edits (stages, tasks, notes, files…).
create or replace function public.can_edit_pipeline(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role in ('owner', 'admin')
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and pm.role in ('owner', 'admin')
        )
      )
  );
$$;

-- ── 3. can_submit_pipeline: gates pipelines.submitted_at / submitted_by.
create or replace function public.can_submit_pipeline(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role in ('owner', 'admin')
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and (pm.role = 'owner' or (pm.role = 'admin' and pm.can_submit = true))
        )
      )
  );
$$;

-- ── 4. can_check_pipeline_task: gates the task done/undone toggle.
create or replace function public.can_check_pipeline_task(p_id uuid)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (
    select 1 from public.pipelines p
    where p.id = p_id
      and (
        exists (
          select 1 from public.workspace_memberships wm
          where wm.workspace_id = p.workspace_id
            and wm.user_id = (select auth.uid())
            and wm.role in ('owner', 'admin')
        )
        or exists (
          select 1 from public.pipeline_memberships pm
          where pm.pipeline_id = p_id
            and pm.user_id = (select auth.uid())
            and (
              pm.role in ('owner', 'admin')
              or (pm.role = 'member' and pm.can_check_tasks = true)
            )
        )
      )
  );
$$;

-- ============================================================================
-- VERIFY (run after applying):
--   select proname, pg_get_functiondef(oid)
--   from pg_proc
--   where proname in (
--     'is_pipeline_agency_member',
--     'can_edit_pipeline',
--     'can_submit_pipeline',
--     'can_check_pipeline_task'
--   )
--   order by proname;
--
-- Each function's workspace_memberships branch should now read
--   wm.role in ('owner', 'admin')
-- and the pipeline_memberships branch should be unchanged from before.
--
-- Spot-check (optional): confirm create perms still reject members —
--   select pg_get_functiondef(oid) from pg_proc
--   where proname = 'is_workspace_owner_or_admin';
-- should show role in ('owner','admin'); create_pipeline_with_channels
-- calls it, so members remain blocked from creation with no change here.
-- ============================================================================
