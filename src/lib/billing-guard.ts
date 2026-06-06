import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Billing guard for workspace-scoped write operations.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠ KNOWN GAP — SERVER GATE COVERS ONLY API-ROUTE WRITES
 *
 * This helper runs in server context (API route handlers, server actions,
 * server components). It DOES NOT run for direct PostgREST writes from
 * client components — those go straight from the browser to Supabase
 * without traversing any Next.js server code.
 *
 * For the ~25 direct-PostgREST write sites in the agency canvas + portal
 * (task done toggles, file uploads, chat message inserts, etc.), the
 * billing gate is implemented CLIENT-SIDE only via a subscription_status
 * prop passed down from the server-rendered parent page. That's a
 * UX-layer gate, not an authorization gate — a user with technical
 * skills + hostile intent can open DevTools, run `supabase.from("tasks")
 * .update(…)` against a canceled workspace, and the write will succeed.
 *
 * The proper fix is RLS-layer billing enforcement: extend each write
 * policy on tasks / stages / channels / pipeline_links / channel_messages
 * etc. with an EXISTS clause requiring the workspace's
 * subscription_status IN ('trialing','active'). That's tracked in
 * WISHLIST.md ("Hardening: RLS-layer billing-state write enforcement")
 * for a future slice.
 *
 * For Slice 5/6: client-prop gate is acceptable. Determined-bypass is
 * a known-and-accepted residual risk; honest users get the expected
 * read-only experience.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * SEMANTICS (locked across Slice 5 + Slice 6):
 *
 * The 5-gate evaluation (see evaluateWritability below) decides
 * writable / blocked from THREE columns of workspace_billing:
 *   subscription_status, trial_ends_at, stripe_subscription_id
 * plus ONE column of profiles when the trial has expired without a
 * Stripe sub on file:
 *   is_founding_member
 *
 *   1. Paid subscription (status='active')         → ALLOW
 *   2. Stripe-managed trial (status='trialing'
 *      AND stripe_subscription_id IS NOT NULL)     → ALLOW
 *        (Track B post-checkout. Stripe owns the trial deadline; will
 *         fire customer.subscription.updated webhook to flip status
 *         when it ends or payment fails.)
 *   3. Manual trial pre-deadline (status='trialing'
 *      AND stripe_subscription_id IS NULL
 *      AND trial_ends_at > now())                  → ALLOW
 *        (Track A founder in 30-day no-card trial OR Track B Slice 6
 *         trigger-created 14-day no-card trial.)
 *   4. Manual trial post-deadline + founder
 *      (status='trialing' + sub_id IS NULL +
 *       trial_ends_at <= now()
 *       AND profile.is_founding_member = true)     → ALLOW
 *        (Eternal founding policy: no hard cliff. They keep writing
 *         while deciding whether to claim 50% off via the founding-
 *         upgrade route. The FoundingTrialEndingBanner urges upgrade.)
 *   5. Everything else                              → BLOCK
 *        (Track B expired trial, canceled, past_due, incomplete,
 *         unpaid, paused, OR no row at all.)
 *
 * On block: 403 with { error: 'subscription_required', status,
 * trial_ends_at }. The UI catches that error code and renders the
 * appropriate banner (StartTrialBanner expired variant for Track B
 * non-founders; FoundingTrialEndingBanner for founders — though
 * founders never reach this branch because of gate 4).
 *
 * WHAT IS GATED:
 *   * Anything that mutates workspace-scoped data: pipeline / stage /
 *     task / note / channel / message / file / link / member CRUD.
 *
 * WHAT IS NOT GATED (must not call this helper):
 *   * Workspace CREATION itself — brand-new workspaces have no billing
 *     row at the moment of INSERT (the Slice 6 trigger creates it
 *     AFTER); gating creation would be a bootstrap deadlock. The
 *     trigger plus the Slice 6 backfill ensures every persisted
 *     workspace has a row from day 1.
 *   * Profile self-updates (display_name, company_name, last_active_*,
 *     canvas_hint_dismissed, avatar_url) — these aren't workspace
 *     writes.
 *   * The billing routes themselves (/api/billing/checkout,
 *     /api/billing/webhook, /api/billing/founding-upgrade,
 *     /api/billing/portal-session) — they ARE the path to re-activate.
 *   * Auth flows (signup, signin, signout, password reset).
 *   * Cron routes (/api/cron/*) — server-to-server.
 *
 * RETURN CONTRACT:
 *   * On allow: returns `null`. Caller proceeds normally.
 *   * On block: returns a NextResponse (403) that the caller should
 *     `return` verbatim from its route handler / server action.
 *   * On unexpected error (e.g. DB read failure): returns a 500
 *     NextResponse. Fail-CLOSED — never silently allow writes when we
 *     can't determine billing state.
 *
 * USAGE (SSR cookie auth — pages, server actions):
 *   const block = await assertSubscriptionWritable(workspaceId);
 *   if (block) return block;
 *
 * USAGE (Bearer-token auth — invite-style API routes that verify the
 * caller's JWT manually and want to reuse that already-authed client
 * instead of opening a second SSR cookie session):
 *   const block = await assertSubscriptionWritable(workspaceId, supa);
 *   if (block) return block;
 *
 * READS THROUGH RLS:
 *   Uses the caller's authenticated client — either the SSR cookie
 *   client (default) or the Bearer-authed client passed in by the
 *   caller. RLS on workspace_billing restricts SELECT to workspace
 *   owner OR admin (Slice 1). MEMBERS read zero rows from
 *   workspace_billing — but members shouldn't be hitting this guard
 *   anyway (they don't have write permission on most workspace tables
 *   either; the table-level RLS rejects them first). If a member
 *   somehow reaches a write route, this guard returns 403 because the
 *   SELECT returns null → status=null → blocked. Note the 403 says
 *   `subscription_required` when the real cause is
 *   `member_cannot_read_billing` — acceptable because the table-level
 *   RLS would produce an equally generic error anyway, and UI-side role
 *   gating prevents this in practice.
 *
 *   The founder exemption query (gate 4) reads profiles.is_founding_member
 *   via the same authenticated client. RLS on profiles allows self-read,
 *   so this works for the caller's own row. The expired branch is
 *   uncommon in steady state so the extra round-trip cost is bounded.
 *
 *   Why use the authenticated client (not service-role): so the guard
 *   itself doesn't bypass RLS. If RLS ever widens or tightens, this
 *   helper inherits the change automatically.
 */

/**
 * Public structured-result type shared by both checkSubscriptionWritable
 * (returns this directly) and the internal evaluator that
 * assertSubscriptionWritable formats into a NextResponse.
 */
export type SubscriptionWritability =
  | { writable: true; status: "trialing" | "active" }
  | {
      writable: false;
      reason: "billing_check_failed" | "subscription_required";
      status: string | null;
      trial_ends_at: string | null;
    };

/**
 * Shared 5-gate evaluation. Both public helpers delegate here so the
 * logic isn't duplicated and bug-fixes land in one place.
 *
 * Gate ordering is significant — gates 1–4 short-circuit out as soon as
 * a writable verdict is reached. Only gate 5 (expired manual trial)
 * incurs the extra auth.getUser + profiles read, and only when the
 * caller is post-deadline without a Stripe sub — the rarest branch.
 */
async function evaluateWritability(
  workspaceId: string,
  supa: SupabaseClient,
): Promise<SubscriptionWritability> {
  // ── Step 1: read workspace_billing ───────────────────────────────────
  const { data: billing, error: billingError } = await supa
    .from("workspace_billing")
    .select("subscription_status, trial_ends_at, stripe_subscription_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (billingError) {
    // Read failure (DB unreachable, syntax error, etc.). Fail closed.
    console.error(
      "[billing-guard] workspace_billing read failed:",
      billingError?.message,
      "code:",
      billingError?.code,
      "details:",
      billingError?.details,
      "hint:",
      billingError?.hint,
    );
    return {
      writable: false,
      reason: "billing_check_failed",
      status: null,
      trial_ends_at: null,
    };
  }

  const status = billing?.subscription_status ?? null;
  const trialEndsAt = billing?.trial_ends_at ?? null;
  const stripeSubId = billing?.stripe_subscription_id ?? null;

  // ── Gate 1: paid subscription ────────────────────────────────────────
  if (status === "active") {
    return { writable: true, status: "active" };
  }

  // ── Gate 2: Stripe-managed trial (Track B post-checkout) ─────────────
  // Stripe owns the deadline. Webhook flips status when trial ends.
  if (status === "trialing" && stripeSubId !== null) {
    return { writable: true, status: "trialing" };
  }

  // ── Gate 3: Manual trial, pre-deadline ───────────────────────────────
  // Covers BOTH founder 30-day trials AND Track B 14-day trials from
  // the Slice 6 trigger.
  if (
    status === "trialing" &&
    stripeSubId === null &&
    trialEndsAt &&
    new Date(trialEndsAt) > new Date()
  ) {
    return { writable: true, status: "trialing" };
  }

  // ── Gate 4: Manual trial, post-deadline — founder exemption ──────────
  // Only the expired-manual-trial branch incurs the extra profiles read.
  if (
    status === "trialing" &&
    stripeSubId === null &&
    trialEndsAt &&
    new Date(trialEndsAt) <= new Date()
  ) {
    const { data: userResult } = await supa.auth.getUser();
    if (userResult?.user?.id) {
      const { data: profile, error: profileError } = await supa
        .from("profiles")
        .select("is_founding_member")
        .eq("id", userResult.user.id)
        .maybeSingle();
      if (profileError) {
        // Soft-fail: if the profiles read fails, fall through to the
        // Track B blocked branch below. The user's worst case is they
        // briefly see a "subscription_required" error until the next
        // request retries the lookup. Better than silently allowing
        // writes on a determinate-fail.
        console.error(
          "[billing-guard] profiles is_founding_member read failed:",
          profileError?.message,
          "code:",
          profileError?.code,
        );
      } else if (profile?.is_founding_member === true) {
        // Eternal founding policy — no hard cliff. They keep writing
        // while deciding to upgrade via FoundingTrialEndingBanner.
        return { writable: true, status: "trialing" };
      }
    }
    // Track B in expired state falls through to the block below.
  }

  // ── Gate 5: BLOCK. Covers expired Track B + canceled + past_due +
  // incomplete + unpaid + paused + null (no row). ──────────────────────
  return {
    writable: false,
    reason: "subscription_required",
    status,
    trial_ends_at: trialEndsAt,
  };
}

export async function assertSubscriptionWritable(
  workspaceId: string,
  client?: SupabaseClient,
): Promise<NextResponse | null> {
  const supa = client ?? (await createSupabaseServerClient());
  const evaluation = await evaluateWritability(workspaceId, supa);

  if (evaluation.writable) return null;

  if (evaluation.reason === "billing_check_failed") {
    return NextResponse.json(
      { error: "billing_check_failed" },
      { status: 500 },
    );
  }

  // subscription_required
  return NextResponse.json(
    {
      error: "subscription_required",
      status: evaluation.status,
      // trial_ends_at lets the banner show "your trial ended on X" copy
      // if the caller wants to surface it. NULL for never-had-billing.
      trial_ends_at: evaluation.trial_ends_at,
    },
    { status: 403 },
  );
}

/**
 * Variant for code paths that don't have a NextResponse return contract
 * (e.g. server-side helpers called from page render code that may
 * conditionally redirect). Returns the structured result directly so
 * the caller can branch on it.
 *
 * Use sparingly — most write paths should use assertSubscriptionWritable
 * above and bubble its 403 back through the API surface.
 */
export async function checkSubscriptionWritable(
  workspaceId: string,
  client?: SupabaseClient,
): Promise<SubscriptionWritability> {
  const supa = client ?? (await createSupabaseServerClient());
  return evaluateWritability(workspaceId, supa);
}
