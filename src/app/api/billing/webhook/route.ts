import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, type StripeSubscriptionStatus } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook endpoint. Signature-verified. Service-role writes to
 * billing tables. Idempotent via stripe_events dedup table (slice 2
 * migration 20260619120000).
 *
 * EVENTS HANDLED
 * ──────────────
 *   checkout.session.completed       — INSERT both billing rows
 *   customer.subscription.updated    — UPDATE workspace_billing
 *   customer.subscription.deleted    — UPDATE status='canceled'
 *   invoice.payment_succeeded        — UPDATE current_period_end
 *   invoice.payment_failed           — UPDATE status='past_due'
 * Any other event type is ack'd with 200 (so Stripe stops retrying)
 * and logged for visibility.
 *
 * DEDUP FLOW
 * ──────────
 *   1. Verify signature.            (fail → 400)
 *   2. UPSERT stripe_events { event_id, event_type, payload }
 *      with ignoreDuplicates. RETURNING data tells us if it was a
 *      fresh INSERT (1 row) vs a re-delivery (empty array).
 *   3. If re-delivery: SELECT processed_successfully.
 *        true  → return 200 { dedup: 'already_processed' }
 *        false → proceed to handler (Stripe retry of a prior failure)
 *   4. Run the type-specific handler.
 *   5. On success: UPDATE processed_successfully=true → 200.
 *      On error:   return 500 (Stripe retries; next try sees
 *                  processed=false and re-runs).
 *
 * Why not just UPSERT-and-process every time? Because some future
 * handler we add MIGHT not be idempotent (sending an email, posting
 * to a third party, etc.). Treating the dedup table as the source of
 * truth for "have we successfully processed this event?" lets every
 * new handler we write be naturally idempotent without thinking
 * about it.
 *
 * SECURITY POSTURE
 * ────────────────
 * Service-role DB writes throughout — see src/lib/supabase-admin.ts
 * for the warning block. This route is the canonical authorized
 * caller of the admin client. Signature verification is the ONLY
 * authentication gate; anything that survives constructEvent() is
 * trusted as a real Stripe event.
 */

// Disable Next.js's body parser by reading the raw body via
// request.text(). Stripe's signature verification requires byte-exact
// raw bytes — JSON.stringify(parsedBody) would not match.
export const runtime = "nodejs";
// Force this route off the static / cached pre-render paths. App Router
// route handlers ARE dynamic by default, but explicit > implicit for
// something this security-sensitive.
export const dynamic = "force-dynamic";

// ── Status mapping ──────────────────────────────────────────────────────
//
// Our workspace_billing.subscription_status allowlist (slice 1):
//   incomplete, trialing, active, past_due, canceled, unpaid, paused
// Stripe's Subscription.Status enum is a superset of ours; the one
// extra value is 'incomplete_expired' (terminal failure of the initial
// payment-method setup — subscription effectively never lived). Map
// that to 'canceled' since the practical outcome is the same.
function mapStripeStatus(s: Stripe.Subscription.Status): StripeSubscriptionStatus {
  if (s === "incomplete_expired") return "canceled";
  // The remaining 7 Stripe statuses match our 7 allowlist entries
  // 1:1. TypeScript can't narrow this without an exhaustive switch,
  // so we cast — runtime safety is the CHECK constraint on the DB
  // column, which will reject any value drift.
  return s as StripeSubscriptionStatus;
}

function fromUnix(t: number | null | undefined): string | null {
  if (t == null) return null;
  return new Date(t * 1000).toISOString();
}

// ── Event handlers ──────────────────────────────────────────────────────

async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
  stripe: Stripe,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const meta = session.metadata ?? {};
  const workspace_id = meta.workspace_id;
  const supabase_user_id = meta.supabase_user_id;
  const plan = meta.plan;
  if (!workspace_id || !supabase_user_id || (plan !== "solo" && plan !== "team")) {
    throw new Error(
      `checkout.session.completed missing/invalid metadata: ${JSON.stringify(meta)}`,
    );
  }
  // Customer is always a string ID in subscription-mode sessions.
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!customerId) throw new Error("checkout.session.completed has no customer");
  if (!subscriptionId) {
    throw new Error("checkout.session.completed (mode=subscription) has no subscription");
  }

  // Retrieve subscription to read fresh status / trial_end /
  // items[0].current_period_end. The session object alone doesn't
  // carry the period_end (which lives on the subscription item in
  // API version 2026-05-27.dahlia).
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const firstItem = subscription.items.data[0];
  if (!firstItem) {
    throw new Error(`subscription ${subscriptionId} has no items`);
  }

  const admin = getSupabaseAdmin();

  // UPSERT user_billing — onConflict user_id so re-running is safe.
  const ub = await admin
    .from("user_billing")
    .upsert(
      { user_id: supabase_user_id, stripe_customer_id: customerId },
      { onConflict: "user_id" },
    );
  if (ub.error) {
    throw new Error(`user_billing upsert failed: ${ub.error.message}`);
  }

  // UPSERT workspace_billing — onConflict workspace_id so re-subscribe
  // after cancel REPLACES the row's stripe_subscription_id + status.
  const wb = await admin
    .from("workspace_billing")
    .upsert(
      {
        workspace_id,
        stripe_subscription_id: subscriptionId,
        subscription_status: mapStripeStatus(subscription.status),
        plan,
        trial_ends_at: fromUnix(subscription.trial_end),
        current_period_end: fromUnix(firstItem.current_period_end),
      },
      { onConflict: "workspace_id" },
    );
  if (wb.error) {
    throw new Error(`workspace_billing upsert failed: ${wb.error.message}`);
  }
}

