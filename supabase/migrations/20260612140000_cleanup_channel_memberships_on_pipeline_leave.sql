-- ============================================================================
-- PI-followup-4: AFTER DELETE channel_memberships cleanup trigger
--
-- Patches the asymmetric-trigger gap flagged during PI-followup-3.
--
-- BACKGROUND
-- ──────────
-- The seed-on-INSERT trigger `pipeline_memberships_seed_channels`
-- (migration 20260525120000) creates channel_memberships rows whenever
-- a user joins a pipeline. There was no corresponding cleanup-on-DELETE
-- trigger. PI-followup-3 added the remove-member affordance (calling
-- the remove_pipeline_member RPC, which DELETEs the pipeline_memberships
-- row), but the cleanup gap meant the removed user's channel_memberships
-- rows were left orphaned.
--
-- Resulting privilege residue: channel_memberships_select admits the
-- caller via `is_channel_member(channel_id) OR is_pipeline_agency_member(
-- (select pipeline_id from channels where id = channel_id))`. The first
-- arm matches via the orphaned row, so the removed user could continue
-- reading channel messages via direct PostgREST until rotated out by
-- some other path. This trigger closes that hole.
--
-- DESIGN — mirrors the INSERT trigger pattern intentionally
-- ─────────────────────────────────────────────────────────
--   * SECURITY DEFINER — same justification: the actor invoking the
--     parent DELETE on pipeline_memberships often does NOT have RLS
--     DELETE privilege on channel_memberships directly. The
--     remove_pipeline_member RPC is also SECURITY DEFINER, but nested
--     SECURITY DEFINER does NOT compound — the trigger function needs
--     its own definer privileges.
--   * search_path = '' — required for SECURITY DEFINER functions to
--     prevent search-path-injection. Every table reference is fully
--     qualified with `public.`.
--   * No on-conflict needed — DELETE on a row that doesn't exist is a
--     no-op, so the cleanup is idempotent without explicit handling.
--   * The DELETE is scoped by (user_id, channel_id IN pipeline channels)
--     so it cleans up BOTH agency and client channel memberships for
--     this user on this pipeline — symmetric with the INSERT trigger
--     which seeds either agency or client channels depending on role.
--     The removed user keeps NOTHING tied to this pipeline's channels.
--
-- SCOPE OF SIDE EFFECTS
-- ─────────────────────
--   * Only deletes channel_memberships rows. Does NOT delete
--     channel_messages the user authored (their content survives).
--   * Does NOT touch other pipelines' channel_memberships rows — the
--     `channel_id IN (… where pipeline_id = OLD.pipeline_id)` clause
--     constrains cleanup to the pipeline being left.
--   * Does NOT touch workspace_memberships (the billable seat). That's
--     the right semantic: removing a teammate from a pipeline does not
--     remove their workspace seat.
--
-- ┌─ DOWN PLAN
-- │
-- │   drop trigger if exists pipeline_memberships_cleanup_channels
-- │     on public.pipeline_memberships;
-- │   drop function if exists
-- │     public.cleanup_channel_memberships_on_pipeline_leave();
-- │   -- (Orphaned channel_memberships rows that this trigger DELETEd
-- │   --  cannot be recreated from this trigger alone — restore from a
-- │   --  pre-apply snapshot if you need them back.)
-- │
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Trigger function ───────────────────────────────────────────────────

create or replace function public.cleanup_channel_memberships_on_pipeline_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.channel_memberships
  where user_id = OLD.user_id
    and channel_id in (
      select c.id from public.channels c
      where c.pipeline_id = OLD.pipeline_id
    );

  return OLD;
end;
$$;


-- ─── 2. Trigger binding ───────────────────────────────────────────────────
-- AFTER DELETE FOR EACH ROW. Matches the per-row shape of the existing
-- seed-on-INSERT trigger; future bulk-delete paths will work without
-- re-binding.

drop trigger if exists pipeline_memberships_cleanup_channels
  on public.pipeline_memberships;

create trigger pipeline_memberships_cleanup_channels
  after delete on public.pipeline_memberships
  for each row
  execute function public.cleanup_channel_memberships_on_pipeline_leave();


-- ─── 3. Verification (run after apply) ────────────────────────────────────
-- (Comments only — the apply path is the Supabase dashboard SQL editor.
-- Copy/paste each block in a separate execution to verify state.)
--
-- A. Function exists, is SECURITY DEFINER, search_path = ''.
--    select proname, prosecdef, proconfig
--    from pg_proc
--    where proname = 'cleanup_channel_memberships_on_pipeline_leave';
--
-- B. Trigger is bound, fires AFTER DELETE.
--    select tgname, tgtype, tgenabled
--    from pg_trigger
--    where tgname = 'pipeline_memberships_cleanup_channels'
--      and tgrelid = 'public.pipeline_memberships'::regclass;
--
-- C. End-to-end: pick a test user previously on a pipeline. Confirm
--    channel_memberships rows exist for the user across that pipeline's
--    channels, then call remove_pipeline_member, then confirm those
--    rows are gone (and the user's rows for OTHER pipelines are intact).

comment on function public.cleanup_channel_memberships_on_pipeline_leave() is
  'PI-followup-4: AFTER DELETE on pipeline_memberships, deletes the same users channel_memberships rows for every channel of the same pipeline. Mirrors seed_channel_memberships_on_pipeline_join (insert side). Closes the orphan-channel-access gap from PI-followup-3.';
