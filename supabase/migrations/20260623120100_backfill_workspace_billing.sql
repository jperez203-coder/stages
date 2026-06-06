-- ============================================================================
-- Slice 6 (continued): backfill workspace_billing for existing workspaces
--
-- Sibling to 20260623120000_track_b_trial_architecture.sql. Part A
-- shipped the AFTER INSERT trigger so NEW workspaces auto-init their
-- workspace_billing row; this migration backfills EXISTING workspaces
-- that were created before the trigger landed.
--
-- BACKFILL POLICY (locked):
--   * status='trialing', plan=null, no Stripe sub — same shape the
--     trigger inserts for new workspaces.
--   * trial_ends_at = greatest(workspaces.created_at + 14 days,
--                              now() + 1 day)
--     → workspaces created <13 days ago: their natural trial deadline
--       (created_at + 14d). They get exactly the time they "should"
--       have had.
--     → workspaces created ≥13 days ago: now() + 1 day grace. Trial
--       would have already expired under the new architecture; we
--       grant a 24-hour grace window so existing prod users have a
--       chance to react to the dashboard banner before being
--       read-only.
--   * current_period_end mirrors trial_ends_at (same shape the trigger
--     uses for newly-created workspaces).
--   * day12_notified_at / day28_notified_at = NULL — no historical
--     nudge has been sent, so leaving NULL lets the cron pick eligible
--     workspaces up naturally on next run.
--
-- ON CONFLICT (workspace_id) DO NOTHING — idempotent. Safe to re-run.
-- Founders' manually-granted workspace_billing rows and any Slice 5
-- founding-upgrade webhook rows are NOT clobbered (same first-writer-
-- wins protection pattern as Part A's trigger).
--
-- AUDIT NOTICES
--   The migration uses RAISE NOTICE to print before/after counts so the
--   SQL editor output captures the backfill outcome. Cleaner than two
--   separate manual SELECT runs by hand. The notices show up in the
--   "Messages" panel after running.
--
-- DOWN PLAN
--   The backfilled rows are indistinguishable from rows the Part A
--   trigger would have created if it had existed at the time. There
--   is no clean down-migration. To "revert" you would:
--     delete from public.workspace_billing
--     where stripe_subscription_id is null
--       and subscription_status = 'trialing'
--       and day12_notified_at is null
--       and day28_notified_at is null;
--   But this also deletes legitimate Slice 6 trigger-created rows for
--   any post-migration workspace, so it's only safe immediately after
--   applying both migrations. Don't do this.
-- ============================================================================


do $$
declare
  v_workspaces_count int;
  v_billing_before int;
  v_billing_after int;
  v_rows_inserted int;
begin
  -- 1. Snapshot pre-backfill counts.
  select count(*) into v_workspaces_count from public.workspaces;
  select count(*) into v_billing_before from public.workspace_billing;
  raise notice '[backfill] Before: workspaces=%, workspace_billing=%',
    v_workspaces_count, v_billing_before;

  -- 2. Backfill.
  insert into public.workspace_billing (
    workspace_id,
    stripe_subscription_id,
    subscription_status,
    plan,
    trial_ends_at,
    current_period_end,
    day12_notified_at,
    day28_notified_at
  )
  select
    w.id,
    null,
    'trialing',
    null,
    greatest(w.created_at + interval '14 days', now() + interval '1 day'),
    greatest(w.created_at + interval '14 days', now() + interval '1 day'),
    null,
    null
  from public.workspaces w
  on conflict (workspace_id) do nothing;

  get diagnostics v_rows_inserted = row_count;

  -- 3. Snapshot post-backfill counts.
  select count(*) into v_billing_after from public.workspace_billing;
  raise notice '[backfill] After:  workspaces=%, workspace_billing=%, inserted=%',
    v_workspaces_count, v_billing_after, v_rows_inserted;

  -- 4. Soft assertion. Every workspace should have a billing row post-
  -- backfill. NOTICE rather than EXCEPTION so the migration completes
  -- even in the edge case where a workspace was inserted by app
  -- traffic between Part A's trigger landing and this backfill
  -- running — that workspace gets its billing row from the trigger,
  -- not from us, and that's the correct outcome.
  if v_billing_after < v_workspaces_count then
    raise notice
      '[backfill] WARNING: % workspaces still lack billing rows after backfill',
      v_workspaces_count - v_billing_after;
  end if;
end;
$$;


-- ============================================================================
-- POST-APPLY VERIFICATION — paste each block; expected outputs inline.
-- The DO block above already printed before/after counts via RAISE
-- NOTICE; these queries give you the persisted-state view post-apply.
-- ============================================================================
--
-- VERIFY 1 — counts: every workspace now has a billing row.
--
-- select
--   (select count(*) from public.workspaces) as workspaces_count,
--   (select count(*) from public.workspace_billing) as billing_count,
--   (select count(*) from public.workspaces) -
--   (select count(*) from public.workspace_billing) as gap;
-- -- Expected: gap = 0 (every workspace has a billing row).
-- -- gap < 0 (negative) is also fine if you have billing rows for
-- -- workspaces that were since deleted — Slice 1 FK is ON DELETE
-- -- CASCADE so this shouldn't happen in practice, but logically valid.
-- -- gap > 0 indicates the backfill missed something — investigate.
--
-- VERIFY 2 — sample 5 backfilled rows to inspect trial_ends_at math.
--
-- select
--   w.name,
--   w.created_at,
--   wb.subscription_status,
--   wb.plan,
--   wb.trial_ends_at,
--   age(wb.trial_ends_at, w.created_at) as trial_window_from_create,
--   age(wb.trial_ends_at, now()) as trial_remaining_from_now
-- from public.workspaces w
-- join public.workspace_billing wb on wb.workspace_id = w.id
-- order by w.created_at desc
-- limit 5;
-- -- Expected interpretation:
-- --   * Recently-created workspaces (within ~13 days):
-- --     trial_window_from_create = exactly 14 days. The greatest()
-- --     picked the natural created_at+14d path.
-- --   * Older workspaces (>13 days):
-- --     trial_remaining_from_now ≈ 24 hours. The greatest() picked
-- --     the now()+1d grace path.
-- --   * trial_window_from_create on older workspaces will be
-- --     LONGER than 14 days (because greatest pushed trial_ends_at
-- --     forward to give grace) — that's expected, NOT a bug.
--
-- VERIFY 3 — trial state distribution. Bucket workspaces by how much
-- trial time they have left, so you can eyeball the spread.
--
-- select
--   case
--     when trial_ends_at > now() + interval '7 days'  then '4_future_>7d'
--     when trial_ends_at > now() + interval '3 days'  then '3_future_3-7d'
--     when trial_ends_at > now()                      then '2_future_<3d'
--     else                                                  '1_past'
--   end as bucket,
--   count(*) as workspaces
-- from public.workspace_billing
-- where stripe_subscription_id is null
--   and subscription_status = 'trialing'
-- group by 1
-- order by 1;
-- -- Expected:
-- --   * Bucket '1_past' should be ZERO. The greatest() floor at
-- --     now()+1d guarantees trial_ends_at is in the future for every
-- --     backfilled row.
-- --   * Bucket '2_future_<3d' likely holds most older workspaces
-- --     (the now()+1d grace cohort).
-- --   * Buckets '3_future_3-7d' and '4_future_>7d' hold recent
-- --     signups whose natural 14-day window is still in flight.
--
-- VERIFY 4 — sanity: no founder rows or post-checkout rows got
-- clobbered. Distribution by (status, plan) shouldn't show any plans
-- in the 'trialing'/NULL bucket that weren't there before.
--
-- select
--   subscription_status,
--   plan,
--   count(*) as rows
-- from public.workspace_billing
-- group by subscription_status, plan
-- order by 1, 2 nulls first;
-- -- Expected:
-- --   * (trialing, NULL) — backfill + Part A trigger output.
-- --     Should be the largest bucket post-backfill.
-- --   * (trialing, solo) or (trialing, team) — pre-existing founder
-- --     manual grants and Slice 5 founding-upgrade pre-expiry rows.
-- --     Counts UNCHANGED by this backfill (ON CONFLICT DO NOTHING).
-- --   * (active, solo) / (active, team) — Slice 2/5 webhook-created
-- --     paid subscribers. Counts UNCHANGED.
-- --   * (canceled, *) — historical cancel events. Counts UNCHANGED.
-- ============================================================================
