import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Root route — server-side router only.
 *
 * Replaces the Phase 2 in-memory <App /> prototype that occupied this
 * slot since the initial scaffold. The prototype + its dependencies
 * (useAppState, LoginScreen, ClientList, ClientBoard, StagePage,
 * ClientPortal) remain on disk but are no longer reachable; a follow-up
 * cleanup PR will delete them after outreach launches.
 *
 * Routing rules (parallel to the destination resolver in
 * src/components/auth/WorkspaceSelector for the fast path; defers to
 * /select-workspace for any non-trivial case):
 *
 *   1. Anonymous → /auth/signin.
 *   2. Authenticated with at least one workspace membership → /w/[slug],
 *      preferring profiles.last_active_workspace_id when it still
 *      resolves to a workspace the user belongs to.
 *   3. Authenticated with zero workspace memberships → /select-workspace.
 *      WorkspaceSelector handles the rest (client-only → /portal/[id];
 *      truly empty → /onboarding/create-workspace).
 */

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createSupabaseServerClient();

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;

  if (!user) {
    redirect("/auth/signin");
  }

  // Pull last_active_workspace_id + the user's full workspace-membership
  // list in parallel. RLS filters the membership list to workspaces the
  // user currently belongs to, so a stale last_active_workspace_id (e.g.
  // user was removed from that workspace) won't find a match and we'll
  // fall through to workspaces[0] — avoiding the redirect loop that the
  // /w/[slug] fallback in src/app/w/(workspace)/[slug]/page.tsx would
  // otherwise create if we trusted last_active blindly.
  const [profileRes, membershipsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("last_active_workspace_id")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("workspace_memberships")
      .select("workspace:workspaces!inner(id, slug)")
      .eq("user_id", user.id),
  ]);

  // PostgREST returns nested-select rows as either object or array
  // depending on codegen heuristic. Normalize through unknown — same
  // pattern used in /w/[slug]/page.tsx (lines 80-83).
  type WsRow = { id: string; slug: string };
  const workspaces: WsRow[] = (membershipsRes.data ?? [])
    .map((row) => {
      const w = row.workspace as unknown;
      return (Array.isArray(w) ? w[0] : w) as WsRow | undefined;
    })
    .filter((w): w is WsRow => !!w);

  if (workspaces.length === 0) {
    // No agency-side memberships. Could be a brand-new signup, or a
    // client-only user. /select-workspace's WorkspaceSelector handles
    // both branches via resolveDestination.
    redirect("/select-workspace");
  }

  const lastActiveId = profileRes.data?.last_active_workspace_id;
  const target =
    (lastActiveId && workspaces.find((w) => w.id === lastActiveId)) ||
    workspaces[0];

  redirect(`/w/${target.slug}`);
}
