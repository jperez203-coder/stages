import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/cron/enqueue-founding-day28
 *
 * Slice 5 — Track A founding day-28 nudge enqueue cron.
 *
 * RESPONSIBILITY
 * ──────────────
 * Find Track A founders within 0–72h of their no-card trial expiry who
 * haven't been nudged yet, enqueue a `founding_day28` row into
 * pending_emails for each one, and stamp workspace_billing.
 * day28_notified_at so subsequent cron runs don't re-email them.
 *
 *   * Candidate query: find_founding_day28_candidates() RPC (slice 5
 *     migration 20260622120000). SECURITY DEFINER; service-role only.
 *   * Email rendering: deferred to send-pending-emails cron via the
 *     pending_emails queue. This cron only ENQUEUES.
 *   * day28_notified_at stamp: set AFTER successful email enqueue. If
 *     enqueue fails, workspace stays eligible for the next cron run.
 *
 * MULTI-OWNER WORKSPACE BEHAVIOR
 * ──────────────────────────────
 * The RPC returns one row per (workspace, owner) tuple. A workspace
 * with 2 owners yields 2 rows → 2 email enqueues → 2 founder inboxes
 * nudged. The day28_notified_at stamp is ONE timestamp per workspace
 * (the table's PK is workspace_id), so subsequent cron runs skip the
 * workspace entirely. Net: each owner gets exactly one nudge in the
 * lifetime of the workspace's trial.
 *
 * PARTIAL-FAILURE BEHAVIOR
 * ────────────────────────
 * If a workspace has 2 owners and only one email enqueue succeeds:
 *   * day28_notified_at IS stamped (because at least one owner was
 *     notified) — the other owner does NOT get re-nudged on the next
 *     cron run.
 *   * Trade-off: minor under-notification vs. duplicate emails on
 *     retry. We prefer under-notification because duplicate emails are
 *     bad UX and the missed second-owner's inbox is a soft failure
 *     (the workspace still has at least one nudged owner).
 *
 * AUTH
 * ────
 * `Authorization: Bearer ${CRON_SECRET}` — same pattern as
 * /api/cron/send-pending-emails and /api/cron/sync-seats.
 *
 * RETURN SHAPE
 * ────────────
 *   200: { scanned, notified, errors, stampedWorkspaces, ran_at }
 *   401: { error: "Unauthorized" }
 *   500: { error: "<reason>" }
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
    console.error("[cron/enqueue-founding-day28] admin client failed:", msg);
    return NextResponse.json({ error: "admin_client_failed" }, { status: 500 });
  }

  // ─── Fetch candidates via SECURITY DEFINER RPC ───────────────────────
  const { data: candidatesData, error: rpcErr } = await admin.rpc(
    "find_founding_day28_candidates",
  );
  if (rpcErr) {
    console.error(
      "[cron/enqueue-founding-day28] RPC failed:",
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
  // day28_notified_at stamp is one per workspace, so we dedup via Set.
  const stampWorkspaces = new Set<string>();

  for (const row of candidates) {
    // ── Enqueue email FIRST ─────────────────────────────────────────
    const insertRes = await admin.from("pending_emails").insert({
      email_type: "founding_day28",
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
        `[cron/enqueue-founding-day28] pending_emails insert failed for ` +
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

  // ─── Stamp day28_notified_at on each successfully-enqueued workspace ──
  let stampedWorkspaces = 0;
  for (const wsId of stampWorkspaces) {
    const updRes = await admin
      .from("workspace_billing")
      .update({ day28_notified_at: ranAt })
      .eq("workspace_id", wsId);
    if (updRes.error) {
      console.error(
        `[cron/enqueue-founding-day28] day28_notified_at UPDATE failed for ` +
          `workspace=${wsId}:`,
        updRes.error.message,
        "code:", updRes.error.code,
      );
      errors++;
      // Note: row stays eligible for next cron run if the stamp fails.
      // That means the founder MIGHT get a second nudge — but only if
      // both this cron and the subsequent send-pending-emails cron's
      // stamp-fail-but-send-success window aligns. Acceptable.
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
