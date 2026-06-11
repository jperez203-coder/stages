import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { computeAgencySeatCount } from "@/lib/seat-count";

/**
 * GET /api/cron/sync-seats
 *
 * Slice 3 — daily seat sync cron. Reconciles agency-seat count to Stripe
 * Subscription Item quantity for every workspace with an active-ish
 * subscription. Architecture: cron-only (Option A from the slice 3 plan).
 *
 *   * Up to 24h drift between membership change and Stripe quantity.
 *   * Fits inside Track B's 14-day trial buffer — drift can at worst
 *     extend the trial by 23h of free seats; never affects first-month
 *     accuracy.
 *   * Leaves the door open for a reactive pg_net trigger (Option B/C)
 *     later without restructuring the audit table or this route.
 *
 * AUTH
 * ────
 * `Authorization: Bearer <CRON_SECRET>`. Matches the existing
 * /api/cron/send-pending-emails pattern; the same external scheduler
 * (cron-job.org per the 2026-05-28 Hobby-plan workaround) drives both.
 *
 * IDEMPOTENCY
 * ───────────
 * Stripe's subscriptionItems.update with the same quantity is a no-op
 * (logged as `status='no_change'` here). So re-running the cron is
 * safe — every loop iteration converges to the correct quantity.
 *
 * AUDIT
 * ─────
 * Every workspace scan writes a row to `seat_sync_log`. Four statuses:
 *   * synced     — quantity differed, Stripe updated successfully
 *   * no_change  — quantity already correct
 *   * skipped    — workspace_billing has no stripe_subscription_id yet
 *                  (e.g. Track A founders in pre-card trial state); not
 *                  an error, just nothing to sync
 *   * error      — computation or Stripe call failed; error_message set
 *
 * `seat_sync_log` queries surface via the indexes added in
 * 20260620120000_seat_sync_log.sql — workspace_id history + an errors-
 * only partial index for monitoring.
 *
 * SCALING NOTE
 * ────────────
 * Serial loop over workspaces. With Vercel Hobby's 60s function timeout,
 * this caps around ~50-60 workspaces per run before timeout risk (one
 * Stripe API call + one helper call + one DB insert ≈ 1s per workspace).
 * If we cross that threshold pre-launch, parallelize with a bounded
 * `Promise.allSettled` over slices — simple refactor here that doesn't
 * change the schema or audit shape.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SyncStatus = "synced" | "no_change" | "skipped" | "error";

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("Authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const stripe = getStripe();

  // ── Fetch all billing-active workspaces ───────────────────────────────
  // 'past_due' included because seats may have shifted on a workspace
  // that's in dunning; Stripe will retry the failed invoice and the
  // updated quantity should be in place when it does.
  const { data: rows, error: fetchErr } = await admin
    .from("workspace_billing")
    .select("workspace_id, stripe_subscription_id, subscription_status, plan")
    .in("subscription_status", ["trialing", "active", "past_due"]);

  if (fetchErr) {
    console.error(
      "[cron/sync-seats] workspace_billing fetch failed:",
      fetchErr.message,
      "code:", fetchErr.code,
    );
    return NextResponse.json(
      { error: "Billing-active workspaces fetch failed" },
      { status: 500 },
    );
  }

  // WT-4: pre-fetch workspace types so personal workspaces are skipped
  // explicitly in the loop. Post-WT-4 personal workspaces don't get
  // workspace_billing rows so they shouldn't appear in `rows` at all,
  // but the defensive skip covers (a) pre-migration data not yet cleaned
  // up, (b) future drift if the trigger body diverges from this route's
  // assumption, and (c) any out-of-band billing-row creation. Single
  // batch query keyed on the workspace_ids already in scope; constant
  // overhead regardless of row count.
  const workspaceIds = (rows ?? []).map((r) => r.workspace_id);
  const typeMap = new Map<string, string>();
  if (workspaceIds.length > 0) {
    const { data: typeRows, error: typeErr } = await admin
      .from("workspaces")
      .select("id, type")
      .in("id", workspaceIds);
    if (typeErr) {
      console.error(
        "[cron/sync-seats] workspace type lookup failed:",
        typeErr.message,
        "code:", typeErr.code,
      );
      return NextResponse.json(
        { error: "Workspace type lookup failed" },
        { status: 500 },
      );
    }
    for (const r of typeRows ?? []) {
      typeMap.set(r.id as string, r.type as string);
    }
  }

  const summary: Record<SyncStatus | "scanned", number> = {
    scanned: 0,
    synced: 0,
    no_change: 0,
    skipped: 0,
    error: 0,
  };

  // ── Per-workspace sync (serial; see SCALING NOTE in docstring) ───────
  for (const row of rows ?? []) {
    // WT-4: skip personal workspaces. Model C — they have no Stripe
    // subscription to reconcile against. Debug log preserves
    // observability ("how many personal workspaces snuck into the
    // billing table?") without writing seat_sync_log rows for them
    // (those rows are for billing-managed workspaces only).
    const wsType = typeMap.get(row.workspace_id) ?? "agency";
    if (wsType === "personal") {
      console.log(
        `[cron/sync-seats] Skipping personal workspace ${row.workspace_id}`,
      );
      continue;
    }

    summary.scanned++;

    let computedSeats = 0;
    let fromQty: number | null = null;
    let status: SyncStatus = "error"; // default until proven otherwise
    let errorMessage: string | null = null;

    try {
      // Always compute local seat count first — even for 'skipped' rows,
      // so the audit log records what the workspace's actual seat count
      // was at the time. Useful for "when did founder X cross 5 seats?"
      // queries later.
      computedSeats = await computeAgencySeatCount(row.workspace_id);

      if (!row.stripe_subscription_id) {
        // No Stripe subscription yet — Track A founders in pre-card
        // trial, or any other edge case. Not an error; just nothing
        // to sync upstream. Log and move on.
        status = "skipped";
      } else {
        // Fetch the live Stripe subscription to compare quantities.
        const sub = await stripe.subscriptions.retrieve(
          row.stripe_subscription_id,
        );
        const firstItem = sub.items.data[0];
        if (!firstItem) {
          throw new Error(
            `subscription ${row.stripe_subscription_id} has no items`,
          );
        }
        // Stripe quantity can be null in rare edge cases (metered usage
        // subscriptions, etc.); we treat null as 0 for comparison.
        fromQty = firstItem.quantity ?? 0;

        if (fromQty === computedSeats) {
          status = "no_change";
        } else {
          await stripe.subscriptionItems.update(firstItem.id, {
            quantity: computedSeats,
          });
          status = "synced";
        }
      }
    } catch (e) {
      const err = e as { message?: string; type?: string; code?: string };
      errorMessage = err?.message ?? String(e);
      console.error(
        `[cron/sync-seats] workspace ${row.workspace_id} sync failed:`,
        errorMessage,
        "type:", err?.type ?? "—",
        "code:", err?.code ?? "—",
      );
      status = "error";
    }

    summary[status]++;

    // Audit insert. We don't await this in a transaction with the Stripe
    // call — if the Stripe update succeeds but the audit insert fails,
    // we have a small consistency gap, but the next cron run will read
    // the (correct, synced) Stripe state and log a 'no_change' row.
    // Acceptable; the audit is a best-effort observability tool, not
    // the source of truth.
    const auditRes = await admin.from("seat_sync_log").insert({
      workspace_id: row.workspace_id,
      stripe_subscription_id: row.stripe_subscription_id ?? null,
      to_qty: computedSeats,
      from_qty: fromQty,
      status,
      error_message: errorMessage,
    });
    if (auditRes.error) {
      console.error(
        `[cron/sync-seats] audit insert failed for workspace ${row.workspace_id}:`,
        auditRes.error.message,
      );
      // Don't fail the cron run on audit insert error — the sync itself
      // succeeded (if status was 'synced'). Next cron picks up state.
    }
  }

  return NextResponse.json(
    {
      summary,
      ran_at: new Date().toISOString(),
    },
    { status: 200 },
  );
}
