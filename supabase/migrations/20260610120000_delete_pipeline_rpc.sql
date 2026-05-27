-- ============================================================================
-- delete_pipeline RPC — security definer, can_edit_pipeline gate,
-- storage cleanup + cascade DELETE in one transaction
-- ============================================================================
-- Adds the destructive "delete pipeline" path used by the overflow `...`
-- menu on PipelineHeader. Single RPC because:
--
--   * The permission rule we want (can_edit_pipeline — workspace OWNER or
--     pipeline owner/admin) is BROADER than the existing pipelines_delete
--     RLS policy (workspace OWNER only, defined in 20260509120000). The
--     RPC is security definer, re-checks can_edit_pipeline server-side,
--     and bypasses the narrower RLS policy when permitted. The existing
--     RLS DELETE policy stays UNTOUCHED as a backstop for any direct
--     PostgREST DELETE call.
--   * Atomicity — a PL/pgSQL function runs as one transaction. Any
--     failure rolls back everything (the cascade DELETE included).
--
-- ── SECURITY POSTURE (intentional broadening, flagged in scope) ─────
--
-- can_edit_pipeline is true for workspace OWNER + pipeline owner/admin.
-- Pre-this-RPC, the pipelines_delete RLS policy allowed workspace OWNER
-- only — pipeline admins could edit stages/tasks but couldn't nuke the
-- whole pipeline. This RPC extends delete to pipeline owner/admin.
-- Consistent with the save-as-template flow (same gate). Founder
-- consciously accepted the broadening; documenting here so a future
-- maintainer doesn't quietly tighten back to workspace-owner-only and
-- create a UX regression on the menu item.
--
-- ── CASCADE FOOTPRINT (what the DELETE FROM pipelines triggers) ─────
--
-- Direct FKs to pipelines(id), all ON DELETE CASCADE:
--   pipeline_memberships, stages, pipeline_links, channels,
--   activity_events, team_invites, client_invites
--
-- Cascade chains (rows that disappear because their parent cascades):
--   tasks → checklist_items
--   stage_notes
--   stage_attachments (metadata rows only; bytes orphan in bucket — see STORAGE section below)
--   channel_memberships
--   channel_messages
--
-- ON DELETE SET NULL (rows survive, pointer clears):
--   templates.source_pipeline_id  ← saved templates SURVIVE (correct)
--   profiles.last_active_pipeline_id  ← users' "last opened" pointer clears
--
-- ── STORAGE — ORPHANS ACCEPTED (janitor pass deferred) ─────────────
--
-- Two buckets carry pipeline-owned files (`{pipeline_id}/...` paths):
--   pipeline_files       — Files-tab uploads
--   stage_attachments    — per-stage file attachments
--
-- The first draft of this RPC issued `DELETE FROM storage.objects ...`
-- inside the function body. Supabase rejects that with:
--
--     "Direct deletion from storage tables is not allowed.
--      Use the Storage API instead."
--
-- This is a Supabase server-level protection independent of RLS — even
-- a security-definer function in the postgres role can't issue DELETE
-- against storage.objects directly. The Storage API path
-- (`storage.from(bucket).remove([paths])`) is the only sanctioned
-- mechanism and lives outside SQL.
--
-- Decision (2026-05-26): ACCEPT storage orphans for v1. They are
-- privacy-safe — the bucket SELECT policies for both buckets require
-- a joined `pipeline_links` / `stage_attachments` row to evaluate
-- access, and those metadata rows cascade away with the pipeline. No
-- client path can reach the orphaned bytes. The only cost is bucket
-- storage $$ accumulating over time.
--
-- Logged to WISHLIST.md as a future janitor pass — options when it
-- ships: (a) a scheduled Edge Function that finds storage objects
-- with no joined metadata row and removes them via the Storage API;
-- (b) the delete-pipeline UI doing a best-effort app-side
-- `storage.remove()` call after the RPC returns (racy, partial-
-- delete possible, but simple). Pick when there's customer signal.
--
-- ── DOWN PLAN
-- │
-- │   revoke execute on function public.delete_pipeline(uuid) from authenticated;
-- │   drop function if exists public.delete_pipeline(uuid);
-- │
-- │   -- Existing pipelines_delete RLS policy was never touched and stays
-- │   -- in place. No data cleanup needed.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================

create or replace function public.delete_pipeline(pipeline_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  -- 1. Auth gate
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- 2. Permission gate: workspace OWNER or pipeline owner/admin. Same
  -- gate the save-as-template RPC uses. Broader than the table's RLS
  -- DELETE policy (workspace OWNER only) — intentional, documented in
  -- the header.
  if not public.can_edit_pipeline(pipeline_id) then
    raise exception
      'You must be a workspace owner, pipeline owner, or pipeline admin to delete this pipeline'
      using errcode = '42501';
  end if;

  -- 3. The pipeline DELETE. Cascades remove all directly-FK'd rows
  -- (pipeline_memberships, stages, pipeline_links, channels,
  -- activity_events, team_invites, client_invites) and downstream
  -- chains (tasks → checklist_items, stage_notes, stage_attachments,
  -- channel_memberships, channel_messages). SET NULL fires on
  -- templates.source_pipeline_id and profiles.last_active_pipeline_id.
  --
  -- Storage objects in `pipeline_files` + `stage_attachments` buckets
  -- are NOT cleaned here — see header. Orphans accepted for v1,
  -- privacy-safe via the bucket SELECT policies which require a
  -- joined metadata row (cascaded away with the pipeline). Janitor
  -- pass deferred to WISHLIST.md.
  --
  -- `delete_pipeline.pipeline_id` qualifies the parameter explicitly
  -- (defensive vs future maintainer column-collision risk; same
  -- qualification pattern as create_pipeline_with_channels).
  delete from public.pipelines
  where id = delete_pipeline.pipeline_id;
end;
$$;


-- ─── Grants ────────────────────────────────────────────────────────────────
revoke execute on function public.delete_pipeline(uuid) from public;
grant  execute on function public.delete_pipeline(uuid) to authenticated;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run after apply)
-- ============================================================================
-- (a) Function exists with right signature + security context
--   select proname, prosecdef, provolatile,
--          pg_get_function_identity_arguments(oid) as args
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'delete_pipeline';
--   -- Expected: 1 row. prosecdef = true. provolatile = 'v'.
--   -- args = 'pipeline_id uuid'.
--
-- (b) Grant exists for authenticated role
--   select has_function_privilege('authenticated',
--          'public.delete_pipeline(uuid)',
--          'EXECUTE') as can_call;
--   -- Expected: true.
--
-- (c) Sanity: existing RLS DELETE policy on pipelines still in place,
--     untouched by this migration (defense-in-depth backstop).
--   select polname, pg_get_expr(polqual, polrelid) as using_expr
--   from pg_policy
--   where polrelid = 'public.pipelines'::regclass
--     and polname = 'pipelines_delete';
--   -- Expected: 1 row. using_expr contains 'is_workspace_owner'.
--   -- NOT changed by this migration.
-- ============================================================================
