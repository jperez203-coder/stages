/**
 * Per-stage state classifier + anchor-stage picker — the canonical
 * rules for pipeline canvas + dashboard surfaces.
 *
 * Phase 4a step 5c (annotation polish, 2026-05-22): the positional
 * "one current stage" model was replaced with this honest per-stage
 * model. Reason: agencies run parallel workstreams (sales + delivery
 * on different stages simultaneously). The positional rule forced ONE
 * "current" stage and demoted others to "passed" (visually = done),
 * which was a real bug — stage 3 at 1/3 displayed green while stage 4
 * was already partially in progress.
 *
 * NEW MODEL (per stage, independent of position):
 *   * `not-started` (grey)  — zero completed tasks
 *   * `in-progress` (purple) — at least one completed task, NOT all done
 *   * `done` (green)        — all tasks complete (and total > 0)
 *
 * **Multiple stages can be `in-progress` simultaneously.** That's
 * correct and intended. Empty stages (total=0) are `not-started`.
 *
 * Task coloring (consumed in TaskRow):
 *   * Done task → its stage's color (green if stage done, purple if
 *                                    stage in-progress)
 *   * Incomplete task → always grey
 *
 * For surfaces that need a SINGLE "focal point" (dashboard tile
 * headline, canvas auto-center, canvas pill anchor), use
 * `pickAnchorStage()`. Same picker rule across all surfaces keeps the
 * focal stage CONSISTENT between dashboard and canvas — there's no
 * "the dashboard says we're on Stage 3 but the canvas centered on
 * Stage 1" desync.
 *
 * History of replaced functions:
 *   * `deriveCurrentStage()`  — positional 3-branch rule; deleted
 *   * `stateForStage()`       — positional `passed/current/future`
 *                               classifier; deleted (its result was
 *                               only correct for single-current
 *                               pipelines)
 */

export type StageLike = {
  id: string;
  position: number;
};

export type StageCounts = Map<string, { total: number; completed: number }>;

/** Per-stage state. NEW model — state words, no position words. */
export type StageState = "not-started" | "in-progress" | "done";

/**
 * Classify a single stage from its task counts. Pure function — does
 * NOT consider position, other stages, or pipeline-level state.
 *
 * Rules:
 *   total === 0                  → "not-started" (empty stage)
 *   completed >= total           → "done"
 *   completed > 0 (& not done)   → "in-progress"
 *   completed === 0              → "not-started"
 */
export function stageStateFromCounts(counts: {
  total: number;
  completed: number;
}): StageState {
  if (counts.total === 0) return "not-started";
  if (counts.completed >= counts.total) return "done";
  if (counts.completed > 0) return "in-progress";
  return "not-started";
}

/**
 * Pick a single "focal" stage for surfaces that need one (dashboard
 * tile headline, canvas auto-center target, canvas pill anchor).
 *
 * Rule (locked Phase 4a step 5c, 2026-05-22):
 *   a. First in-progress (leftmost purple stage), ELSE
 *   b. First not-started (leftmost grey stage),    ELSE
 *   c. Last stage in the list (all-done case anchors on the final
 *      stage, where the user just finished)
 *
 * Returns null only when `stagesList` is empty.
 *
 * Same rule across canvas + dashboard so the focal stage is consistent
 * across surfaces — no desync between "what the dashboard says we're
 * on" and "what the canvas auto-centers on."
 *
 * Parallel-workstreams behavior: multiple in-progress stages → picker
 * returns the LEFTMOST. This is the "newest active step in workflow
 * order" by convention. If you want to override (e.g., "remember which
 * stage the user was last looking at"), add a per-user
 * last_active_stage_id field and prefer that here. Not in 5c.
 */
export function pickAnchorStage<S extends StageLike>(
  stagesList: S[],
  stageStates: Map<string, StageState>,
): S | null {
  if (stagesList.length === 0) return null;

  // (a) First in-progress.
  const inProgress = stagesList.find(
    (s) => stageStates.get(s.id) === "in-progress",
  );
  if (inProgress) return inProgress;

  // (b) First not-started.
  const notStarted = stagesList.find(
    (s) => stageStates.get(s.id) === "not-started",
  );
  if (notStarted) return notStarted;

  // (c) All done — anchor on the last stage.
  return stagesList[stagesList.length - 1];
}
