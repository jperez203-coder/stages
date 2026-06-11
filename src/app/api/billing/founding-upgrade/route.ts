import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getStripe, type StagesPlanKey } from "@/lib/stripe";

/**
 * POST /api/billing/founding-upgrade
 *
 * Track A founding-member upgrade flow. Mirrors /api/billing/checkout
 * (Slice 2) for shared concerns; differs in three specific places:
 *
 *   1. Additional founding-member gate (profiles.is_founding_member=true).
 *      Non-founders are 403'd here; they belong on /api/billing/checkout.
 *
 *   2. Branches on pre-expiry vs post-expiry trial state and aligns the
 *      Stripe trial_end accordingly. Pre-expiry preserves the founder's
 *      remaining no-card trial; post-expiry charges immediately.
 *
 *   3. Attaches the STAGES_FOUNDING_LIFETIME coupon (50% off, duration:
 *      'forever') via subscription_data.discounts. Single source of truth
 *      for the discount — if we ever raise base Price amounts, founders
 *      automatically pay 50% of the new price.
 *
 * AUTHORIZATION CHAIN (in order)
 * ──────────────────────────────
 *   1. Parse body                               → 400 on malformed
 *   2. SSR session                              → 401 if missing
 *   3. Workspace owner/admin                    → 403 if not
 *   4. profiles.is_founding_member = true       → 403 if not
 *   5. workspace_billing lookup                 → 500 on read error
 *   6. Dup-block on stripe_subscription_id      → 409 if set (already
 *                                                 upgraded; route is the
 *                                                 sole writer of sub_id
 *                                                 on this code path)
 *   7. Workspace slug                           → 404 if missing
 *   8. Stripe Customer (resolve or create)      → 502 on Stripe failure
 *   9. Orphan-sub pre-flight                    → 409 if found
 *  10. Resolve Price + Coupon from env          → 500 if not configured
 *  11. Branch: pre-expiry vs post-expiry
 *  12. Build redirect URLs from request origin
 *  13. stripe.checkout.sessions.create          → 502 on Stripe failure
 *
 * STRIPE BEHAVIOR
 * ───────────────
 * Pre-expiry: Stripe creates the subscription with trial_end set to the
 *   workspace's existing trial_ends_at (Unix timestamp). No charge until
 *   then. checkout.session.completed fires → Slice 2 webhook UPSERTs the
 *   workspace_billing row with new sub_id + trial_ends_at unchanged.
 *   Stripe's own trial-end fires customer.subscription.updated with
 *   status='active' at the original deadline; row updates automatically.
 *
 * Post-expiry: Stripe creates the subscription with no trial. First
 *   invoice charges immediately at the coupon-applied price ($14.50 for
 *   Solo, $19.50 for Team). checkout.session.completed UPSERTs the row
 *   with status='active', new sub_id, trial_ends_at clobbered to null
 *   (mapped from Stripe's subscription.trial_end which is null on
 *   no-trial subs). Row state becomes identical to a normal Track B
 *   subscriber from that point.
 *
 * No webhook changes are required — handleCheckoutSessionCompleted from
 * Slice 2 already does mapStripeStatus + fromUnix conversions + UPSERT
 * on workspace_id PK. The founding metadata flag travels through but
 * isn't read by the current handler; future webhook handlers (e.g.
 * "founding-specific email at trial end") can branch on it.
 *
 * ETERNAL FOUNDING POLICY
 * ───────────────────────
 * Per locked decision Thread 3c: "once a founding member, always a
 * founding member." The is_founding_member flag never expires; the
 * coupon applies whenever the founder finally upgrades, even months
 * after their initial trial. This route honors that by being resilient
 * to workspace_billing row state: null row, canceled row, and
 * trialing-but-expired row all converge on the post-expiry branch
 * (immediate charge with coupon attached). Only an active
 * stripe_subscription_id blocks re-entry (via dup-block at gate 6).
 *
 * ORPHAN-SUB PRE-FLIGHT
 * ─────────────────────
 * Catches the rare "Slice 2 webhook failed mid-flight on a prior
 * checkout and left a Stripe subscription stranded without a local
 * workspace_billing row reflecting it" case. We stripe.subscriptions.
 * list({customer, status:'all'}), filter for metadata.workspace_id ===
 * workspace_id with active-ish status, return 409 with support hint
 * if found. Per locked decision: no auto-recovery — manual SQL sync
 * via support. Conservative to avoid cascading bugs in a route that's
 * already doing 9 other things.
 */

