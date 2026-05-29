import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  fetchCallerContextSummary,
  type CallerContextSummary,
} from "@/lib/caller-context-summary";
import { CreateWorkspaceForm } from "./CreateWorkspaceForm";

/**
 * /onboarding/create-workspace — workspace creation page.
 *
 * 2026-05-26 (C1 boundary fix): page converted from a single client
 * component to a server-component gate + client-component form. The
 * gate enforces a pure-client BLOCK to close a paywall bypass — a
 * client of someone else's pipeline could previously type this URL
 * (or click "Create new workspace" in the AppShell switcher dropdown,
 * before A1+A3 hid it) and become a workspace owner for free,
 * undercutting paying Solo/Team users.
 *
 * THE THREE-CASE RULE (locked):
 *   * BLOCK iff `hasClient && !hasAgency`            ← pure client → redirect
 *   * ALLOW if zero contexts                          ← brand-new agency signup
 *   * ALLOW if agency context exists                  ← agency adding workspaces
 *
 * The zero-contexts allow is CRITICAL. WorkspaceSelector auto-routes
 * brand-new signups here via resolveDestination's `create_workspace`
 * branch — breaking this case means we can't onboard any paying
 * agency. Tested logically; verified via the explicit `!hasAgency &&
 * !hasClient` case falling through to the form render below.
 *
 * Defense in depth: the `create_workspace_with_owner` RPC ALSO blocks
 * pure clients (migration 20260605120000). This page-level gate is
 * for UX (redirect rather than form-then-error); the RPC gate is the
 * security floor against direct-PostgREST callers.
 */

export const dynamic = "force-dynamic";

/**
 * Where to send a blocked pure client. Wrapped in a named function so
 * the swap point stays explicit and discoverable.
 *
 * Phase 1 (pre-Stripe, 2026-06-12 onward): all pure clients route to
 * `/upgrade?source=c1_block` — the paid-agency waitlist. They land on
 * a form to capture interest + plan preference rather than getting
 * silently bounced to their portal.
 *
 * Phase 2 (Stripe billing live, future): this same function will route
 * to a checkout-or-trial flow instead of the waitlist. Same swap point,
 * one-line change — the C1 gate logic ("pure client AND not agency")
 * stays untouched.
 *
 * The `summary` parameter is kept in the signature even though we don't
 * branch on it today, because the next iteration likely will (e.g. show
 * a personalised CTA based on which pipeline they're a client on).
 */
function blockedClientDestination(_summary: CallerContextSummary): string {
  return "/upgrade?source=c1_block";
}

export default async function CreateWorkspacePage() {
  const supabase = await createSupabaseServerClient();
  const summary = await fetchCallerContextSummary(supabase);

  // Anonymous → kick to sign-in. (The form's own anonymous-redirect
  // useEffect would catch this too once the form renders, but doing
  // it server-side prevents a flash of the form for signed-out users
  // and keeps the redirect target consistent.)
  if (!summary) {
    redirect("/auth/signin?next=/onboarding/create-workspace");
  }

  // C1 GATE — block pure clients. Zero-context users (`!hasClient &&
  // !hasAgency`) and any agency user (`hasAgency` true) fall through
  // to the form below.
  if (summary.hasClient && !summary.hasAgency) {
    redirect(blockedClientDestination(summary));
  }

  // First-workspace check — is this the caller's very first workspace
  // creation, or are they making a second/third one? Drives whether
  // the form asks for an agency Company name (asked once, saved to
  // profiles.company_name; editable later in /settings/account).
  //
  // Auth.getUser() is RLS-cheap and React.cache'd within the request,
  // so the cost is one auth round-trip we'd be doing anyway. The count
  // query uses `head: true` so no rows come back over the wire — just
  // the integer. RLS scopes workspace_memberships to the caller's own
  // rows, so this is exactly the "owner memberships I hold" count.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isFirstWorkspace = false;
  if (user) {
    const { count } = await supabase
      .from("workspace_memberships")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("role", "owner");
    isFirstWorkspace = (count ?? 0) === 0;
  }

  return <CreateWorkspaceForm showCompanyNameField={isFirstWorkspace} />;
}
