import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * /w/[slug]/settings/team — defensive server-side gate.
 *
 * Personal workspaces have no team-member invite surface (Model C —
 * solo by definition), so direct URL navigation to /settings/team on a
 * personal workspace redirects out before the team page renders.
 * Defense-in-depth pair to:
 *   * WorkspaceSettingsTabs (WT-5) hiding the "Team" link entirely.
 *   * /api/invites/send + accept_workspace_invite RPC (WT-4) rejecting
 *     any actual team-member invite request on a personal workspace.
 *
 * The redirect lands on /w/[slug] (the workspace dashboard). Strategy's
 * "redirect to /w/[slug]/settings" instruction has no matching route
 * today (there's no /settings index page); the dashboard is the
 * closest existing landing place.
 *
 * Auth: the inner page.tsx handles anonymous + non-member redirects.
 * This layout intentionally does NOT redirect anonymous users — that
 * would be a second redirect target ahead of the page's own auth
 * gate, harder to reason about. Anonymous users fall through here and
 * the inner page sends them to /auth/signin.
 *
 * Owner/admin gate: also handled by the inner page (it renders a
 * "You don't have access" card for non-owner/admin members rather
 * than redirecting). This layout intentionally only adds the
 * personal-workspace branch on top.
 */

export const dynamic = "force-dynamic";

export default async function TeamSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supa = await createSupabaseServerClient();

  const { data: userRes } = await supa.auth.getUser();
  const user = userRes.user;
  if (!user) {
    // Anonymous — fall through to the inner page's auth gate.
    return <>{children}</>;
  }

  // Look up the workspace's type via the user's membership row. The
  // !inner + .eq("workspace.slug", slug) pattern mirrors
  // src/lib/canvas-route-cache.ts. RLS already scopes
  // workspace_memberships to the caller's own rows.
  const result = await supa
    .from("workspace_memberships")
    .select("workspace:workspaces!inner(type)")
    .eq("user_id", user.id)
    .eq("workspace.slug", slug)
    .maybeSingle();

  // Embed comes back as either an object or a single-element array
  // depending on PostgREST codegen heuristic — same normalize pattern
  // used elsewhere in the codebase.
  const wsRaw = result.data?.workspace as unknown;
  const wsObj = (Array.isArray(wsRaw) ? wsRaw[0] : wsRaw) as
    | { type?: string }
    | undefined;

  if (wsObj?.type === "personal") {
    redirect(`/w/${encodeURIComponent(slug)}`);
  }

  // Non-member, missing workspace, agency workspace — all fall through
  // to the inner page, which has its own non-member redirect.
  return <>{children}</>;
}
