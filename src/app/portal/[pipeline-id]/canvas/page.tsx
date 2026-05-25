import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchPortalCanvasData } from "@/lib/portal-canvas-data";
import { PortalCanvas } from "@/components/portal/v2/PortalCanvas";

/**
 * /portal/[pipeline-id]/canvas — client portal canvas tab.
 * Phase 4b-2-a + 4b-2-b.
 *
 * Layout (`/portal/[pipeline-id]/layout.tsx`) already auth-gates the
 * route — anyone reaching this page can access the pipeline (client OR
 * agency previewer). This page does the canvas-specific data fetch
 * and renders PortalCanvas inside the existing PortalShell slot.
 *
 * Data flow:
 *   * fetchPortalCanvasData applies BOTH RLS (canonical) and an
 *     explicit `client_visible = true` filter on stages + tasks.
 *   * Additionally fetches pipeline.name for the task-detail panel's
 *     breadcrumb (4b-2-b). RLS lets the client read their pipeline.
 *
 * No realtime in 4b-2-a — matches the agency canvas.
 */

export const dynamic = "force-dynamic";

export default async function PortalCanvasPage({
  params,
}: {
  params: Promise<{ "pipeline-id": string }>;
}) {
  const resolved = await params;
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // Parallel: canvas data + pipeline name. Both run as the caller via
  // the cookie-bearing client; RLS applies. The pipeline name fetch is
  // a tiny extra round-trip for the panel's breadcrumb; the layout
  // already fetches pipeline meta for the chrome but Next.js sub-pages
  // can't share that data, so this fetches its own slim row.
  const [data, pipelineMetaRes] = await Promise.all([
    fetchPortalCanvasData(supabase, pipelineId),
    supabase
      .from("pipelines")
      .select("name")
      .eq("id", pipelineId)
      .maybeSingle(),
  ]);

  // Defensive fallback if the pipeline row isn't readable (shouldn't
  // happen — the layout already gated access). Empty string keeps the
  // breadcrumb intact rather than rendering "undefined › Stage".
  const pipelineName = pipelineMetaRes.data?.name ?? "";

  return <PortalCanvas data={data} pipelineName={pipelineName} />;
}
