import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchPortalCanvasData } from "@/lib/portal-canvas-data";
import { PortalCanvas } from "@/components/portal/v2/PortalCanvas";

/**
 * /portal/[pipeline-id]/canvas — client portal canvas tab.
 * Phase 4b-2-a.
 *
 * Layout (`/portal/[pipeline-id]/layout.tsx`) already auth-gates the
 * route — anyone reaching this page can access the pipeline (client OR
 * agency previewer). This page does the canvas-specific data fetch
 * and renders PortalCanvas inside the existing PortalShell slot.
 *
 * Data flow:
 *   * fetchPortalCanvasData applies BOTH RLS (canonical) and an
 *     explicit `client_visible = true` filter on stages + tasks. For
 *     a real client, RLS already restricts the result set; for an
 *     agency previewer, the explicit filter is what makes the preview
 *     match the client's actual view (RLS would otherwise return
 *     everything for an agency member).
 *   * PortalCanvas takes the filtered shape and renders the read-only
 *     pan/zoom view + functional done-toggle.
 *
 * No realtime in 4b-2-a — matches the agency canvas. Refresh to see
 * server-side changes from the agency side.
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

  const data = await fetchPortalCanvasData(supabase, pipelineId);

  return <PortalCanvas data={data} />;
}
