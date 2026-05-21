import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineCanvas } from "@/components/canvas/PipelineCanvas";
import { deriveCurrentStage, stateForStage } from "@/lib/current-stage";
import type { StageState } from "@/lib/current-stage";

/**
 * /w/[slug]/p/[pipeline-id] — pipeline canvas. Phase 4a step 5b.
 *
 * 5b scope: real stage rendering on the canvas core from 5a. Fetches
 * stages + tasks from the database, derives per-stage state (passed /
 * current / future) via the shared deriveCurrentStage helper, and hands
 * StageViewModel[] to PipelineCanvas which renders StageNode + connectors.
 *
 * Still NOT in scope until later sub-steps:
 *   * Task boxes (5c)
 *   * Left rail + header chrome (5d)
 *   * Edit pipeline mode (5e)
 *   * Task detail panel (step 6)
 *
 * Auth + redirect rules mirror the dashboard:
 *   * Anon → /auth/signin?next=/w/[slug]/p/[pipeline-id]
 *   * Non-workspace-member → / (workspace selector). Client-portal users
 *     get a separate canvas surface in 4c, not this route.
 *   * Pipeline not found OR not in this workspace → /w/[slug] (dashboard)
 *
 * Data fetched server-side (single round-trip per table, no client
 * waterfalls):
 *   * Pipeline (id, name)
 *   * Stages (id, position, name) ordered by position asc
 *   * Tasks (id, stage_id, done) — only the fields needed for the
 *     completion count + per-stage state derivation. Task title +
 *     metadata not fetched here; that's 5c when task boxes render.
 *   * profiles.canvas_hint_dismissed — the coachmark only renders if
 *     this is false. SSR'd so we don't flash the coachmark on
 *     already-dismissed users.
 */

export const dynamic = "force-dynamic";

export type StageViewModel = {
  id: string;
  position: number;
  name: string;
  total: number;
  completed: number;
  state: StageState;
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
    redirect("/");
  }

  // ── Pipeline lookup ────────────────────────────────────────────────────
  const pipelineRes = await supabase
    .from("pipelines")
    .select("id, name, workspace_id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipelineRes.data || pipelineRes.data.workspace_id !== ws.id) {
    redirect(`/w/${slug}`);
  }

  // ── Stages + tasks + coachmark flag in parallel ───────────────────────
  const [stagesRes, tasksRes, profileRes] = await Promise.all([
    supabase
      .from("stages")
      .select("id, position, name")
      .eq("pipeline_id", pipelineRes.data.id)
      .order("position", { ascending: true }),

    // Only need stage_id + done for the per-stage count derivation.
    // Task title/metadata is fetched in 5c when task boxes render.
    //
    // Filtering by stage.pipeline_id via the FK join, scoped to this
    // pipeline only — keeps the query tight even on workspaces with
    // many pipelines.
    supabase
      .from("tasks")
      .select(
        `id, done, stage_id,
         stage:stages!inner(pipeline_id)`,
      )
      .eq("stage.pipeline_id", pipelineRes.data.id),

    // Pulled at SSR so we don't render the coachmark for users who
    // dismissed it long ago. profiles.canvas_hint_dismissed defaults
    // false, so brand-new users see the coachmark on their first
    // canvas visit. Per-user (not per-pipeline) — once dismissed,
    // never shows on any canvas.
    supabase
      .from("profiles")
      .select("canvas_hint_dismissed")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // ── Per-stage task counts + pipeline totals ───────────────────────────
  const stageCounts = new Map<string, { total: number; completed: number }>();
  let pipelineTotal = 0;
  let pipelineCompleted = 0;
  for (const t of tasksRes.data ?? []) {
    const counts = stageCounts.get(t.stage_id) ?? { total: 0, completed: 0 };
    counts.total += 1;
    if (t.done) counts.completed += 1;
    stageCounts.set(t.stage_id, counts);
    pipelineTotal += 1;
    if (t.done) pipelineCompleted += 1;
  }

  // ── Derive current stage via the shared helper ────────────────────────
  // Single source of truth — the same function the dashboard's PipelineCard
  // uses. See src/lib/current-stage.ts for the locked 3-branch rule.
  const stagesList = stagesRes.data ?? [];
  const { currentStage, visual } = deriveCurrentStage(
    stagesList,
    stageCounts,
    { total: pipelineTotal, completed: pipelineCompleted },
  );

  // ── Build the per-stage view model ─────────────────────────────────────
  const stages: StageViewModel[] = stagesList.map((s) => {
    const counts = stageCounts.get(s.id) ?? { total: 0, completed: 0 };
    return {
      id: s.id,
      position: s.position,
      name: s.name,
      total: counts.total,
      completed: counts.completed,
      state: stateForStage(s, currentStage, visual),
    };
  });

  const coachmarkInitiallyDismissed =
    (profileRes.data?.canvas_hint_dismissed as boolean | null | undefined) ??
    false;

  return (
    <PipelineCanvas
      pipelineId={pipelineRes.data.id}
      pipelineName={pipelineRes.data.name}
      workspaceSlug={ws.slug}
      coachmarkInitiallyDismissed={coachmarkInitiallyDismissed}
      stages={stages}
      currentStageId={currentStage?.id ?? null}
    />
  );
}
