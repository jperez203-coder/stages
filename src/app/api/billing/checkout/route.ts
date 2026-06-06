import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getStripe, type StagesPlanKey } from "@/lib/stripe";

/**
 * POST /api/billing/checkout
 *
 * Slice 2 of Stripe Track B. Creates a Stripe Checkout Session for a
 * 14-day trial of Solo or Team plan on a specific workspace. Returns
 * the Checkout URL; the client redirects via window.location.
 *
 * AUTHORIZATION
 * ─────────────
 * 1. Caller must be signed in (SSR cookie auth via supabase-server).
 * 2. Caller must have workspace_memberships.role IN ('owner','admin')
 *    for the target workspace. Members + clients are 403'd — same
 *    rule that gates workspace_billing SELECT in RLS (slice 1).
 * 3. Workspace must NOT already have an active-ish subscription. The
 *    explicit dup-block returns 409 when subscription_status is in
 *    ('trialing','active','past_due'). NULL (no row) or 'canceled'
 *    proceeds.
 *
 * STRIPE CUSTOMER LIFECYCLE
 * ─────────────────────────
 * Per locked decision (slice 1, Option C): customers are created
 * LAZILY at first paid action. This route is "first paid action."
 *   * Read user_billing.stripe_customer_id for auth.uid() (RLS-allowed).
 *   * If present: reuse.
 *   * If missing: stripe.customers.create({...}) with an idempotency
 *     key derived from userId, then pass customer.id into the Checkout
 *     Session. The user_billing row itself is NOT written here — the
 *     checkout.session.completed webhook handler is the SOLE writer of
 *     billing tables. That keeps src/lib/supabase-admin.ts strictly
 *     bounded to system-write contexts (no user-facing route imports).
 *
 * ORPHAN CUSTOMER WINDOW
 * ──────────────────────
 * Because the user_billing row is only written by the webhook, a user
 * who creates a Stripe Customer here but bails out at the Checkout
 * Session step leaves an orphan Customer in Stripe with no
 * corresponding row. The Stripe idempotency_key (24h window) collapses
 * parallel + retry-within-24h races to the SAME Customer. Beyond 24h,
 * a fresh retry could mint a new Customer; the earlier one persists in
 * Stripe with no billing impact.
 *
 * For slice 2 this is acceptable — orphans are cheap to clean up in
 * Stripe Dashboard, and a one-off `stripe.customers.search({...})`
 * pre-check could tighten this later (slice 4 polish if support
 * volume warrants).
 *
 * SESSION METADATA
 * ────────────────
 * Both the Checkout Session AND the Subscription it creates carry
 * { workspace_id, plan, supabase_user_id } in metadata. The
 * checkout.session.completed webhook reads from session.metadata;
 * future subscription.* events read from subscription.metadata.
 * Setting it in two places is intentional — Stripe doesn't merge
 * subscription_data.metadata onto the session itself.
 *
 * TRIAL CONFIG
 * ────────────
 *   subscription_data.trial_period_days: 14
 *   payment_method_collection: 'always'   (card REQUIRED at signup)
 * Track B is "free trial WITH card on file"; the always-collection
 * is the one Stripe knob that enforces this in Checkout.
 *
 * SEAT QUANTITY
 * ─────────────
 * line_items[0].quantity = 1 for now. Slice 3's seat-sync flow will
 * reconcile this to the actual agency-seat count before the first
 * paid invoice (~14 days out). Trial is free regardless of quantity
 * so this has zero billing impact today. See PROGRESS.md / CLAUDE.md
 * "Pricing-driven gates" section for the seat-counting query that
 * Slice 3 will use.
 */

type CheckoutBody = {
  workspace_id: string;
  plan: StagesPlanKey;
};

