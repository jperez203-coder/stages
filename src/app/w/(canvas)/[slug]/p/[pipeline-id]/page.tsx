import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineCanvas } from "@/components/canvas/PipelineCanvas";
import { fetchCanvasRouteBundle } from "@/lib/canvas-route-cache";

/**
 * /w/[slug]/p/[pipeline-id] — pipeline canvas surface.
 *
 * Phase 4b perf Win #2 (2026-05-26): the gate + chrome render moved
 * up to layout.tsx. This page now:
 *   1. Calls `fetchCanvasRouteBundle` for defense-in-depth on the
 *      gate (cached — returns the layout's already-computed result
 *      with zero DB round-trips on the happy path).
 *   2. Fetches its OWN canvas-specific data only: stages + tasks +
 *      coachmark flag.
 *   3. Returns just <PipelineCanvas /> — the surrounding chrome
 *      (header + LeftRail) comes from layout.tsx wrapping every
 *      child of this segment.
 *
 * Pre-Win-#2 this page did the gate + chrome fetch itself (and so did
 * each sibling tab page). The layout hoist eliminates that duplication
 * across tab navigations — chrome stays mounted as the user clicks
 * Canvas ↔ Chat ↔ Files ↔ Clients.
 *
 * Auth + redirect rules unchanged from pre-hoist; see
 * src/lib/canvas-route-cache.ts header for the redirect cases.
 */

export const dynamic = "force-dynamic";

export type StageRaw = {
  id: string;
  position: number;
  name: string;
};

export type TaskRaw = {
  id: string;
  stage_id: string;
  position: number;
  title: string;
  done: boolean;
  assignee_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  // Step 6 fields — read/edited only by TaskDetailPanel; the canvas
  // itself doesn't display these but they're loaded upfront so the
  // panel can render synchronously off `tasksState` (no round-trip
  // on panel open). Plus all panel mutations are optimistic; canvas
  // and panel share the same state.
  description: string | null;
  deadline: string | null;        // timestamptz from server, ISO string client-side
  client_visible: boolean;
  created_at: string;             // not null in DB (default now())
};

export default async function PipelineCanvasPage({
  params,
}: {
  params: Promise<{ slug: string; "pipeline-id": string }>;
}) {
  const resolved = await params;
  const { slug } = resolved;
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // Defense-in-depth gate (cached). Layout ran the same call first —
  // this returns its bundle without re-hitting the DB.
  const bundle = await fetchCanvasRouteBundle(slug, pipelineId);

  // Canvas-specific parallel fetches: stages + tasks + coachmark.
  // (Chrome / caller-profile / task counts now come from the bundle.)
  const [stagesRes, tasksRes, profileRes] = await Promise.all([
    supabase
      .from("stages")
      .select("id, position, name")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true }),

    supabase
      .from("tasks")
      .select(
        `id, stage_id, position, title, done, assignee_id,
         completed_at, completed_by,
         description, deadline, client_visible, created_at,
         stage:stages!inner(pipeline_id)`,
      )
      .eq("stage.pipeline_id", pipelineId)
      .order("position", { ascending: true }),

    // Coachmark flag — SSR'd to avoid flash on dismissed users.
    supabase
      .from("profiles")
      .select("canvas_hint_dismissed")
      .eq("id", bundle.user.id)
      .maybeSingle(),
  ]);

  // ── Cast stages + tasks ───────────────────────────────────────────────
  const stages: StageRaw[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    position: s.position,
    name: s.name,
  }));

  const tasks: TaskRaw[] = (tasksRes.data ?? []).map((t) => {
    const row = t as TaskRaw & Record<string, unknown>;
    return {
      id: row.id,
      stage_id: row.stage_id,
      position: row.position,
      title: row.title,
      done: row.done,
      assignee_id: row.assignee_id,
      completed_at: row.completed_at,
      completed_by: row.completed_by,
      description: row.description,
      deadline: row.deadline,
      client_visible: row.client_visible,
      created_at: row.created_at,
    };
  });

  const coachmarkInitiallyDismissed =
    (profileRes.data?.canvas_hint_dismissed as boolean | null | undefined) ??
    false;

  return (
    <PipelineCanvas
      pipelineId={bundle.chrome.pipeline.id}
      pipelineName={bundle.chrome.pipeline.name}
      coachmarkInitiallyDismissed={coachmarkInitiallyDismissed}
      stages={stages}
      tasks={tasks}
      members={bundle.chrome.members}
      currentUserId={bundle.user.id}
      canEditPipeline={bundle.chrome.canEditPipeline}
    />
  );
}
