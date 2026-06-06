import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/cron/enqueue-trackb-day12
 *
 * Slice 6 Part F — Track B day-12 nudge enqueue cron.
 *
 * RESPONSIBILITY
 * ──────────────
 * Find Track B (non-founder) trialing workspaces within 0–48h of their
 * no-card trial expiry who haven't been nudged yet, enqueue a
 * `trackb_day12` row into pending_emails for each owner, and stamp
 * workspace_billing.day12_notified_at so subsequent cron runs don't
 * re-email them.
 *
 *   * Candidate query: find_trackb_day12_candidates() RPC (Slice 6 Part F
 *     migration 20260623120200). SECURITY DEFINER; service-role only.
 *   * Email rendering: deferred to send-pending-emails cron via the
 *     pending_emails queue. This cron only ENQUEUES.
 *   * day12_notified_at stamp: set AFTER successful email enqueue. If
 *     enqueue fails, workspace stays eligible for the next cron run.
 *
 * MIRRORS /api/cron/enqueue-founding-day28 exactly. Different email
 * type, different cohort, same orchestration shape. If a future
 * refactor consolidates these two crons into one generic "trial-nudge"
 * cron, the candidate RPC dispatch would be the join point — but
 * forking now keeps each route readable end-to-end at the cost of
 * ~30 lines of duplication.
 *
 * MULTI-OWNER WORKSPACE BEHAVIOR
 * ──────────────────────────────
 * The RPC returns one row per (workspace, owner) tuple. A workspace
 * with 2 owners yields 2 rows → 2 email enqueues → 2 owner inboxes
 * nudged. The day12_notified_at stamp is ONE timestamp per workspace
 * (the table's PK is workspace_id), so subsequent cron runs skip the
 * workspace entirely. Net: each owner gets exactly one nudge in the
 * lifetime of the workspace's trial.
 *
 * PARTIAL-FAILURE BEHAVIOR
 * ────────────────────────
 * If a workspace has 2 owners and only one email enqueue succeeds:
 *   * day12_notified_at IS stamped (because at least one owner was
 *     notified) — the other owner does NOT get re-nudged on the next
 *     cron run.
 *   * Same trade-off as the day-28 founder cron: prefer under-
 *     notification over duplicate emails. Soft failure; the workspace
 *     still has at least one nudged owner.
 *
 * AUTH
 * ────
 * `Authorization: Bearer ${CRON_SECRET}` — same pattern as the day-28
 * founder cron, sync-seats, send-pending-emails.
 *
 * RETURN SHAPE
 * ────────────
 *   200: { scanned, notified, errors, stampedWorkspaces, ran_at }
 *   401: { error: 'Unauthorized' }
 *   500: { error: 'admin_client_failed' | 'rpc_failed' }
 *
 * SCHEDULING
 * ──────────
 * cron-job.org daily. See Slice 5 Step 9 hand-off for the schedule
 * configuration pattern. This route uses the same auth secret as
 * existing crons so no new env vars needed.
 */

const CRON_SECRET = process.env.CRON_SECRET;

type CandidateRow = {
  workspace_id: string;
  trial_ends_at: string;
  workspace_slug: string;
  workspace_name: string;
  owner_user_id: string;
  owner_email: string;
  owner_display_name: string | null;
};

export async function GET(request: Request) {
  // ─── Auth gate ───────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ranAt = new Date().toISOString();
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[cron/enqueue-trackb-day12] admin client failed:", msg);
    return NextResponse.json({ error: "admin_client_failed" }, { status: 500 });
  }

  // ─── Fetch candidates via SECURITY DEFINER RPC ───────────────────────
  const { data: candidatesData, error: rpcErr } = await admin.rpc(
    "find_trackb_day12_candidates",
  );
  if (rpcErr) {
    console.error(
      "[cron/enqueue-trackb-day12] RPC failed:",
      rpcErr.message,
      "code:", rpcErr.code,
      "details:", rpcErr.details,
      "hint:", rpcErr.hint,
    );
    return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
  }

  const candidates = (candidatesData ?? []) as CandidateRow[];
  let notified = 0;
  let errors = 0;
  // Track which workspaces had at least one successful enqueue. The
  // day12_notified_at stamp is one per workspace, so we dedup via Set.
  const stampWorkspaces = new Set<string>();

  for (const row of candidates) {
    // ── Enqueue email FIRST ─────────────────────────────────────────
    const insertRes = await admin.from("pending_emails").insert({
      email_type: "trackb_day12",
      recipient: row.owner_email,
      recipient_name: row.owner_display_name,
      payload: {
        workspace_id: row.workspace_id,
        workspace_slug: row.workspace_slug,
        workspace_name: row.workspace_name,
        trial_ends_at: row.trial_ends_at,
      },
      // Send ASAP. The send-pending-emails cron runs every few minutes;
      // a row enqueued here will go out on the very next sweep.
      send_after: new Date().toISOString(),
    });

    if (insertRes.error) {
      console.error(
        `[cron/enqueue-trackb-day12] pending_emails insert failed for ` +
          `workspace=${row.workspace_id} owner=${row.owner_user_id}:`,
        insertRes.error.message,
        "code:", insertRes.error.code,
      );
      errors++;
      continue;
    }

    notified++;
    stampWorkspaces.add(row.workspace_id);
  }

  // ─── Stamp day12_notified_at on each successfully-enqueued workspace ──
  let stampedWorkspaces = 0;
  for (const wsId of stampWorkspaces) {
    const updRes = await admin
      .from("workspace_billing")
      .update({ day12_notified_at: ranAt })
      .eq("workspace_id", wsId);
    if (updRes.error) {
      console.error(
        `[cron/enqueue-trackb-day12] day12_notified_at UPDATE failed for ` +
          `workspace=${wsId}:`,
        updRes.error.message,
        "code:", updRes.error.code,
      );
      errors++;
      // Note: row stays eligible for next cron run if the stamp fails.
      // The owner MIGHT get a second nudge — but only if both this cron
      // and the next stamp-fail-but-send-success window aligns.
      // Acceptable.
    } else {
      stampedWorkspaces++;
    }
  }

  return NextResponse.json(
    {
      scanned: candidates.length,
      notified,
      stampedWorkspaces,
      errors,
      ran_at: ranAt,
    },
    { status: 200 },
  );
}