function parseBody(raw: unknown): CheckoutBody | { error: string } {
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = userResult.user;
  const userId = user.id;
  const userEmail = user.email ?? null;
  if (!userEmail) {
    // Edge case: an auth user with no email is suspect and would break
    // Stripe Customer creation downstream. 400 + log.
    console.error(
      "[billing/checkout] auth user has no email, refusing to proceed:",
      "user.id:", userId,
    );
    return NextResponse.json({ error: "Account has no email on file" }, { status: 400 });
  }

  // ── 3. Authorize: caller must be workspace owner/admin ───────────────
  const { data: membership, error: memErr } = await supa
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) {
    console.error(
      "[billing/checkout] membership lookup failed:",
      memErr?.message, "code:", memErr?.code, "details:", memErr?.details, "hint:", memErr?.hint,
    );
    return NextResponse.json({ error: "Membership lookup failed" }, { status: 500 });
  }
  const role = membership?.role;
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json(
      { error: "Only workspace owners or admins can start a subscription" },
      { status: 403 },
    );
  }

  // ── 4. Dup-block + Slice 6 trial-state read ──────────────────────────
  // RLS lets owners/admins SELECT this row (slice 1 policy).
  //
  // Slice 6 (commit fcea5d3) added an AFTER INSERT trigger on
  // public.workspaces that auto-creates workspace_billing with
  // subscription_status='trialing', stripe_subscription_id=NULL,
  // trial_ends_at = created_at + 14 days. EVERY workspace now has a
  // 'trialing' row from day 1 — so the pre-Slice-6 dup-block (which
  // 409'd any status IN ('trialing','active','past_due')) would 409
  // every legitimate Track B checkout attempt.
  //
  // The Slice 6 fix: 409 only when there's actually a Stripe sub
  // already managing things (stripe_subscription_id IS NOT NULL).
  // status='trialing' WITHOUT a Stripe sub is the normal entry state.
  //
  // Three columns now needed: subscription_status (for the dup-block
  // branch), stripe_subscription_id (the "is there already a Stripe
  // sub?" signal), and trial_ends_at (Slice 6 Bug 2 fix at step 9 below
  // aligns Stripe's trial_end to this existing deadline so the user
  // doesn't get a fresh 14-day extension on top of their already-
  // running trial).
  const { data: existingBilling, error: billErr } = await supa
    .from("workspace_billing")
    .select("subscription_status, stripe_subscription_id, trial_ends_at")
    .eq("workspace_id", workspace_id)
    .maybeSingle();
  if (billErr) {
    console.error(
      "[billing/checkout] billing lookup failed:",
      billErr?.message, "code:", billErr?.code, "details:", billErr?.details, "hint:", billErr?.hint,
    );
    return NextResponse.json({ error: "Billing lookup failed" }, { status: 500 });
  }
  const currentStatus = existingBilling?.subscription_status ?? null;
  const existingSubId = existingBilling?.stripe_subscription_id ?? null;
  const existingTrialEndsAt = existingBilling?.trial_ends_at ?? null;

  // Genuine dup signal: a Stripe subscription already exists for this
  // workspace. Slice 6 'trialing' rows with sub_id=NULL are NOT dups —
  // they're the legitimate starting state for the checkout flow. The
  // asymmetric check on 'trialing' matches Slice 5's
  // /api/billing/founding-upgrade dup-block at gate 6 — same canonical
  // marker for "Stripe-managed sub already in flight."
  if (
    currentStatus === "active" ||
    currentStatus === "past_due" ||
    (currentStatus === "trialing" && existingSubId !== null)
  ) {
    return NextResponse.json(
      {
        error: "This workspace already has an active subscription",
        status: currentStatus,
      },
      { status: 409 },
    );
  }

  // ── 5. Resolve workspace slug for redirect URLs ──────────────────────
  const { data: ws, error: wsErr } = await supa
    .from("workspaces")
    .select("slug")
    .eq("id", workspace_id)
    .maybeSingle();
  if (wsErr || !ws?.slug) {
    console.error(
      "[billing/checkout] workspace slug lookup failed:",
      wsErr?.message, "code:", wsErr?.code,
    );
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }
  const slug = ws.slug;

  // ── 6. Resolve Stripe Customer ───────────────────────────────────────
  // Read user_billing using the caller's own auth (RLS lets them SELECT
  // their own row). If the row is missing, create a fresh Stripe
  // Customer here — we DON'T write user_billing in this route. The
  // checkout.session.completed webhook is the sole writer of all
  // billing tables (see route docstring above for the boundary
  // rationale).
  const stripe = getStripe();
  const { data: existingUserBilling, error: ubErr } = await supa
    .from("user_billing")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (ubErr) {
    console.error(
      "[billing/checkout] user_billing lookup failed:",
      ubErr?.message, "code:", ubErr?.code,
    );
    return NextResponse.json({ error: "Billing identity lookup failed" }, { status: 500 });
  }
  let stripeCustomerId = existingUserBilling?.stripe_customer_id ?? null;

  if (!stripeCustomerId) {
    // Resolve display_name for the Customer's name field (nice-to-have
    // for the Stripe Dashboard; not strictly required).
    const { data: profile } = await supa
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    const displayName = profile?.display_name?.trim() || null;

    let created;
    try {
      created = await stripe.customers.create(
        {
          email: userEmail,
          name: displayName ?? undefined,
          metadata: {
            supabase_user_id: userId,
          },
        },
        {
          // Idempotency key derived from the Supabase user id. Within
          // Stripe's 24h idempotency window, a second .create({}) call
          // with the same key returns the FIRST request's Customer
          // verbatim — eliminating the parallel-request race AND the
          // "user bails, retries an hour later" duplicate-Customer
          // case. After 24h the key expires; a new retry COULD mint a
          // second Customer (the first becomes an orphan), which we
          // accept for slice 2. See route docstring "ORPHAN CUSTOMER
          // WINDOW" for the full rationale.
          idempotencyKey: `stages-customer-${userId}`,
        },
      );
    } catch (e) {
      const err = e as { message?: string; type?: string; code?: string };
      console.error(
        "[billing/checkout] Stripe customers.create failed:",
        err?.message, "type:", err?.type, "code:", err?.code,
      );
      return NextResponse.json({ error: "Stripe Customer creation failed" }, { status: 502 });
    }
    stripeCustomerId = created.id;
    // No DB write here. The checkout.session.completed webhook UPSERTs
    // user_billing(user_id, stripe_customer_id) once the session resolves.
  }

  // ── 7. Resolve Price ID from env ─────────────────────────────────────
  const priceId =
    plan === "solo"
      ? process.env.STRIPE_PRICE_SOLO_MONTHLY
      : process.env.STRIPE_PRICE_TEAM_MONTHLY;
  if (!priceId) {
    console.error(
      "[billing/checkout] Missing env var for price ID:",
      plan === "solo" ? "STRIPE_PRICE_SOLO_MONTHLY" : "STRIPE_PRICE_TEAM_MONTHLY",
    );
    return NextResponse.json({ error: "Pricing not configured" }, { status: 500 });
  }

  // ── 8. Build redirect URLs ───────────────────────────────────────────
  // origin comes from the request — supports localhost dev (port 3000)
  // and prod (https://app.trystages.com) without any branching. NEVER
  // accept a user-supplied redirect URL from the body — phishing risk.
  const origin =
    request.headers.get("origin") ??
    new URL(request.url).origin;
  const successUrl = `${origin}/w/${encodeURIComponent(slug)}?billing=success`;
  const cancelUrl = `${origin}/w/${encodeURIComponent(slug)}?billing=canceled`;

  // ── 9. Create Checkout Session ───────────────────────────────────────
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [
        {
          price: priceId,
          // Quantity = 1 for slice 2. Slice 3 ships per-seat sync that
          // reconciles to the actual agency-seat count of this workspace
          // before the first paid invoice (~14 days out). Trial is free
          // for those 14 days so quantity has zero billing impact now.
          quantity: 1,
        },
      ],
      // Slice 6 Bug 2 fix: align Stripe's trial_end to the workspace's
      // existing trial deadline (set by the Slice 6 trigger at workspace
      // creation), NOT a fresh trial_period_days: 14 from checkout
      // completion.
      //
      // Pre-Slice-6: workspaces had no trial_ends_at; Stripe owned the
      // trial lifecycle; trial_period_days: 14 was correct.
      //
      // Post-Slice-6: workspaces have trial_ends_at from day 1. Passing
      // trial_period_days: 14 to Stripe would give the user a FRESH
      // 14-day trial starting from checkout completion — extending well
      // beyond the deadline the banner copy + read-only enforcement
      // promised. A day-10 user would get charged on day 24; a day-15
      // expired user would get reset to a fresh 14-day trial (defeats
      // Part C read-only enforcement entirely).
      //
      // Pre-deadline path (existingTrialEndsAt > now()): pass trial_end
      // as the Unix timestamp of the existing deadline. Stripe charges
      // at the original deadline, no extension.
      //
      // Post-deadline path (expired): omit trial_end entirely. Stripe
      // charges immediately at $29/$39 — the Stripe Checkout page
      // shows "Total today: $29" so the user sees what they're paying
      // to restore their workspace. Matches Part C banner promise:
      // "Add a card to restore your workspace and continue working."
      //
      // This pattern mirrors Slice 5's /api/billing/founding-upgrade
      // pre/post-expiry branching (commit 3679a5c, prod-verified since
      // 2026-06-05). Inline ternary keeps Stripe SDK type inference
      // clean — no separate Stripe type import needed.
      subscription_data:
        existingTrialEndsAt &&
        new Date(existingTrialEndsAt).getTime() > Date.now()
          ? {
              trial_end: Math.floor(
                new Date(existingTrialEndsAt).getTime() / 1000,
              ),
              metadata: {
                workspace_id,
                plan,
                supabase_user_id: userId,
              },
            }
          : {
              // No trial_end / trial_period_days → Stripe charges
              // immediately. Reached when trial is expired (post-
              // deadline) OR (defensively) when existingTrialEndsAt is
              // somehow NULL — should never happen post-Slice-6 trigger
              // + backfill, but the route handles it without crashing.
              metadata: {
                workspace_id,
                plan,
                supabase_user_id: userId,
              },
            },
      // Card REQUIRED at trial start — this is Track B's "card-on-file"
      // model. 'if_required' would let trial start without a card.
      payment_method_collection: "always",
      success_url: successUrl,
      cancel_url: cancelUrl,
      // Cheap future-proofing; the modal doesn't surface a coupon field
      // but lets us hand out promo codes manually without a code change.
      allow_promotion_codes: true,
      metadata: {
        workspace_id,
        plan,
        supabase_user_id: userId,
      },
    });
  } catch (e) {
    const err = e as { message?: string; type?: string; code?: string };
    console.error(
      "[billing/checkout] Stripe checkout.sessions.create failed:",
      err?.message, "type:", err?.type, "code:", err?.code,
    );
    return NextResponse.json(
      { error: "Stripe Checkout Session creation failed" },
      { status: 502 },
    );
  }

  if (!session.url) {
    console.error(
      "[billing/checkout] Stripe returned a session with no URL:",
      session.id,
    );
    return NextResponse.json(
      { error: "Stripe Checkout returned no redirect URL" },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: session.url });
}
