import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getStripe } from "@/lib/stripe";

/**
 * POST /api/billing/portal-session
 *
 * Creates a Stripe Customer Portal session for a workspace owner/admin
 * and returns the hosted URL. Slice 4 of Stripe billing — offloads
 * subscription management (cancel, switch plan, update card, view
 * invoices) to Stripe's hosted UI rather than building those flows
 * in-app.
 *
 * AUTHORIZATION CHAIN (in order)
 * ──────────────────────────────
 *   1. Parse body                               → 400 on malformed
 *   2. SSR session                              → 401 if missing
 *   3. Workspace owner/admin                    → 403 if not
 *   4. user_billing.stripe_customer_id lookup
 *        - present → continue
 *        - null    → 404 no_billing_yet (frontend shows "Start a
 *                    trial first" message; founder has never opened
 *                    a Checkout Session so no Stripe Customer exists)
 *   5. Resolve workspace slug for return_url    → 404 if missing
 *   6. Build return_url from request origin + workspace slug
 *   7. stripe.billingPortal.sessions.create     → 502 on Stripe failure
 *
 * RETURN_URL CONVENTION
 * ─────────────────────
 * Built dynamically from the request origin + the caller's workspace
 * slug: `${origin}/w/${slug}/settings/billing`. The Stripe-side default
 * redirect (configured in Stripe Dashboard) is a generic fallback for
 * bookmark/preview cases where no return_url is provided; our per-call
 * value overrides it for normal in-app flows so the founder lands back
 * on the SAME workspace's billing page after closing the portal.
 *
 * Origin from request.headers.get("origin") with new URL fallback —
 * same pattern as /api/billing/checkout and /api/billing/founding-
 * upgrade. Works in localhost dev + prod without a new env var.
 *
 * WHY POST NOT GET
 * ────────────────
 * Stylistic. Stripe's billingPortal.sessions.create is a state-changing
 * API call (mints a new session record on every invocation), so POST
 * reads more honestly than GET even though the route is otherwise
 * idempotent within the caller scope.
 *
 * NO ORPHAN-SUB PRE-FLIGHT
 * ────────────────────────
 * Different from /api/billing/founding-upgrade which checks for
 * stranded Stripe subscriptions. The portal route doesn't need this —
 * if user_billing.stripe_customer_id is present, the customer exists
 * in Stripe; if it isn't present, we 404 cleanly. The portal handles
 * its own state validation (e.g. if all subscriptions on the customer
 * are canceled, Stripe shows the appropriate "no active subscriptions"
 * UI).
 */

type PortalSessionBody = {
  workspace_id: string;
};

function parseBody(raw: unknown): PortalSessionBody | { error: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "Body must be JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  const workspace_id = obj.workspace_id;
  if (typeof workspace_id !== "string" || workspace_id.length < 8) {
    return { error: "workspace_id is required (uuid string)" };
  }
  return { workspace_id };
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
  const { workspace_id } = parsed;

  // ── 2. Resolve session ───────────────────────────────────────────────
  const supa = await createSupabaseServerClient();
  const { data: userResult, error: authError } = await supa.auth.getUser();
  if (authError || !userResult?.user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const userId = userResult.user.id;

  // ── 3. Workspace owner/admin gate ────────────────────────────────────
  const { data: membership, error: memErr } = await supa
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) {
    console.error(
      "[portal-session] membership lookup failed:",
      memErr?.message, "code:", memErr?.code, "details:", memErr?.details, "hint:", memErr?.hint,
    );
    return NextResponse.json({ error: "membership_check_failed" }, { status: 500 });
  }
  const role = membership?.role;
  // ROLE ALLOWLIST — only owner + admin can manage billing.
  // If workspace_memberships.role enum ever widens (e.g. a future
  // 'billing_manager' or 'finance' role lands), update this allowlist
  // in lockstep — otherwise the new role silently gets the same
  // treatment as 'member' (403'd). Grep the codebase for
  // "owner" === role || "admin" === role and the equivalent patterns
  // anywhere this guard is repeated.
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "not_authorized" }, { status: 403 });
  }

  // ── 4. user_billing.stripe_customer_id lookup ────────────────────────
  // RLS on user_billing restricts SELECT to self (slice 1) — the caller
  // can only see their own row. maybeSingle handles the "never had a
  // billing relationship" case (null row).
  const { data: userBilling, error: ubErr } = await supa
    .from("user_billing")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (ubErr) {
    console.error(
      "[portal-session] user_billing lookup failed:",
      ubErr?.message, "code:", ubErr?.code,
    );
    return NextResponse.json({ error: "billing_identity_failed" }, { status: 500 });
  }
  const stripeCustomerId = userBilling?.stripe_customer_id ?? null;
  if (!stripeCustomerId) {
    // Honest 404 — the founder has never opened a Checkout Session so
    // no Stripe Customer exists. Frontend renders "Start a trial first"
    // CTA rather than a generic error.
    return NextResponse.json({ error: "no_billing_yet" }, { status: 404 });
  }

  // ── 5. Resolve workspace slug for return_url ─────────────────────────
  const { data: ws, error: wsErr } = await supa
    .from("workspaces")
    .select("slug")
    .eq("id", workspace_id)
    .maybeSingle();
  if (wsErr || !ws?.slug) {
    console.error(
      "[portal-session] workspace slug lookup failed:",
      wsErr?.message, "code:", wsErr?.code,
    );
    return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  }
  const slug = ws.slug;

  // ── 6. Build return_url ──────────────────────────────────────────────
  // origin from request — never user-supplied. Same defense-in-depth
  // pattern as /api/billing/checkout and /api/billing/founding-upgrade.
  const origin =
    request.headers.get("origin") ??
    new URL(request.url).origin;
  const returnUrl = `${origin}/w/${encodeURIComponent(slug)}/settings/billing`;

  // ── 7. Create Stripe Portal Session ──────────────────────────────────
  const stripe = getStripe();
  let session;
  try {
    session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
  } catch (e) {
    const err = e as { message?: string; type?: string; code?: string };
    console.error(
      "[portal-session] Stripe billingPortal.sessions.create failed:",
      err?.message, "type:", err?.type, "code:", err?.code,
    );
    return NextResponse.json({ error: "stripe_error" }, { status: 502 });
  }

  if (!session.url) {
    console.error(
      "[portal-session] Stripe returned a portal session with no URL:",
      session.id,
    );
    return NextResponse.json({ error: "no_portal_url" }, { status: 502 });
  }

  return NextResponse.json({ url: session.url });
}