async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const firstItem = subscription.items.data[0];
  if (!firstItem) {
    // Defensive — every real subscription has at least one item, but if
    // Stripe somehow sends an empty one, skip cleanly.
    console.warn(
      `[webhook] customer.subscription.updated ${subscription.id} has no items, skipping`,
    );
    return;
  }
  const admin = getSupabaseAdmin();
  const upd = await admin
    .from("workspace_billing")
    .update({
      subscription_status: mapStripeStatus(subscription.status),
      trial_ends_at: fromUnix(subscription.trial_end),
      current_period_end: fromUnix(firstItem.current_period_end),
    })
    .eq("stripe_subscription_id", subscription.id)
    .select();
  if (upd.error) {
    throw new Error(`workspace_billing update failed: ${upd.error.message}`);
  }
  if ((upd.data?.length ?? 0) === 0) {
    // Out-of-order: subscription.updated arrived before
    // checkout.session.completed. The row doesn't exist yet; the
    // upcoming completed event will populate it from the same fresh
    // subscription state. Log + 200, no-op.
    console.warn(
      `[webhook] subscription.updated for ${subscription.id} — no matching workspace_billing row; ignoring (likely pre-checkout race)`,
    );
  }
}

async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const firstItem = subscription.items.data[0];
  const admin = getSupabaseAdmin();
  const upd = await admin
    .from("workspace_billing")
    .update({
      subscription_status: "canceled",
      // Preserve trial_ends_at for history. Update current_period_end
      // to the final period's end so downstream UI can show "access
      // until X" without re-querying Stripe.
      current_period_end: firstItem ? fromUnix(firstItem.current_period_end) : null,
    })
    .eq("stripe_subscription_id", subscription.id)
    .select();
  if (upd.error) {
    throw new Error(`workspace_billing cancel update failed: ${upd.error.message}`);
  }
  if ((upd.data?.length ?? 0) === 0) {
    console.warn(
      `[webhook] subscription.deleted for ${subscription.id} — no matching workspace_billing row; ignoring`,
    );
  }
}

async function handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  // An invoice may or may not be tied to a subscription. We only care
  // about subscription invoices for billing-mirror purposes. Standalone
  // (one-off) invoices we may charge for in the future fall through.
  // The Stripe API exposes the subscription ID via lines.data[0].subscription
  // in recent API versions; `invoice.subscription` shape varies. Read defensively.
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) {
    console.warn(
      `[webhook] invoice.payment_succeeded ${invoice.id} has no subscription — skipping`,
    );
    return;
  }

  // For period roll-forward: the most authoritative current_period_end
  // lives on the subscription itself. Retrieve it fresh.
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const firstItem = subscription.items.data[0];
  if (!firstItem) return;

  const admin = getSupabaseAdmin();
  const upd = await admin
    .from("workspace_billing")
    .update({
      current_period_end: fromUnix(firstItem.current_period_end),
      // Status flips to 'active' on first successful charge after trial.
      // Re-read from the subscription to be precise.
      subscription_status: mapStripeStatus(subscription.status),
    })
    .eq("stripe_subscription_id", subscriptionId)
    .select();
  if (upd.error) {
    throw new Error(`workspace_billing roll-forward failed: ${upd.error.message}`);
  }
  if ((upd.data?.length ?? 0) === 0) {
    console.warn(
      `[webhook] invoice.payment_succeeded for sub ${subscriptionId} — no matching workspace_billing row; ignoring`,
    );
  }
}

async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = extractSubscriptionId(invoice);
  if (!subscriptionId) {
    console.warn(
      `[webhook] invoice.payment_failed ${invoice.id} has no subscription — skipping`,
    );
    return;
  }
  const admin = getSupabaseAdmin();
  const upd = await admin
    .from("workspace_billing")
    .update({ subscription_status: "past_due" })
    .eq("stripe_subscription_id", subscriptionId)
    .select();
  if (upd.error) {
    throw new Error(`workspace_billing past_due update failed: ${upd.error.message}`);
  }
  if ((upd.data?.length ?? 0) === 0) {
    console.warn(
      `[webhook] invoice.payment_failed for sub ${subscriptionId} — no matching workspace_billing row; ignoring`,
    );
  }
}

