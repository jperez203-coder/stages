import type { createSupabaseServerClient } from "./supabase-server";

/**
 * Server-side data fetch for the client portal canvas. Phase 4b-2-a.
 *
 * Returns ONLY client-visible stages + client-visible tasks. Two layers
 * of filtering applied:
 *
 *   Layer 1 (RLS — canonical):
 *     stages_select  — `is_pipeline_agency_member OR (is_pipeline_client
 *                       AND client_visible = true)`
 *     tasks_select   — `(is_pipeline_agency_member) OR (is_pipeline_client
 *                       AND tasks.client_visible AND stages.client_visible)`
 *
 *   Layer 2 (explicit `.eq("client_visible", true)`):
 *     Belt-and-suspenders. Tightens the query plan AND documents intent
 *     at the call site. If RLS ever regressed, the explicit filter alone
 *     would still hide invisible rows from clients. Also: when an AGENCY
 *     member previews the portal (PortalShell's "Viewing as client"
 *     banner), RLS would normally return ALL tasks/stages — the explicit
 *     filter is what makes the preview accurate (they see the same
 *     subset the client would). RLS is for security; explicit filter is
 *     for parity-of-view.
 *
 * Hidden tasks NEVER hit the wire for a real client; for an agency
 * previewer, the explicit filter restricts the rows the server returns
 * before they ever cross to the browser. Same defense pattern as the
 * chat surface's is_internal handling.
 *
 * Caller provides `pipelineId` (from the route). Auth is already gated
 * by the portal layout; this helper does no auth check of its own and
 * runs under the caller's RLS context (their JWT).
 */

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type VisibleStage = {
  id: string;
  position: number;
  name: string;
};

export type VisibleTask = {
  id: string;
  stage_id: string;
  position: number;
  title: string;
  done: boolean;
  deadline: string | null;
  /** Always true for rows returned by this fetch (explicit filter applied),
   *  but kept on the shape for parity with TaskRaw and so the portal task
   *  panel (4b-2-b) doesn't need a separate type. */
  client_visible: boolean;
  created_at: string;
};

export type PortalCanvasData = {
  stages: VisibleStage[];
  tasks: VisibleTask[];
};

export async function fetchPortalCanvasData(
  supabase: SupabaseServerClient,
  pipelineId: string,
): Promise<PortalCanvasData> {
  // Parallel fetch: stages + tasks. Both apply the explicit
  // client_visible=true filter on top of RLS. Tasks additionally join
  // to stages for the chain-visibility filter (a "smuggled" task in a
  // hidden stage stays hidden even if the task itself is client_visible
  // — matches the agency RLS pattern's defense-in-depth shape).
  const [stagesRes, tasksRes] = await Promise.all([
    supabase
      .from("stages")
      .select("id, position, name")
      .eq("pipeline_id", pipelineId)
      .eq("client_visible", true)
      .order("position", { ascending: true }),

    supabase
      .from("tasks")
      .select(
        `id, stage_id, position, title, done, deadline, client_visible, created_at,
         stage:stages!inner(client_visible, pipeline_id)`,
      )
      .eq("client_visible", true)
      .eq("stage.client_visible", true)
      .eq("stage.pipeline_id", pipelineId)
      .order("position", { ascending: true }),
  ]);

  const stages: VisibleStage[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id as string,
    position: s.position as number,
    name: s.name as string,
  }));

  const tasks: VisibleTask[] = (tasksRes.data ?? []).map((t) => {
    const row = t as VisibleTask & Record<string, unknown>;
    return {
      id: row.id,
      stage_id: row.stage_id,
      position: row.position,
      title: row.title,
      done: row.done,
      deadline: row.deadline,
      client_visible: row.client_visible,
      created_at: row.created_at,
    };
  });

  return { stages, tasks };
}
