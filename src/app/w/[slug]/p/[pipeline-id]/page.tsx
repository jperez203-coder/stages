import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineCanvas } from "@/components/canvas/PipelineCanvas";

/**
 * /w/[slug]/p/[pipeline-id] — pipeline canvas. Phase 4a step 5a (canvas core).
 *
 * 5a scope: empty pan/zoom shell with dotted-grid background, edge fades,
 * stage-indicator pill, first-time coachmark, zoom controls, and 3-4
 * throwaway placeholder boxes for gesture testing. NO real stage/task
 * rendering yet — that's 5b-5e.
 *
 * Auth + redirect rules mirror the dashboard:
 *   * Anon → /auth/signin?next=/w/[slug]/p/[pipeline-id]
 *   * Non-workspace-member → / (workspace selector). Client-portal users
 *     get a separate canvas surface in 4c, not this route.
 *   * Pipeline not found OR not in this workspace → /w/[slug] (dashboard)
 *
 * Data fetched server-side:
 *   * Pipeline existence + name (for the placeholder header / pill).
 *   * profiles.canvas_hint_dismissed — the coachmark only renders if this
 *     is false. Passed to the client component as an initial state so we
 *     don't flash the coachmark on already-dismissed users while waiting
 *     for a client fetch.
 */

export const dynamic = "force-dynamic";

export default async function PipelineCanvasPage({
  params,
}: {
  params: Promise<{ slug: string; "pipeline-id": string }>;
}) {
  const resolved = await params;
  const { slug } = resolved;
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // ── Auth gate ──────────────────────────────────────────────────────────
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/w/${encodeURIComponent(slug)}/p/${encodeURIComponent(
        pipelineId,
      )}`,
    );
  }

  // ── Workspace membership check ─────────────────────────────────────────
  const wsMembershipResult = await supabase
    .from("workspace_memberships")
    .select(`role, workspace:workspaces!inner(id, name, slug)`)
    .eq("user_id", user.id)
    .eq("workspace.slug", slug)
    .maybeSingle();

  type WsRow = { id: string; name: string; slug: string };
  const wsRaw = wsMembershipResult.data?.workspace as unknown;
  const ws: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  if (!wsMembershipResult.data || !ws) {
    // For 5a: non-workspace-member kicks to /. Client-portal handling
    // (where a client-role user lands on this exact URL) is 4c scope —
    // until that ships, clients can't reach this route through the UI
    // anyway (no dashboard surfaces it to them), so the / fallback is
    // safe.
    redirect("/");
  }

  // ── Pipeline lookup ────────────────────────────────────────────────────
  const pipelineRes = await supabase
    .from("pipelines")
    .select("id, name, workspace_id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipelineRes.data || pipelineRes.data.workspace_id !== ws.id) {
    // Pipeline doesn't exist, or belongs to a different workspace.
    // Bounce to the workspace dashboard rather than 404 — gives the user
    // a recoverable surface (they can see what pipelines DO exist).
    redirect(`/w/${slug}`);
  }

  // ── Coachmark dismissed flag ───────────────────────────────────────────
  // Pulled at SSR so we don't render the coachmark for users who dismissed
  // it long ago. New `profiles.canvas_hint_dismissed` column added by the
  // 20260521120000 migration — defaults false, so brand-new users see the
  // coachmark on their first canvas visit.
  const profileRes = await supabase
    .from("profiles")
    .select("canvas_hint_dismissed")
    .eq("id", user.id)
    .maybeSingle();

  const coachmarkInitiallyDismissed =
    (profileRes.data?.canvas_hint_dismissed as boolean | null | undefined) ??
    false;

  return (
    <PipelineCanvas
      pipelineId={pipelineRes.data.id}
      pipelineName={pipelineRes.data.name}
      workspaceSlug={ws.slug}
      coachmarkInitiallyDismissed={coachmarkInitiallyDismissed}
    />
  );
}
