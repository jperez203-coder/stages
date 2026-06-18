-- ============================================================================
-- NF-2.4: fix seed_channel_memberships_on_pipeline_join asymmetry
-- ============================================================================
-- The seed trigger (20260525120000) auto-joins agency pipeline_memberships
-- to is_client=false channels and client pipeline_memberships to
-- is_client=true channels. The agency-side restriction was deliberate at
-- the time ("only the pipeline creator goes in the client channel — other
-- agency members opt in explicitly"), per the comment in the original
-- migration. But the product behavior we actually want — confirmed by
-- NF-2.3 — is that EVERY agency teammate can read/send in the client
-- channel without an explicit invite.
--
-- Today's effect of the asymmetry:
--   * channel_messages_select gates on is_channel_member → agency
--     teammates other than the pipeline creator get a blank client
--     channel (every message hidden by RLS).
--   * channel_messages_insert (and send_channel_message RPC) gates on
--     is_channel_member → those same teammates can't send either.
--   * NF-2 mentions still RESOLVE for them (RPC-side audience walks
--     workspace_memberships + pipeline_memberships, not channel_
--     memberships), so they receive notification rows — but
--     click-through 403s on the source message.
--
-- This migration closes the gap by:
--   1. Replacing the trigger function so agency pipeline_memberships
--      seed into ALL channels (both is_client values). Client
--      pipeline_memberships still only seed into is_client=true
--      channels — that direction is the intended privacy boundary.
--   2. Backfilling channel_memberships for every existing agency
--      pipeline_memberships row missing a row for any channel on the
--      same pipeline.
--
-- The 20260612140000 cleanup-on-DELETE trigger remains symmetric:
-- removing a pipeline_memberships row already deletes channel_memberships
-- for every channel on the same pipeline regardless of is_client. So this
-- migration only widens the INSERT side.
--
-- ── RELATED GAP — NOT FIXED HERE ──────────────────────────────────────
-- There is no trigger on public.channels INSERT. Today every channel is
-- created inside create_pipeline_with_channels which manually inserts
-- channel_memberships for the pipeline creator. So the parallel gap
-- ("existing pipeline members miss rows for newly-created channels") is
-- purely theoretical — no path creates channels post-pipeline-creation.
-- If/when an "add channel later" UI/RPC ships, that path must seed
-- channel_memberships for the full pipeline membership at the same
-- time, OR a new AFTER INSERT trigger on channels must be added. Flag.
--
-- ── BACKFILL ─────────────────────────────────────────────────────────
-- Idempotent via ON CONFLICT (channel_id, user_id) DO NOTHING. Safe to
-- re-run. Touches only agency pipeline_memberships → is_client=true
-- channels — every other (role, is_client) pair was already covered
-- by the original trigger or this migration's no-op cases.
--
-- ┌─ DOWN PLAN
-- │
-- │   -- Revert the function body to the pre-NF-2.4 asymmetric shape.
-- │   -- Copy-paste from 20260525120000_seed_channel_memberships_on_pipeline_join.sql
-- │   -- (the create or replace function block, lines 62-93).
-- │   --
-- │   -- The backfilled rows stay — DELETE-ing them would also remove
-- │   -- channel_memberships that future legitimate manual-join flows
-- │   -- may have created since. Restore from a pre-apply snapshot if
-- │   -- you need a clean undo.
-- │
-- └──────────────────────────────────────────────────────────────────────
-- ============================================================================


-- ─── 1. Trigger function (CREATE OR REPLACE preserves trigger binding) ───

create or replace function public.seed_channel_memberships_on_pipeline_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- NF-2.4: agency pipeline_memberships seed into ALL channels.
  -- Was previously gated to c.is_client = false; that gate is removed.
  if NEW.role in ('owner', 'admin', 'member') then
    insert into public.channel_memberships (channel_id, user_id)
    select c.id, NEW.user_id
    from public.channels c
    where c.pipeline_id = NEW.pipeline_id
    on conflict (channel_id, user_id) do nothing;

  elsif NEW.role = 'client' then
    -- Clients remain restricted to is_client=true channels. This is the
    -- intentional privacy boundary — clients must NOT see agency-side
    -- (is_client=false) channels.
    insert into public.channel_memberships (channel_id, user_id)
    select c.id, NEW.user_id
    from public.channels c
    where c.pipeline_id = NEW.pipeline_id
      and c.is_client = true
    on conflict (channel_id, user_id) do nothing;
  end if;

  -- Unrecognized roles are a silent no-op (per original comment in
  -- 20260525120000 — pipeline_memberships.role has no CHECK constraint
  -- so we let unexpected values land + surface downstream rather than
  -- blocking the parent INSERT).
  return NEW;
end;
$$;


-- ─── 2. Backfill ──────────────────────────────────────────────────────────
-- One-time INSERT … SELECT covering every agency pipeline_memberships row
-- × every channel on the same pipeline. ON CONFLICT handles the rows
-- already seeded by the pre-NF-2.4 trigger (is_client=false channels)
-- plus the pipeline-creator step-5 manual insert (is_client=true creator
-- row).

insert into public.channel_memberships (channel_id, user_id)
select c.id, pm.user_id
from public.pipeline_memberships pm
join public.channels c on c.pipeline_id = pm.pipeline_id
where pm.role in ('owner', 'admin', 'member')
on conflict (channel_id, user_id) do nothing;


-- ============================================================================
-- VERIFICATION QUERIES (commented — run in SQL editor after apply)
-- ============================================================================
-- (a) Function body refreshed (look for the absence of c.is_client = false
--     in the agency branch):
--   select prosrc
--   from pg_proc
--   where proname = 'seed_channel_memberships_on_pipeline_join';
--
-- (b) Trigger still bound (CREATE OR REPLACE preserves it, but verify):
--   select tgname, tgtype, tgenabled
--   from pg_trigger
--   where tgname = 'pipeline_memberships_seed_channels'
--     and tgrelid = 'public.pipeline_memberships'::regclass;
--
-- (c) Backfill estimate — how many rows the backfill INSERT will land.
--     Run BEFORE the migration to get the estimate; run AFTER to confirm
--     it's now zero:
--   select count(*) as missing_pairs
--   from public.pipeline_memberships pm
--   join public.channels c on c.pipeline_id = pm.pipeline_id
--   left join public.channel_memberships cm
--     on cm.channel_id = c.id and cm.user_id = pm.user_id
--   where pm.role in ('owner', 'admin', 'member')
--     and cm.channel_id is null;
--   -- Expected: pre-migration > 0; post-migration = 0.
--
-- (d) Per-pipeline sanity: for every pipeline, every agency
--     pipeline_memberships user should now be a channel_memberships
--     row in every channel on the pipeline:
--   select p.id as pipeline_id, p.name,
--          (select count(*) from public.pipeline_memberships pm
--           where pm.pipeline_id = p.id
--             and pm.role in ('owner','admin','member')) as agency_members,
--          (select count(*) from public.channels c
--           where c.pipeline_id = p.id) as channels,
--          (select count(*) from public.pipeline_memberships pm
--           join public.channels c on c.pipeline_id = pm.pipeline_id
--           join public.channel_memberships cm
--             on cm.channel_id = c.id and cm.user_id = pm.user_id
--           where pm.pipeline_id = p.id
--             and pm.role in ('owner','admin','member')) as joined_pairs
--   from public.pipelines p
--   order by p.created_at desc
--   limit 20;
--   -- Expected: joined_pairs = agency_members × channels for each row.
--
-- (e) Spot-check the smoke test pipeline's client channel: Alex Agency
--     + Taylor Teammate should both have channel_memberships rows now.
--     Replace the pipeline id below with Jordan's smoke test pipeline:
--   select p.email, pm.role,
--          exists (
--            select 1 from public.channel_memberships cm
--            join public.channels c on c.id = cm.channel_id
--            where c.pipeline_id = pm.pipeline_id
--              and c.is_client = true
--              and cm.user_id = pm.user_id
--          ) as in_client_channel
--   from public.pipeline_memberships pm
--   join public.profiles p on p.id = pm.user_id
--   where pm.pipeline_id = '<smoke test pipeline id>'
--     and pm.role in ('owner','admin','member')
--   order by pm.role, p.email;
--   -- Expected: every agency row shows in_client_channel = true.
-- ============================================================================
