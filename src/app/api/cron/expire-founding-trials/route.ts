import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * GET /api/cron/expire-founding-trials
 *
 * Slice 5 — Track A founding day-30 expiry cron.
 *
 * RESPONSIBILITY
 * ──────────────
 * Flips workspace_billing.subscription_status from 'trialing' → 'canceled'
 * for Track A founders whose no-card trial has passed its deadline
 * (trial_ends_at < now()). Single SQL via the
 * expire_founding_trials() SECURITY DEFINER RPC (slice 5 migration
 * 20260622120000); idempotent (rows already at canceled status don't
 * match the trialing filter).
 *
 * No email is sent — the day-28 nudge cron already gave the founder
 * their warning. Day-30 is purely state-flip + the dashboard's banner
 * (Step 6) takes over from there.
 *
 * AUTH
 * ────
 * `Authorization: Bearer ${CRON_SECRET}` — same pattern as
 * /api/cron/send-pending-emails and /api/cron/sync-seats.
 *
 * RETURN SHAPE
 * ────────────
 *   200: { expired, ran_at }
 *   401: { error: "Unauthorized" }
 *   500: { error: "<reason>" }
 *
 * `expired` is the count of rows flipped this run (zero on idle days).
 * No `scanned` field — the SQL UPDATE has the filter baked in and
 * splitting "count first, then UPDATE" would be two round-trips for no
 * real benefit.
 */

const CRON_SECRET = process.env.CRON_SECRET;

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
    console.error("[cron/expire-founding-trials] admin client failed:", msg);
    return NextResponse.json({ error: "admin_client_failed" }, { status: 500 });
  }

  // ─── Call SECURITY DEFINER RPC: trialing → canceled UPDATE ───────────
  const { data, error: rpcErr } = await admin.rpc("expire_founding_trials");
  if (rpcErr) {
    console.error(
      "[cron/expire-founding-trials] RPC failed:",
      rpcErr.message,
      "code:", rpcErr.code,
      "details:", rpcErr.details,
      "hint:", rpcErr.hint,
    );
    return NextResponse.json({ error: "rpc_failed" }, { status: 500 });
  }

  // The RPC returns integer count of rows updated.
  const expired = typeof data === "number" ? data : 0;

  if (expired > 0) {
    console.log(
      `[cron/expire-founding-trials] expired ${expired} workspace(s) ` +
        `(trialing → canceled)`,
    );
  }

  return NextResponse.json({ expired, ran_at: ranAt }, { status: 200 });
}
