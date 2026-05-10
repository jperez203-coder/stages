-- ============================================================================
-- Stages — Fix: workspace owner protection trigger blocked workspace DELETE
-- ============================================================================
-- Bug discovered during the Phase 3.3 → 3.4 cleanup harness run:
--
-- The original prevent_last_workspace_owner_removal trigger was a
-- BEFORE DELETE row trigger. When a workspace was deleted (either
-- directly by an owner via the app, or by the test cleanup script),
-- the cascade fired DELETE on workspace_memberships rows, the trigger
-- ran for each membership delete, and saw "workspace_memberships about
-- to have zero owners" — so it raised. Net effect: workspace owners
-- could not delete their own workspace, and test cleanup was impossible.
--
-- The actual invariant we want: "if a workspace exists, it must have
-- at least one owner." The trigger should NOT fire for memberships
-- that are being cascade-deleted because the parent workspace is also
-- being deleted.
--
-- The cleanest implementation: switch from BEFORE DELETE row trigger
-- to AFTER DELETE constraint trigger (INITIALLY IMMEDIATE). Constraint
-- triggers fire at the END of the statement (after cascades complete),
-- so the trigger body can simply check whether the workspace still
-- exists. If yes → enforce owner requirement. If no → skip (cascade).
--
-- Test 21 (last-owner protection on direct membership DELETE) still
-- passes with this change because the workspace row continues to
-- exist when only a membership row is being deleted. The trigger
-- fires at end of statement, sees workspace exists with zero owners,
-- raises. Same observed behavior; fixed semantics underneath.
-- ============================================================================


-- Replace the function body. Same name, same security context.
-- Changes:
--   * Returns null (AFTER trigger return value is ignored anyway)
--   * Skips check entirely if the workspace row no longer exists
--   * Otherwise checks the actual invariant (workspace has >=1 owner)
create or replace function public.prevent_last_workspace_owner_removal()
returns trigger language plpgsql security definer
set search_path = ''
as $$
begin
  -- If the workspace is also being deleted (cascade case), the workspace
  -- row will be gone by the time this constraint trigger fires at the
  -- end of the statement. Nothing to protect — let the cascade complete.
  if not exists (select 1 from public.workspaces where id = old.workspace_id) then
    return null;
  end if;

  -- Workspace still exists. Verify it still has at least one owner.
  if not exists (
    select 1 from public.workspace_memberships
    where workspace_id = old.workspace_id and role = 'owner'
  ) then
    raise exception 'Cannot remove the last owner from a workspace. Transfer ownership first.';
  end if;

  return null;
end;
$$;


-- Replace the trigger. Drop the old BEFORE DELETE trigger and recreate as
-- a CONSTRAINT TRIGGER with deferred-but-defaults-to-immediate semantics.
-- Constraint triggers must be AFTER and FOR EACH ROW; INITIALLY IMMEDIATE
-- means the check fires at end of each statement (after cascades resolve)
-- but can be deferred to commit-time later via `set constraints` if a
-- future flow needs to swap owners atomically.
drop trigger if exists workspace_memberships_prevent_last_owner_removal
  on public.workspace_memberships;

create constraint trigger workspace_memberships_prevent_last_owner_removal
  after delete on public.workspace_memberships
  deferrable initially immediate
  for each row execute function public.prevent_last_workspace_owner_removal();


-- ============================================================================
-- Verification (run manually after apply)
-- ============================================================================
-- Re-run RLS_TEST.md Test 21 to confirm direct membership DELETE still
-- raises. Then run RLS_TEST.md Phase 5 Step A (cleanup) to confirm
-- workspace cascade DELETE now succeeds.
-- ============================================================================