// Defensive subscription-id extraction for Invoice objects. Across
// Stripe API versions, `invoice.subscription` (string | Subscription)
// has been deprecated in favor of `invoice.parent.subscription_details.subscription`
// and/or `invoice.lines.data[i].subscription`. Try both, in priority
// order, to be robust to whichever shape this API version yields.
function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  // Newer shape: parent.subscription_details.subscription
  // (Stripe.Invoice.Parent.SubscriptionDetails since 2024+ APIs).
  const parent = (invoice as unknown as { parent?: { subscription_details?: { subscription?: string | { id: string } } } }).parent;
  const sd = parent?.subscription_details?.subscription;
  if (typeof sd === "string") return sd;
  if (sd && typeof sd === "object" && "id" in sd) return sd.id;

  // Legacy shape kept around in some API versions: invoice.subscription.
  const legacy = (invoice as unknown as { subscription?: string | { id: string } | null }).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) return legacy.id;

  // Fallback: lines.data[i].subscription (or parent.subscription_item_details.subscription).
  for (const line of invoice.lines?.data ?? []) {
    const lineParent = (line as unknown as { parent?: { subscription_item_details?: { subscription?: string | { id: string } } } }).parent;
    const ls = lineParent?.subscription_item_details?.subscription;
    if (typeof ls === "string") return ls;
    if (ls && typeof ls === "object" && "id" in ls) return ls.id;
    const lineLegacy = (line as unknown as { subscription?: string | { id: string } | null }).subscription;
    if (typeof lineLegacy === "string") return lineLegacy;
    if (lineLegacy && typeof lineLegacy === "object" && "id" in lineLegacy) return lineLegacy.id;
  }

  return null;
}

// ── Route entrypoint ────────────────────────────────────────────────────

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(
      "[webhook] STRIPE_WEBHOOK_SECRET not set — refusing to process events.",
    );
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 },
    );
  }

  // Stripe needs the RAW request body for signature verification.
  // Reading via .text() gives us bytes Stripe signed; .json() would
  // round-trip through a JS object and break byte-equality.
  const rawBody = await request.text();
  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e) {
    const err = e as { message?: string };
    console.error(
      "[webhook] signature verification FAILED:",
      err?.message,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // ── Dedup INSERT ───────────────────────────────────────────────────
  const admin = getSupabaseAdmin();
  const dedup = await admin
    .from("stripe_events")
    .upsert(
      {
        event_id: event.id,
        event_type: event.type,
        payload: event as unknown as Record<string, unknown>,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select();
  if (dedup.error) {
    console.error(
      "[webhook] stripe_events upsert failed:",
      dedup.error.message,
      "code:", dedup.error.code,
    );
    return NextResponse.json({ error: "Dedup write failed" }, { status: 500 });
  }
  const isFresh = (dedup.data?.length ?? 0) > 0;

  if (!isFresh) {
    // Re-delivery. Check whether the prior attempt succeeded.
    const { data: existing, error: selectErr } = await admin
      .from("stripe_events")
      .select("processed_successfully")
      .eq("event_id", event.id)
      .maybeSingle();
    if (selectErr) {
      console.error(
        "[webhook] stripe_events read-back failed:",
        selectErr.message,
      );
      return NextResponse.json({ error: "Dedup read-back failed" }, { status: 500 });
    }
    if (existing?.processed_successfully) {
      return NextResponse.json({ dedup: "already_processed" }, { status: 200 });
    }
    // Otherwise fall through — re-run the handler. Stripe is retrying a
    // prior failed attempt.
  }

  // ── Run handler ────────────────────────────────────────────────────
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event, stripe);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;
      default:
        // Acknowledge so Stripe stops retrying. Logged for visibility.
        // If we ever subscribe to more event types in the Stripe
        // Dashboard, this branch keeps us safe from unhandled-event
        // 500s during the gap before the handler ships.
        console.log(
          `[webhook] unhandled event type ${event.type} — acknowledging without action`,
        );
        // Mark processed so retries don't waste cycles.
        await admin
          .from("stripe_events")
          .update({ processed_successfully: true })
          .eq("event_id", event.id);
        return NextResponse.json({ received: true, unhandled: event.type }, { status: 200 });
    }
  } catch (e) {
    const err = e as { message?: string };
    console.error(
      `[webhook] handler for ${event.type} threw:`,
      err?.message,
    );
    // Don't flip processed_successfully — leave it false so the row is
    // discoverable via stripe_events_unprocessed_idx for support.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  // ── Mark processed ─────────────────────────────────────────────────
  const proc = await admin
    .from("stripe_events")
    .update({ processed_successfully: true })
    .eq("event_id", event.id);
  if (proc.error) {
    // The work is already done; the audit flag failing to flip is a
    // minor data-integrity issue, not a Stripe-retry trigger. Log + 200.
    console.error(
      "[webhook] failed to mark processed_successfully:",
      proc.error.message,
    );
  }

  return NextResponse.json({ received: true, type: event.type }, { status: 200 });
}
