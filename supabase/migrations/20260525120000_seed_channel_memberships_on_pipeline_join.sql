-- ============================================================================
-- Phase 4b slice 2a — channel_memberships seed-gap fix
-- ============================================================================
-- BUG: only the pipeline creator was ever inserted into channel_memberships
-- (by the create_pipeline_with_channels RPC's explicit step-5 INSERT).
-- Every OTHER user who later gained pipeline access — accepted clients,
-- invited teammates, future admin promotions — got a pipeline_memberships
-- row but NO channel_memberships row. The downstream effects:
--
--   * channel_messages_select gates on is_channel_member: non-creator
--     users see ZERO messages even in channels they should have access to.
--   * channel_messages_insert gates on is_channel_member: non-creator
--     users cannot post at all (blocks the entire chat send path).
--
-- This trigger closes the gap for every future pipeline_memberships
-- INSERT, and the backfill at the bottom retroactively repairs every
-- existing pipeline_memberships row.
--
-- ROLE → CHANNEL-TYPE MAPPING (locked):
--   * owner / admin / member → joined to every is_client=false channel
--     in the pipeline (the internal/agency channels)
--   * client → joined to every is_client=true channel in the pipeline
--     (the client channel, max 1 per pipeline per the partial unique index)
--
-- Owners are NOT auto-joined to the client channel by this trigger.
-- The create_pipeline_with_channels RPC still manually adds the CREATOR
-- to both channels via its step-5 explicit INSERT (preserving existing
-- behavior). Future "add an owner/admin later" flows that want them in
-- the client channel will need an explicit channel_memberships INSERT —
-- this trigger covers the agency-channel half only, per the locked spec.
--
-- ┌─ DOWN PLAN
-- │
-- │   drop trigger if exists pipeline_memberships_seed_channels
-- │     on public.pipeline_memberships;
-- │   drop function if exists
-- │     public.seed_channel_memberships_on_pipeline_join();
-- │   -- (Backfilled channel_memberships rows stay — DELETE-ing them
-- │   --  would also remove legitimate manual joins; if you need to
-- │   --  unwind the backfill specifically, restore from a pre-apply
-- │   --  snapshot rather than running a blanket DELETE.)
-- │
-- └──────────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Trigger function ───────────────────────────────────────────────────
-- security definer because the inserting user often does NOT have RLS
-- INSERT privilege on channel_memberships:
--   * accept_client_invite runs as security definer and inserts the
--     client's pipeline_memberships row; the client has no can_edit_pipeline,
--     so a non-security-definer trigger would fail the channel_memberships
--     INSERT under RLS. Same pattern as the existing handle_new_user trigger.
--
-- search_path = '' is mandatory for security-definer functions to prevent
-- search-path-injection attacks — every table reference is fully qualified.
--
-- on conflict do nothing makes the trigger idempotent: re-running an INSERT
-- (whether by retry, by the backfill, or by a future "add to channel"
-- explicit join) won't fail with a unique-key violation.

create or replace function public.seed_channel_memberships_on_pipeline_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.role in ('owner', 'admin', 'member') then
    insert into public.channel_memberships (channel_id, user_id)
    select c.id, NEW.user_id
    from public.channels c
    where c.pipeline_id = NEW.pipeline_id
      and c.is_client = false
    on conflict (channel_id, user_id) do nothing;

  elsif NEW.role = 'client' then
    insert into public.channel_memberships (channel_id, user_id)
    select c.id, NEW.user_id
    from public.channels c
    where c.pipeline_id = NEW.pipeline_id
      and c.is_client = true
    on conflict (channel_id, user_id) do nothing;
  end if;

  -- Unrecognized roles (anything outside owner/admin/member/client) are
  -- a silent no-op. The pipeline_memberships role column has no CHECK
  -- constraint as of this migration, so we don't error here — better to
  -- let the row land and surface the bad role downstream than to block
  -- the parent INSERT.
  return NEW;
end;
$$;


-- ─── 2. Trigger binding ───────────────────────────────────────────────────
-- AFTER INSERT FOR EACH ROW. Runs once per row even on multi-row INSERTs
-- (e.g., a future bulk-add path). The function uses NEW.* so per-row
-- granularity is required.

drop trigger if exists pipeline_memberships_seed_channels
  on public.pipeline_memberships;

create trigger pipeline_memberships_seed_channels
  after insert on public.pipeline_memberships
  for each row
  execute function public.seed_channel_memberships_on_pipeline_join();


-- ─── 3. One-time backfill ─────────────────────────────────────────────────
-- For every existing pipeline_memberships row, ensure the matching
-- channel_memberships row(s) exist using the same role→channel-type
-- mapping as the trigger. Single statement; the WHERE clause expresses
-- the mapping inline. on conflict do nothing means re-running this
-- migration is safe — existing rows are preserved, only missing rows
-- are added.
--
-- Runs as the migration applier (typically postgres / service_role), so
-- it bypasses RLS naturally; no security-definer wrapper needed.

insert into public.channel_memberships (channel_id, user_id)
select c.id, pm.user_id
from public.pipeline_memberships pm
join public.channels c
  on c.pipeline_id = pm.pipeline_id
where (
  (pm.role in ('owner', 'admin', 'member') and c.is_client = false)
  or
  (pm.role = 'client' and c.is_client = true)
)
on conflict (channel_id, user_id) do nothing;


-- ============================================================================
-- Verification (run manually after applying — should all pass)
-- ============================================================================
-- 1. Function exists, is security definer, search_path locked:
--   select proname, prosecdef,
--          (proconfig::text)::text as cfg
--   from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname = 'seed_channel_memberships_on_pipeline_join';
--   Expected: 1 row, prosecdef=true, cfg contains 'search_path='.
--
-- 2. Trigger exists, bound to the right table + event:
--   select tgname, tgrelid::regclass, tgtype,
--          pg_get_triggerdef(oid) as def
--   from pg_trigger
--   where tgname = 'pipeline_memberships_seed_channels'
--     and tgrelid = 'public.pipeline_memberships'::regclass;
--   Expected: 1 row. def contains "AFTER INSERT" and "FOR EACH ROW".
--
-- 3. Backfill — every pipeline_memberships row should now have the
--    matching channel_memberships row(s). This query lists every (member,
--    channel) combination in pipeline 7a Smoke Test Pipeline showing
--    whether the row is now joined:
--
--   select
--     pm.role,
--     coalesce(prof.display_name, prof.email, 'no profile') as who,
--     c.name as channel_name,
--     c.is_client as channel_is_client,
--     (cm.user_id is not null) as in_channel
--   from public.pipeline_memberships pm
--   left join public.profiles prof on prof.id = pm.user_id
--   join public.channels c on c.pipeline_id = pm.pipeline_id
--   left join public.channel_memberships cm
--     on cm.channel_id = c.id and cm.user_id = pm.user_id
--   where pm.pipeline_id = 'e21260d2-e358-44b6-b453-740dcf30a8bc'
--   order by pm.role, who, c.is_client;
--
--   Expected pattern (4 members × 2 channels = 8 rows):
--     role     who                  channel_name  channel_is_client  in_channel
--     owner    Jordan Perez (etc)   general       false              true
--     owner    Jordan Perez         client        true               true   ← from RPC step-5
--     member   Alex Agency          general       false              true   ← from backfill
--     member   Alex Agency          client        true               false  ← correctly excluded
--     member   Taylor Teammate      general       false              true   ← from backfill
--     member   Taylor Teammate      client        true               false  ← correctly excluded
--     client   Casey Client         general       false              false  ← correctly excluded
--     client   Casey Client         client        true               true   ← from backfill
--     client   William Wayne        general       false              false  ← correctly excluded
--     client   William Wayne        client        true               true   ← from backfill
--
--   (Plus Jordan's owner row giving 10 rows total. Order rows can vary.
--    The critical signal: every "true" matches the role mapping and every
--    "false" is the correct exclusion.)
--
-- 4. Trigger fire test — non-destructive smoke. Insert a throwaway
--    pipeline_membership inside a transaction, observe the auto-seed,
--    then rollback. Pick a user_id that is NOT already a member of
--    the pipeline (otherwise the parent INSERT itself fails on the
--    primary key (pipeline_id, user_id)):
--
--   begin;
--   insert into public.pipeline_memberships (pipeline_id, user_id, role)
--   values (
--     'e21260d2-e358-44b6-b453-740dcf30a8bc'::uuid,
--     '<a user_id NOT already on this pipeline>'::uuid,
--     'member'
--   );
--
--   -- Should now have a row in the general channel ONLY (member → agency).
--   select c.name, c.is_client
--   from public.channel_memberships cm
--   join public.channels c on c.id = cm.channel_id
--   where cm.user_id = '<same uuid>'
--     and c.pipeline_id = 'e21260d2-e358-44b6-b453-740dcf30a8bc';
--   -- Expected: 1 row, name='general', is_client=false.
--
--   rollback;
-- ============================================================================