type FoundingUpgradeBody = {
  workspace_id: string;
  plan: StagesPlanKey;
};

function parseBody(raw: unknown): FoundingUpgradeBody | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Body must be JSON object" };
  const obj = raw as Record<string, unknown>;
  const workspace_id = obj.workspace_id;
  const plan = obj.plan;
  if (typeof workspace_id !== "string" || workspace_id.length < 8) {
    return { error: "workspace_id is required (uuid string)" };
  }
  if (plan !== "solo" && plan !== "team") {
    return { error: "plan must be 'solo' or 'team'" };
  }
  return { workspace_id, plan };
}

export async function POST(request: Request) {
  // ── 1. Parse body ────────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = parseBody(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { workspace_id, plan } = parsed;

  // ── 2. Resolve session ───────────────────────────────────────────────
  const supa = await createSupabaseServerClient();
  const { data: userResult, error: authError } = await supa.auth.getUser();
  if (authError || !userResult?.user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const user = userResult.user;
  const userId = user.id;
  const userEmail = user.email ?? null;
  if (!userEmail) {
    console.error(
      "[founding-upgrade] auth user has no email, refusing to proceed:",
      "user.id:", userId,
    );
    return NextResponse.json({ error: "no_email_on_account" }, { status: 400 });
  }

  // ── 3. Workspace owner/admin gate ────────────────────────────────────
  const { data: membership, error: memErr } = await supa
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) {
    console.error(
      "[founding-upgrade] membership lookup failed:",
      memErr?.message, "code:", memErr?.code, "details:", memErr?.details, "hint:", memErr?.hint,
    );
    return NextResponse.json({ error: "membership_check_failed" }, { status: 500 });
  }
  const role = membership?.role;
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  // ── 3a. Personal-workspace gate (WT-4 / Model C) ─────────────────────
  // Personal workspaces never need founding upgrades — they're free
  // (no Stripe subscription, no plan, no trial). Reject the entire
  // endpoint for personal targets. Matches the same shape as
  // /api/billing/checkout's personal gate.
  const { data: wsTypeRow, error: wsTypeErr } = await supa
    .from("workspaces")
    .select("type")
    .eq("id", workspace_id)
    .maybeSingle();
  if (wsTypeErr) {
    console.error(
      "[founding-upgrade] workspace type lookup failed:",
      wsTypeErr?.message, "code:", wsTypeErr?.code,
    );
    return NextResponse.json(
      { error: "workspace_type_lookup_failed" },
      { status: 500 },
    );
  }
  if (wsTypeRow?.type === "personal") {
    return NextResponse.json(
      {
        error: "billing_not_available_on_personal",
        message: "Personal workspaces do not require billing.",
      },
      { status: 403 },
    );
  }

  // ── 4. Founding-member gate (NEW vs Slice 2) ─────────────────────────
  // RLS on profiles_select lets the caller read their own row; the
  // column-level GRANT lockdown (slice 5 migration) prevents this same
  // caller from UPDATEing is_founding_member, so the SELECT is the
  // safe primary check.
  const { data: profile, error: profErr } = await supa
    .from("profiles")
    .select("is_founding_member, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (profErr) {
    console.error(
      "[founding-upgrade] profile lookup failed:",
      profErr?.message, "code:", profErr?.code, "details:", profErr?.details, "hint:", profErr?.hint,
    );
    return NextResponse.json({ error: "profile_check_failed" }, { status: 500 });
  }
  if (!profile?.is_founding_member) {
    // Non-founders belong on /api/billing/checkout. Return a clear error
    // code so the client can suggest the right path.
    return NextResponse.json(
      { error: "not_founding_member" },
      { status: 403 },
    );
  }
  const displayName = profile.display_name?.trim() || null;

  // ── 5. Workspace billing state lookup ────────────────────────────────
  // RLS on workspace_billing_select restricts to workspace owner/admin
  // — same gate we already passed at step 3. Null row is allowed (see
  // "Eternal founding policy" in docstring).
  const { data: billing, error: billErr } = await supa
    .from("workspace_billing")
    .select("subscription_status, stripe_subscription_id, trial_ends_at, plan")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (billErr) {
    console.error(
      "[founding-upgrade] billing lookup failed:",
      billErr?.message, "code:", billErr?.code,
    );
    return NextResponse.json({ error: "billing_check_failed" }, { status: 500 });
  }

  // ── 6. Dup-block ─────────────────────────────────────────────────────
  // The signal that founding-upgrade has already run for this workspace
  // is stripe_subscription_id IS NOT NULL — different from Slice 2's
  // dup-block (which keys on status). Track A founders are in
  // status='trialing' with sub_id=NULL during their no-card trial; that
  // state is the expected ENTRY point for this route, not a dup signal.
  if (billing?.stripe_subscription_id) {
    return NextResponse.json(
      {
        error: "already_subscribed",
        stripe_subscription_id: billing.stripe_subscription_id,
        status: billing.subscription_status,
      },
      { status: 409 },
    );
  }

  // ── 7. Resolve workspace slug for redirect URLs ──────────────────────
  const { data: ws, error: wsErr } = await supa
    .from("workspaces")
    .select("slug")
    .eq("id", workspace_id)
    .maybeSingle();
  if (wsErr || !ws?.slug) {
    console.error(
      "[founding-upgrade] workspace slug lookup failed:",
      wsErr?.message, "code:", wsErr?.code,
    );
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }
  const slug = ws.slug;

  // ── 8. Resolve / create Stripe Customer ──────────────────────────────
  // Same lazy pattern as Slice 2 with the same idempotencyKey
  // (`stages-customer-${userId}`) — a founder who previously hit
  // /api/billing/checkout (e.g. before the founding grant landed)
  // already has a Customer and reuses it.
  const stripe = getStripe();
  const { data: existingUserBilling, error: ubErr } = await supa
    .from("user_billing")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (ubErr) {
    console.error(
      "[founding-upgrade] user_billing lookup failed:",
      ubErr?.message, "code:", ubErr?.code,
    );
    return NextResponse.json({ error: "billing_identity_failed" }, { status: 500 });
  }
  let stripeCustomerId = existingUserBilling?.stripe_customer_id ?? null;

  if (!stripeCustomerId) {
    let created;
    try {
      created = await stripe.customers.create(
        {
          email: userEmail,
          name: displayName ?? undefined,
          metadata: { supabase_user_id: userId },
        },
        { idempotencyKey: `stages-customer-${userId}` },
      );
    } catch (e) {
      const err = e as { message?: string; type?: string; code?: string };
      console.error(
        "[founding-upgrade] Stripe customers.create failed:",
        err?.message, "type:", err?.type, "code:", err?.code,
      );
      return NextResponse.json({ error: "stripe_customer_failed" }, { status: 502 });
    }
    stripeCustomerId = created.id;
    // user_billing UPSERT happens via the webhook (Slice 2 boundary preserved).
  }

  // ── 9. Orphan-sub pre-flight ─────────────────────────────────────────
  // Catches the rare "webhook failed mid-flight last time" case.
  // Conservative path: return 409 + support hint. No auto-recovery.
  try {
    const existing = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 5,
    });
    const orphan = existing.data.find(
      (s) =>
        s.metadata?.workspace_id === workspace_id &&
        (s.status === "trialing" ||
          s.status === "active" ||
          s.status === "past_due"),
    );
    if (orphan) {
      return NextResponse.json(
        {
          error: "subscription_already_exists",
          stripe_subscription_id: orphan.id,
          status: orphan.status,
          workspace_id,
          occurred_at: new Date().toISOString(),
          support_hint:
            "Something on our side didn't finish recording your subscription " +
            "correctly the first time — it exists in Stripe but isn't reflected " +
            "in our database. This is on us to fix, not something you did. " +
            "Email support@trystages.com with this full error block (it has " +
            "the IDs and timestamp we need) and we'll reconcile your account " +
            "within one business day.",
        },
        { status: 409 },
      );
    }
  } catch (e) {
    const err = e as { message?: string; type?: string; code?: string };
    console.error(
      "[founding-upgrade] orphan-sub list failed:",
      err?.message, "type:", err?.type, "code:", err?.code,
    );
    return NextResponse.json({ error: "stripe_list_failed" }, { status: 502 });
  }

  // ── 10. Resolve Price ID + Coupon ID from env ────────────────────────
  const priceId =
    plan === "solo"
      ? process.env.STRIPE_PRICE_SOLO_MONTHLY
      : process.env.STRIPE_PRICE_TEAM_MONTHLY;
  if (!priceId) {
    console.error(
      "[founding-upgrade] Missing env var for price ID:",
      plan === "solo" ? "STRIPE_PRICE_SOLO_MONTHLY" : "STRIPE_PRICE_TEAM_MONTHLY",
    );
    return NextResponse.json({ error: "pricing_not_configured" }, { status: 500 });
  }
  const couponId = process.env.STRIPE_COUPON_FOUNDING_LIFETIME;
  if (!couponId) {
    console.error("[founding-upgrade] Missing STRIPE_COUPON_FOUNDING_LIFETIME");
    return NextResponse.json({ error: "coupon_not_configured" }, { status: 500 });
  }

  // ── 11. Branch on pre-expiry vs post-expiry ──────────────────────────
  // Resilient to null billing rows / canceled rows / expired-but-not-
  // canceled rows: only the explicit "still trialing AND deadline in the
  // future" case routes to pre-expiry. Everything else falls through to
  // post-expiry (immediate charge, no trial).
  const isPreExpiry =
    billing?.subscription_status === "trialing" &&
    billing.trial_ends_at !== null &&
    new Date(billing.trial_ends_at) > new Date();

  // ── 12. Build redirect URLs ──────────────────────────────────────────
  // origin from request headers; never from body (phishing protection).
  // ?track=founding query param lets the dashboard differentiate
  // founding success from Track B success if it ever wants to.
  const origin =
    request.headers.get("origin") ??
    new URL(request.url).origin;
  const successUrl = `${origin}/w/${encodeURIComponent(slug)}?billing=success&track=founding`;
  const cancelUrl = `${origin}/w/${encodeURIComponent(slug)}?billing=canceled&track=founding`;

  // ── 13. Create Checkout Session ──────────────────────────────────────
  // Shared metadata across Session + Subscription so the webhook can
  // identify Track A converts. Coupon attaches via subscription_data.
  // discounts — applies forever (coupon.duration='forever'), follows
  // the subscription through any future price changes.
  const sharedMetadata = {
    workspace_id,
    plan,
    supabase_user_id: userId,
    founding: "true",
    upgrade_path: isPreExpiry ? "pre_expiry" : "post_expiry",
  };

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price: priceId,
          // Quantity 1 — Slice 3 seat sync reconciles before the next
          // billing cycle. Same rationale as /api/billing/checkout.
          quantity: 1,
        },
      ],
      subscription_data: isPreExpiry
        ? {
            // Align Stripe's trial to the workspace's existing trial.
            // Same Unix timestamp; Stripe charges at that moment, not now.
            trial_end: Math.floor(
              new Date(billing!.trial_ends_at!).getTime() / 1000,
            ),
            metadata: sharedMetadata,
          }
        : {
            // No trial → Stripe charges immediately for the first month
            // at the coupon-applied price. $14.50 for Solo / $19.50 for
            // Team (50% off the $29 / $39 base prices).
            metadata: sharedMetadata,
          },
      // Coupon attaches at SESSION level (not subscription_data). In API
      // version 2026-05-27.dahlia the Stripe SDK exposes
      // `subscription_data.discounts` only on retrieve, not create —
      // discounts on Session create live at the top-level `discounts`
      // field, which flows through to the resulting subscription via
      // Stripe's Session→Subscription transition at checkout completion.
      // The coupon's `duration: 'forever'` ensures the discount follows
      // the subscription for all future invoices, including any future
      // price re-revisions on the Solo / Team Price objects.
      discounts: [{ coupon: couponId }],
      payment_method_collection: "always",
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Note: `allow_promotion_codes` is intentionally OMITTED here.
      // Stripe rejects sessions that pass both `discounts` and
      // `allow_promotion_codes` together — they're mutually exclusive
      // ("You may only specify one of these parameters"). The implicit
      // behavior is the right one anyway: when discounts is set, Stripe
      // suppresses the promo-code input on the hosted Checkout page, so
      // founders see "Founding coupon applied" cleanly without the
      // option to stack a second code. Slice 2's /api/billing/checkout
      // doesn't pass discounts, so it CAN keep allow_promotion_codes:
      // true. This route can't. Don't add it back without removing
      // discounts (which would break the founding flow).
      metadata: sharedMetadata,
    });
  } catch (e) {
    const err = e as { message?: string; type?: string; code?: string };
    console.error(
      "[founding-upgrade] Stripe checkout.sessions.create failed:",
      err?.message, "type:", err?.type, "code:", err?.code,
    );
    return NextResponse.json({ error: "stripe_checkout_failed" }, { status: 502 });
  }

  if (!session.url) {
    console.error(
      "[founding-upgrade] Stripe returned a session with no URL:",
      session.id,
    );
    return NextResponse.json({ error: "no_redirect_url" }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}
