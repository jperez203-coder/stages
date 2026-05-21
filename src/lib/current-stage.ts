/**
 * Current-stage derivation — the canonical rule for "which stage of a
 * pipeline is the in-progress one." Single source of truth, imported by
 * the dashboard (Phase 4a step 2) and the pipeline canvas (Phase 4a
 * step 5b). DO NOT duplicate this logic anywhere else. If the rule
 * needs to change, change it here.
 *
 * The 3-branch rule (Phase 4a):
 *   1. No tasks OR zero completed → current = stage at position 1
 *      ("plain" visual — pipeline hasn't started)
 *   2. All tasks completed       → current = last stage
 *      ("complete" visual — pipeline is done)
 *   3. Partial completion        → current = highest-position stage with
 *      any completed task ("in-progress" visual — work in flight)
 *
 * Why "highest-position with any completed task" rather than "highest
 * fully-completed stage": the user's progress signal is "I checked
 * something off in stage N, I'm working in N now." We don't require the
 * stage to be fully done — partial completion is the truest "you are
 * here."
 *
 * Per-stage state coloring (purple/green/grey) is positional, NOT a
 * per-stage task-completion check. See stateForStage() below for the
 * rule + edge cases.
 */

export type StageLike = {
  id: string;
  position: number;
};

export type StageCounts = Map<string, { total: number; completed: number }>;

export type PipelineVisual = "plain" | "in-progress" | "complete";

export type CurrentStageResult<S extends StageLike> = {
  /** The derived in-progress stage, or null if the pipeline has no
   *  stages at all. */
  currentStage: S | null;
  /** Pipeline-level visual hint: "plain" = nothing started yet,
   *  "in-progress" = partial completion, "complete" = everything done. */
  visual: PipelineVisual;
};

/**
 * Compute the current stage + pipeline visual from stages + task counts.
 *
 * @param stagesList — sorted by position ascending. Caller's responsibility.
 * @param stageCounts — map of stage_id → { total, completed } task counts.
 *                     Stages not in the map are treated as 0/0.
 * @param totals — pipeline-wide totals across all stages.
 */
export function deriveCurrentStage<S extends StageLike>(
  stagesList: S[],
  stageCounts: StageCounts,
  totals: { total: number; completed: number },
): CurrentStageResult<S> {
  if (stagesList.length === 0) {
    return { currentStage: null, visual: "plain" };
  }

  // Branch 1: pipeline hasn't started — no tasks anywhere OR none done.
  // Current = first stage, visual = plain.
  if (totals.total === 0 || totals.completed === 0) {
    return { currentStage: stagesList[0], visual: "plain" };
  }

  // Branch 2: pipeline is done — every task complete. Current = last
  // stage (anchor for auto-center), visual = complete. Note: in this
  // state, the last stage renders GREEN (not purple) — see
  // stateForStage() — because a done pipeline has zero purple.
  if (totals.completed >= totals.total) {
    return {
      currentStage: stagesList[stagesList.length - 1],
      visual: "complete",
    };
  }

  // Branch 3: partial completion. Highest-position stage with any
  // completed task is the in-progress stage. If no candidates somehow
  // (defensive — shouldn't happen since totals.completed > 0 means
  // SOME stage has a completed task), fall back to position 1.
  const candidates = stagesList.filter(
    (s) => (stageCounts.get(s.id)?.completed ?? 0) > 0,
  );
  const currentStage =
    candidates.length > 0
      ? candidates[candidates.length - 1]
      : stagesList[0];
  return { currentStage, visual: "in-progress" };
}

/**
 * Per-stage visual state for the pipeline canvas (Phase 4a step 5b).
 *
 * **Positional rule (locked):** state is purely a function of the
 * stage's position relative to the current stage's position. NOT a
 * per-stage task-completion check.
 *
 *   position <  current.position  → "passed"   (green)
 *   position === current.position → "current"  (purple)
 *   position >  current.position  → "future"   (grey)
 *
 * **The visual === "complete" override:** in a done-pipeline state, ALL
 * stages render as "passed" (green). The last stage is the auto-center
 * anchor but does NOT render purple — done pipelines have zero purple.
 *
 * **Important — color is display-only:** "passed" is a journey signal,
 * not a data mutation. A stage marked "passed" because the user moved
 * past it does NOT have its tasks auto-completed. When the user opens
 * a passed-but-incomplete stage, individual task checkboxes still show
 * truthful done/undone state. Confirmed by Jordan 2026-05-21.
 */
export type StageState = "passed" | "current" | "future";

export function stateForStage<S extends StageLike>(
  stage: S,
  current: S | null,
  visual: PipelineVisual,
): StageState {
  // Defensive: a pipeline with no stages can't have a current stage.
  // Every stage in that (impossible) state would render "future."
  if (!current) return "future";

  // Done-pipeline override: every stage is "passed" green; the last
  // stage is the anchor for auto-center but is NOT highlighted purple.
  if (visual === "complete") return "passed";

  if (stage.position < current.position) return "passed";
  if (stage.position === current.position) return "current";
  return "future";
}
