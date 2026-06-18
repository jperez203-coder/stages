import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  fetchCallerContextSummary,
  type CallerContextSummary,
} from "@/lib/caller-context-summary";
import {
  CreateWorkspaceForm,
  type WorkspaceTypeSelectorMode,
} from "./CreateWorkspaceForm";

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

  // WT-3 + WL-3a: workspace-type selector visibility. Four modes — chosen
  // here server-side so the form mounts in its final shape and there's no
  // post-hydration "the selector just appeared" flash. The C1 block above
  // has already redirected pure clients, so the cases below cover only
  // the agency-eligible / brand-new / auto-personal-only branches.
  //
  //   hasOnlyAutoPersonal → 'force-agency'    [WL-3a]
  //     Caller's ONLY context is the untouched WL-2 auto-personal
  //     workspace. They came here via the post-signup Flow A routing
  //     (resolveDestination's WL-3a branch) and need to name an agency
  //     without seeing a personal option (they already have one). Form
  //     starts with agency pre-selected; the Personal card surfaces in
  //     its existing at-limit disabled treatment via
  //     hasPersonalWorkspace (which is true for them by construction).
  //     Checked FIRST so a user who somehow holds an owner role on
  //     their auto-personal AND nothing else doesn't fall into the
  //     hasAgencyOwnerOrAdminRole branch below.
  //
  //   hasAgencyOwnerOrAdminRole → 'show-no-default'
  //     User owns or admins at least one membership somewhere. Selector
  //     is shown with neither option pre-picked; they must consciously
  //     choose 'agency' vs 'personal' before the submit button enables.
  //
  //   else !hasAgency → 'show-with-agency-default'
  //     Brand-new signup with zero memberships of any kind. Post-WL-2
  //     this branch is unreachable for new signups (the auto-personal
  //     trigger always lands a workspace_memberships row before they
  //     get here), but the mode stays in the matrix for pre-WL-2
  //     accounts (none in prod today) and for the defensive
  //     edge case where the WL-2 trigger's EXCEPTION block fired and
  //     left them with zero contexts.
  //
  //   else → 'hide-force-personal'
  //     Caller is member-only somewhere (workspace_memberships role
  //     'member' OR pipeline_memberships role 'member', no owner/admin
  //     standing). They get no selector and the form locks to
  //     'personal' silently.
  //
  // The fall-through ordering matters: hasOnlyAutoPersonal first
  // (WL-3a Flow A signups), then hasAgencyOwnerOrAdminRole, then
  // the legacy zero-contexts and member-only branches.
  const selectorMode: WorkspaceTypeSelectorMode =
    summary.hasOnlyAutoPersonal
      ? "force-agency"
      : summary.hasAgencyOwnerOrAdminRole
        ? "show-no-default"
        : !summary.hasAgency
          ? "show-with-agency-default"
          : "hide-force-personal";

  // WT-5 + WL-3b: pass-through for the at-limit card disabled states.
  // The underlying caps are enforced server-side by
  // create_workspace_with_owner raising 23505 — WT-4 for personal,
  // WL-1 for agency. These props are UX affordances so the user sees
  // the disabled card + tooltip BEFORE they submit and hit the raise.
  // When both flags are true (Jordan's at-cap-both state) BOTH cards
  // disable, the form's workspaceType stays null, and the submit
  // button stays disabled — the user can't accidentally submit a
  // doomed request.
  return (
    <CreateWorkspaceForm
      showCompanyNameField={isFirstWorkspace}
      selectorMode={selectorMode}
      hasPersonalWorkspace={summary.hasPersonalWorkspace}
      hasAgencyWorkspace={summary.hasAgencyWorkspace}
    />
  );
}
