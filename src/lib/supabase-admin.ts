import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * SERVICE-ROLE Supabase client. BYPASSES ALL RLS.
 *
 * ONLY for system writes from trusted server contexts:
 * - Stripe webhook handler (verified signature)
 *
 * NEVER import from:
 * - Any /app/* route that serves user requests
 * - Any client component
 * - Any server component reachable from user navigation
 *
 * If you need server-side DB access from a user-facing route, use the
 * authenticated supabase client (which honors RLS for the requesting user).
 *
 * ─────────────────────────────────────────────────────────────────────
 *
 * The `server-only` import at the top is load-bearing — Next.js fails
 * the build if any module importing this file is bundled into the
 * client. We never want SUPABASE_SECRET_KEY anywhere near the browser
 * bundle.
 *
 * Pattern mirrors src/lib/stripe.ts — lazy init, prefix guard, single
 * singleton across the server runtime.
 *
 * Authorized callers (each entry was a deliberate trust-boundary
 * widening — reviewed at the slice it shipped in):
 *
 *   - src/app/api/billing/webhook/route.ts  (Stripe webhook handler,
 *     verified signature)
 *   - src/lib/seat-count.ts → computeAgencySeatCount (Stripe Slice 3,
 *     cron-only consumer — sync-seats cron)
 *   - src/app/w/(workspace)/[slug]/settings/privacy/actions.ts
 *     (Slice 0.1 — writes ai_consent_audit, a service-role-only audit
 *     table modeled on seat_sync_log per docs/DATA-COLLECTION.md § 4.3.D)
 *
 * Any new import of this file is a request to widen the trust boundary
 * further — treat it as a design review, not a routine code change.
 */

let _admin: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set. Required for " +
        "the service-role Supabase client.",
    );
  }
  if (!key) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. The service-role client cannot be " +
        "constructed without it. Add to .env.local + Vercel env (Production).",
    );
  }
  // Guard against accidentally pasting the publishable key into the
  // secret slot — would silently work for reads but fail at write time
  // with confusing RLS denials. Catch it at construction.
  if (key.startsWith("sb_publishable_") || key.startsWith("eyJ")) {
    throw new Error(
      "SUPABASE_SECRET_KEY appears to be a publishable key (prefix sb_publishable_ " +
        "or eyJ — the legacy JWT shape). Service-role keys start with sb_secret_. " +
        "Refusing to start.",
    );
  }
  _admin = createClient(url, key, {
    auth: {
      // Service-role doesn't need (and must not have) a persisted session.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return _admin;
}
