-- ============================================================================
-- RPC: get_pipeline_workspace_owner_company(p_id uuid) → text
-- ============================================================================
--
-- BUG BEING FIXED
--   The portal "Client of: <Agency>" pill in HeaderWorkspaceSwitcher was
--   trying to resolve the workspace owner's profiles.company_name via a
--   client-side nested SELECT on workspace_memberships:
--
--     supabase.from("workspace_memberships")
--       .select("profile:profiles(company_name)")
--       .eq("workspace_id", wsId).eq("role", "owner") ...
--
--   But workspace_memberships_select is gated on is_workspace_member, and
--   clients (pipeline_memberships.role='client') have no workspace_memberships
--   row → policy fails → 0 rows → pill always falls back to workspace name.
--
-- WHY NOT JUST WIDEN RLS
--   * Widen workspace_memberships_select for clients: would leak the
--     identities + roles of every teammate at the agency. Wrong scope.
--   * Widen pipeline_memberships_select for clients (so they can see the
--     pipeline-level owner row): same leak concern — exposes who else is
--     on their pipeline. Not necessary.
--   * Denormalize workspaces.owner_user_id: reverses a deliberate Phase 3
--     schema decision ("no denormalized owner columns" — CLAUDE.md). Needs
--     a sync trigger to stay honest on ownership changes. More invasive.
--
--   The SECURITY DEFINER RPC below is the narrowest fix: it returns ONLY
--   the owner's company_name (no other identifying info), and only when
--   the caller actually has a pipeline_memberships row on the given
--   pipeline.
--
-- AUTHORIZATION GUARD
--   The WHERE clause requires `me.user_id = auth.uid()` joined to a
--   pipeline_memberships row for the requested pipeline. So a caller with
--   no membership on that pipeline gets NULL — same return as
--   "company_name is null" or "owner has no company_name yet". This
--   indistinguishability is intentional: nothing about the caller's
--   authorization status leaks back through the return value.
--
-- MULTI-OWNER WORKSPACES
--   CLAUDE.md's Phase 3 schema decisions explicitly support multiple
--   role='owner' rows per workspace. This RPC picks the earliest-joined
--   owner (`order by wm.joined_at asc limit 1`). Real product impact is
--   minimal today (most workspaces have one owner), but flagging
--   explicitly so the next reader isn't surprised. If multi-owner becomes
--   common and a richer rule is needed (workspace.primary_owner_id,
--   return-all-as-array, etc.), revisit this function.
--
-- DOWN PLAN
--   `drop function if exists public.get_pipeline_workspace_owner_company(uuid);`
--
-- APPLY VIA: Supabase Dashboard SQL editor (do NOT db push). Run the
-- verification block at the bottom afterward.
-- ============================================================================

create or replace function public.get_pipeline_workspace_owner_company(p_id uuid)
returns text
language sql security definer stable
set search_path = ''
as $$
  select pr.company_name
  from public.pipeline_memberships me
  join public.pipelines p on p.id = me.pipeline_id
  join public.workspace_memberships wm
    on wm.workspace_id = p.workspace_id and wm.role = 'owner'
  join public.profiles pr on pr.id = wm.user_id
  where me.pipeline_id = p_id
    and me.user_id = (select auth.uid())
  order by wm.joined_at asc
  limit 1;
$$;

grant execute on function public.get_pipeline_workspace_owner_company(uuid) to authenticated;
revoke execute on function public.get_pipeline_workspace_owner_company(uuid) from public;

-- ============================================================================
-- VERIFY (run after applying):
-- select proname, prosecdef, pg_get_functiondef(oid)
-- from pg_proc
-- where proname = 'get_pipeline_workspace_owner_company';
-- Should show prosecdef = true (security definer) and the body above.
--
-- Optional behavior probe (replace <pipeline-id> with a real pipeline the
-- caller is on; run as the caller, not service role):
-- select public.get_pipeline_workspace_owner_company('<pipeline-id>'::uuid);
-- Returns text (the owner's company_name) or NULL.
-- ============================================================================
