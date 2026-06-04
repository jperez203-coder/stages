import "server-only";
import Stripe from "stripe";

/**
 * Single Stripe client instance, server-side only.
 *
 * The `server-only` import at the top of this file is the load-bearing
 * piece — it makes Next.js fail the build if any module importing this
 * file is bundled into a client component. We never want the secret key
 * within a hundred miles of the browser bundle.
 *
 * API version is PINNED to the value the installed SDK was tested
 * against (`Stripe.PACKAGE_VERSION` 22.2.0 at write time, which bundles
 * the `2026-05-27.dahlia` API version). Pinning means:
 *
 *   * Stripe rolls out an API version change → our calls don't shift
 *     silently underneath us.
 *   * Bumping the SDK is a two-line change (this string + the npm
 *     install) instead of a hunt across every call site.
 *
 * When you bump the SDK package, also bump the apiVersion string here
 * to match the new SDK's default — find it via
 *   `node -e "console.log(require('stripe/cjs/apiVersion').ApiVersion)"`
 * and update both at once. Don't let them drift.
 *
 * The lazy-init pattern (function vs. module-level new Stripe(...))
 * matters for Next.js build-time module evaluation: at `npm run build`
 * the file is imported and evaluated even if no route calls into it,
 * so a module-level `new Stripe(process.env.STRIPE_SECRET_KEY!)` would
 * throw on a Vercel build where the env var isn't set yet (e.g. preview
 * deploys before billing env vars are added). The function defers the
 * env read to first call, which only happens from actual route code
 * that has the env var or fails loud in dev.
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local (test mode key " +
        "starts with sk_test_). For Vercel deploys, also add to the project's " +
        "Environment Variables in the Vercel dashboard.",
    );
  }
  // Soft guardrail — accidentally pasting the publishable key into the
  // secret slot would silently work for some read-only API calls and
  // then explode on the first write. Catch it at construction time.
  if (!secretKey.startsWith("sk_")) {
    throw new Error(
      "STRIPE_SECRET_KEY does not look like a Stripe secret key (expected " +
        "prefix sk_test_ or sk_live_). Did you paste the publishable key by " +
        "mistake? The publishable key (pk_…) belongs in STRIPE_PUBLISHABLE_KEY.",
    );
  }
  _stripe = new Stripe(secretKey, {
    apiVersion: "2026-05-27.dahlia",
    // typescript: true is the SDK default since v18; we keep it implicit
    // to avoid drift if Stripe ever flips the default.
    appInfo: {
      name: "Stages",
      // We don't pin a version string here — when the SDK adds a
      // Stripe-Version header we already pinned above, so this is just
      // for Stripe-side observability.
    },
  });
  return _stripe;
}

/**
 * Stripe-aligned subscription status allowlist. Mirrors the CHECK
 * constraint on `workspace_billing.subscription_status` exactly — keep
 * in sync. If Stripe adds a new status, update BOTH this constant and
 * the SQL constraint via a new migration.
 *
 * Exported as a const tuple so TS code that maps Stripe events into
 * DB writes can `as const` and get string-literal narrowing.
 */
export const STRIPE_SUBSCRIPTION_STATUSES = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
] as const;

export type StripeSubscriptionStatus =
  (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];

/**
 * Plan key allowlist. Mirrors the CHECK constraint on
 * `workspace_billing.plan`. Same sync rule as the status list above.
 */
export const STAGES_PLAN_KEYS = ["solo", "team"] as const;
export type StagesPlanKey = (typeof STAGES_PLAN_KEYS)[number];
