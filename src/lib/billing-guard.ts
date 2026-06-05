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
 * For Slice 5: client-prop gate is acceptable. Determined-bypass is a
 * known-and-accepted residual risk; honest users get the expected
 * read-only experience.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * SEMANTICS (locked decision from Slice 5 plan, Thread 1):
 *   * Allow writes when workspace_billing.subscription_status IN
 *     ('trialing', 'active'). Anything else (canceled, past_due,
 *     incomplete, unpaid, paused, OR no row at all) blocks the write
 *     with 403 + { error: 'subscription_required', status: <current> }.
 *   * The UI catches that error code and renders the "Your subscription
 *     has ended — claim 50% off lifetime" banner (Track A founder) or
 *     "Start your trial" banner (Track B never-paid).
 *
 * WHAT IS GATED:
 *   * Anything that mutates workspace-scoped data: pipeline / stage /
 *     task / note / channel / message / file / link / member CRUD.
 *
 * WHAT IS NOT GATED (must not call this helper):
 *   * Workspace CREATION itself — brand-new workspaces have no billing
 *     row, gating creation would be a bootstrap deadlock.
 *   * Profile self-updates (display_name, company_name, last_active_*,
 *     canvas_hint_dismissed, avatar_url) — these aren't workspace
 *     writes.
 *   * The billing routes themselves (/api/billing/checkout,
 *     /api/billing/webhook, /api/billing/founding-upgrade) — they ARE
 *     the path to re-activate.
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
 *   Why use the authenticated client (not service-role): so the guard
 *   itself doesn't bypass RLS. If RLS ever widens or tightens, this
 *   helper inherits the change automatically.
 */
export async function assertSubscriptionWritable(
  workspaceId: string,
  client?: SupabaseClient,
): Promise<NextResponse | null> {
  const supa = client ?? (await createSupabaseServerClient());

  const { data, error } = await supa
    .from("workspace_billing")
    .select("subscription_status, trial_ends_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    // Read failure (DB unreachable, syntax error, etc.). Fail closed.
    console.error(
      "[billing-guard] workspace_billing read failed:",
      error?.message,
      "code:",
      error?.code,
      "details:",
      error?.details,
      "hint:",
      error?.hint,
    );
    return NextResponse.json(
      { error: "billing_check_failed" },
      { status: 500 },
    );
  }

  const status = data?.subscription_status ?? null;

  if (status === "trialing" || status === "active") {
    return null;
  }

  // Block. Caller's client code reads { error: 'subscription_required' }
  // and shows the appropriate re-activation banner.
  return NextResponse.json(
    {
      error: "subscription_required",
      status,
      // trial_ends_at lets the banner show "your trial ended on X" copy
      // if the caller wants to surface it. NULL for never-had-billing.
      trial_ends_at: data?.trial_ends_at ?? null,
    },
    { status: 403 },
  );
}

/**
 * Variant for code paths that don't have a NextResponse return contract
 * (e.g. server-side helpers called from page render code that may
 * conditionally redirect). Returns a structured result the caller can
 * branch on.
 *
 * Use sparingly — most write paths should use assertSubscriptionWritable
 * above and bubble its 403 back through the API surface.
 */
export type SubscriptionWritability =
  | { writable: true; status: "trialing" | "active" }
  | {
      writable: false;
      reason: "billing_check_failed" | "subscription_required";
      status: string | null;
      trial_ends_at: string | null;
    };

export async function checkSubscriptionWritable(
  workspaceId: string,
  client?: SupabaseClient,
): Promise<SubscriptionWritability> {
  const supa = client ?? (await createSupabaseServerClient());
  const { data, error } = await supa
    .from("workspace_billing")
    .select("subscription_status, trial_ends_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error(
      "[billing-guard] workspace_billing read failed:",
      error?.message,
      "code:",
      error?.code,
    );
    return {
      writable: false,
      reason: "billing_check_failed",
      status: null,
      trial_ends_at: null,
    };
  }
  const status = data?.subscription_status ?? null;
  if (status === "trialing" || status === "active") {
    return { writable: true, status };
  }
  return {
    writable: false,
    reason: "subscription_required",
    status,
    trial_ends_at: data?.trial_ends_at ?? null,
  };
}
