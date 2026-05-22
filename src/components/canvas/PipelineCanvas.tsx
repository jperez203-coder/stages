"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { EdgeFades } from "./EdgeFades";
import { CanvasCoachmark } from "./CanvasCoachmark";
import { StageIndicatorPill } from "./StageIndicatorPill";
import { ZoomControls } from "./ZoomControls";
import {
  StageNode,
  StageDragGhost,
  STAGE_NODE_WIDTH,
  STAGE_NODE_HEIGHT,
  BADGE_DIAMETER,
  computeStageNodeHeight,
} from "./StageNode";
import { StageConnector } from "./StageConnector";
import {
  AddStageEndButton,
  DeleteStageConfirmDialog,
  InsertStageHandle,
} from "./EditPipelineAffordances";
import {
  pickAnchorStage,
  stageStateFromCounts,
  type StageState,
} from "@/lib/current-stage";
import { supabase } from "@/lib/supabase";
import { useEditMode } from "@/components/chrome/EditModeContext";
import type {
  StageRaw,
  TaskRaw,
} from "@/app/w/(canvas)/[slug]/p/[pipeline-id]/page";

/**
 * Pipeline canvas — Phase 4a step 5c (tasks + completion + add).
 *
 * Builds on 5b's stage rendering. Each stage now renders its tasks as
 * checkbox + title rows beneath the box. Checking a task UPDATEs
 * tasks.done (the existing set_task_completion_metadata BEFORE UPDATE
 * trigger writes completed_at/_by; the auto_advance_stage trigger
 * writes pipelines.current_stage_id but we don't read it — derivation
 * stays the source of truth). After every toggle/create the client
 * re-runs deriveCurrentStage with updated task counts, recomputes
 * per-stage state, and re-renders — so colors advance live as the
 * pipeline progresses.
 *
 * Derivation moved from server-side (5b) to client-side here. Server
 * sends RAW stages + tasks; client computes counts, runs the helper,
 * builds StageViewModel locally. Both paths use the SAME helper
 * (src/lib/current-stage.ts) — no second implementation.
 *
 * Permission gating mirrors the tightened RLS exactly:
 *   * canEditPipeline = workspace owner OR pipeline owner/admin →
 *     can toggle any task, sees +add task affordance
 *   * Otherwise: per-task interactivity gated by
 *     task.assignee_id === currentUserId
 *
 * Still NOT in scope:
 *   * Task detail panel (step 6) — clicking task ROW (not checkbox)
 *     is stubbed to console.log
 *   * Left rail + header chrome (5d)
 *   * Edit pipeline mode (5e)
 *   * Client portal — client_visible filtering NOT applied here (4c)
 */

type Props = {
  pipelineId: string;
  coachmarkInitiallyDismissed: boolean;
  stages: StageRaw[];
  tasks: TaskRaw[];
  currentUserId: string;
  canEditPipeline: boolean;
};

const PLANE_W = 4000;
const PLANE_H = 4000;
const PLANE_CX = PLANE_W / 2;
const PLANE_CY = PLANE_H / 2;
const STAGE_GAP = 100;
const BBOX_PADDING = 40;

// Result of running deriveCurrentStage + stateForStage across all stages.
type StageVM = {
  id: string;
  position: number;
  name: string;
  total: number;
  completed: number;
  state: StageState;
};

export function PipelineCanvas({
  pipelineId,
  coachmarkInitiallyDismissed,
  stages: initialStages,
  tasks: initialTasks,
  currentUserId,
  canEditPipeline,
}: Props) {
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // ── Edit mode (5e) ─────────────────────────────────────────────────────
  // editMode comes from EditModeContext mounted at PipelineChromeShell.
  // When true:
  //   * thin blue (#108CE9) top-border on the canvas wrapper signals the
  //     mode change at-a-glance
  //   * zoom controls are hidden; zoom snaps to 1.0 on entry
  //   * stage / task drag affordances activate (8px-distance PointerSensor)
  //   * task click → inline rename (vs the step-6 stub in normal mode)
  //   * stage add / rename / delete affordances render
  const { editMode } = useEditMode();

  // ── Live stage + task state (5e: stagesState now optimistic too) ───────
  // The server hands us the initial arrays; we mutate locally on
  // optimistic updates + RPC successes. Re-derivation reads from these
  // states, so any change here propagates through the whole canvas
  // (counts, current stage, colors, connector states, layout positions).
  //
  // 5c (pre-5e) only mutated tasksState — stages was read directly from
  // the prop. 5e introduces structural stage mutations (add, rename,
  // reorder, delete), so stagesState mirrors tasksState's pattern: the
  // prop seeds initial state, and all mutations land in setStagesState.
  //
  // No useEffect to re-sync from props: route remount creates a new
  // component on navigation to a different pipeline-id, so initial
  // arrays only change on remount (when useState re-initializes from
  // the new prop). Adding a sync effect here would trigger React 19's
  // react-hooks/set-state-in-effect warning AND overwrite local
  // optimistic mutations on every re-render of the parent.
  const [stagesState, setStagesState] = useState<StageRaw[]>(initialStages);
  const [tasksState, setTasksState] = useState<TaskRaw[]>(initialTasks);

  // ── Tasks-by-stage map (for StageNode prop + counts derivation) ───────
  const tasksByStage = useMemo(() => {
    const map = new Map<string, TaskRaw[]>();
    for (const t of tasksState) {
      const list = map.get(t.stage_id) ?? [];
      list.push(t);
      map.set(t.stage_id, list);
    }
    // Sort each stage's tasks by position ascending (matches the
    // server's order, but the optimistic add-task path appends to the
    // end which can violate ordering if positions aren't strictly
    // monotonic — re-sort defensively).
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [tasksState]);

  // ── Live derivation ────────────────────────────────────────────────────
  // Recomputes on every tasksState change. NEW model (5c annotation
  // polish 2026-05-22): per-stage state is independent of position —
  // each stage is classified from its own task counts via
  // stageStateFromCounts. Multiple stages can be "in-progress" at once.
  // The single "anchor" stage (for auto-center + pill) is picked
  // separately via pickAnchorStage.
  const { stageVMs, anchorStageId, layout } = useMemo(() => {
    const stageCounts = new Map<
      string,
      { total: number; completed: number }
    >();
    for (const t of tasksState) {
      const c = stageCounts.get(t.stage_id) ?? { total: 0, completed: 0 };
      c.total += 1;
      if (t.done) c.completed += 1;
      stageCounts.set(t.stage_id, c);
    }

    // Per-stage state classification — pure function of each stage's
    // own counts. Build the state map first, THEN pick the anchor.
    const stageStates = new Map<string, StageState>();
    for (const s of stagesState) {
      const c = stageCounts.get(s.id) ?? { total: 0, completed: 0 };
      stageStates.set(s.id, stageStateFromCounts(c));
    }

    // Single anchor stage for auto-center + pill — picked by the
    // shared rule (first in-progress → first not-started → last).
    const anchor = pickAnchorStage(stagesState, stageStates);

    const vms: StageVM[] = stagesState.map((s) => {
      const c = stageCounts.get(s.id) ?? { total: 0, completed: 0 };
      return {
        id: s.id,
        position: s.position,
        name: s.name,
        total: c.total,
        completed: c.completed,
        state: stageStates.get(s.id) ?? "not-started",
      };
    });

    // Layout coords (same math as 5b — stages laid out left-to-right
    // centered on plane center). The stage NODE height now varies per
    // stage because of task counts + the +add row; we compute the
    // tallest column's bottom for bbox below.
    const n = stagesState.length;
    const positions = new Map<string, { x: number; y: number }>();
    let bbox: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    } | null = null;

    if (n > 0) {
      const totalWidth = n * STAGE_NODE_WIDTH + (n - 1) * STAGE_GAP;
      const startX = PLANE_CX - totalWidth / 2;
      const yTop = PLANE_CY - STAGE_NODE_HEIGHT / 2;

      stagesState.forEach((s, idx) => {
        const x = startX + idx * (STAGE_NODE_WIDTH + STAGE_GAP);
        positions.set(s.id, { x, y: yTop });
      });

      // Tallest column's bottom = bbox.bottom. Each stage's height
      // depends on its task count + whether the +add row is shown
      // (canEditPipeline gates it).
      const tallestColumnBottom = stagesState.reduce((max, s) => {
        const taskCount = tasksByStage.get(s.id)?.length ?? 0;
        const h = computeStageNodeHeight(taskCount, canEditPipeline);
        const bottom = yTop + h;
        return Math.max(max, bottom);
      }, yTop + STAGE_NODE_HEIGHT);

      bbox = {
        left: startX - BBOX_PADDING,
        right: startX + totalWidth + BBOX_PADDING,
        top: yTop - BBOX_PADDING,
        bottom: tallestColumnBottom + BBOX_PADDING,
      };
    }

    return {
      stageVMs: vms,
      anchorStageId: anchor?.id ?? null,
      layout: { positions, bbox },
    };
  }, [stagesState, tasksState, tasksByStage, canEditPipeline]);

  // ── Edge-fade visibility ──────────────────────────────────────────────
  const [edges, setEdges] = useState({
    left: false,
    right: false,
    top: false,
    bottom: false,
  });

  const recomputeEdges = useCallback(
    (positionX: number, positionY: number, scale: number) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !layout.bbox) return;
      const W = wrapper.clientWidth;
      const H = wrapper.clientHeight;
      const planeLeft = -positionX / scale;
      const planeRight = (W - positionX) / scale;
      const planeTop = -positionY / scale;
      const planeBottom = (H - positionY) / scale;
      const EPS = 1;
      setEdges({
        left: layout.bbox.left + EPS < planeLeft,
        right: layout.bbox.right - EPS > planeRight,
        top: layout.bbox.top + EPS < planeTop,
        bottom: layout.bbox.bottom - EPS > planeBottom,
      });
    },
    [layout.bbox],
  );

  // ── Edit-mode entry: snap zoom to 1.0 on the anchor stage ─────────────
  // Brief is "lock zoom to 1.0" for edit mode. We snap on entry and DON'T
  // restore on exit (user can re-zoom if needed; restoring would surprise
  // a user who's done a bunch of edits and now wants to keep looking at
  // the same scale). zoomToElement re-centers on the anchor at scale 1,
  // which doubles as a nice "you're in edit mode now, here's where the
  // action is" moment. Falls back to centerView when there are no stages
  // (empty pipeline).
  //
  // The wheel-zoom activation keys are unchanged (still Cmd/Ctrl+wheel),
  // but with ZoomControls hidden + no programmatic zoom calls in this
  // mode, only an intentional Cmd-wheel can change scale during edit.
  // Acceptable — the brief doesn't say "disable zoom entirely," just
  // "lock to 1.0 + hide controls."
  useEffect(() => {
    if (!editMode) return;
    const ref = transformRef.current;
    if (!ref) return;
    if (anchorStageId) {
      const el = document.getElementById(anchorStageId);
      if (el) {
        ref.zoomToElement(anchorStageId, 1, 280, "easeOut");
        return;
      }
    }
    ref.centerView(1, 280, "easeOut");
    // Intentionally only depends on editMode — we want the snap on the
    // RISING edge of edit mode, not every time the anchor recomputes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  // ── Custom wheel handler (pan semantics — unchanged from 5a/5b) ───────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return;
      if (!transformRef.current) return;

      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.shiftKey && Math.abs(dx) < 0.01) {
        dx = dy;
        dy = 0;
      }

      const { positionX, positionY, scale } = transformRef.current.state;
      transformRef.current.setTransform(
        positionX - dx,
        positionY - dy,
        scale,
        0,
      );
    };

    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, []);

  // ── Task mutation: toggle done ────────────────────────────────────────
  // Optimistic update + UPDATE via the supabase client. The tightened
  // tasks_update RLS gates the write (member can only toggle their own
  // assigned tasks); the UI gate in StageNode → TaskRow mirrors that, so
  // the server-side reject path should rarely fire — but we still revert
  // optimistic state if it does, so the UI stays truthful.
  //
  // set_task_completion_metadata (BEFORE UPDATE) fires server-side on
  // `done` flip — writes completed_at + completed_by on done=true,
  // clears on done=false. auto_advance_stage (AFTER UPDATE) writes
  // pipelines.current_stage_id but we don't read it; harmless.
  const toggleTaskDone = useCallback(
    async (taskId: string, nextDone: boolean) => {
      // Optimistic: flip done locally. The useMemo re-derives
      // immediately — stage counts update, current stage may advance,
      // colors recompute.
      setTasksState((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                done: nextDone,
                // completed_at + completed_by reflect what the trigger
                // will write — keep them in sync with the optimistic
                // done. The server will overwrite with the canonical
                // values on next fetch, but the optimistic shape is
                // close enough for any client-side reads in the same
                // tick.
                completed_at: nextDone ? new Date().toISOString() : null,
                completed_by: nextDone ? currentUserId : null,
              }
            : t,
        ),
      );

      const { error } = await supabase
        .from("tasks")
        .update({ done: nextDone })
        .eq("id", taskId);

      if (error) {
        // Revert the optimistic update — UI snaps back to truthful.
        console.error(
          "[canvas] toggleTaskDone failed; reverting optimistic update:",
          error.message,
        );
        setTasksState((prev) =>
          prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  done: !nextDone,
                  completed_at: !nextDone ? new Date().toISOString() : null,
                  completed_by: !nextDone ? currentUserId : null,
                }
              : t,
          ),
        );
      }
    },
    [currentUserId],
  );

  // ── Task mutation: add task via create_task RPC ───────────────────────
  // Only callable for owner/admin (UI gate hides the affordance from
  // members). The RPC re-enforces server-side via can_edit_pipeline so
  // members can't bypass via direct call.
  const addTask = useCallback(
    async (stageId: string, title: string) => {
      const { data, error } = await supabase.rpc("create_task", {
        stage_id: stageId,
        title,
      });
      if (error || !data) {
        console.error(
          "[canvas] addTask via create_task failed:",
          error?.message,
        );
        return;
      }

      type CreateResult = {
        id: string;
        stage_id: string;
        title: string;
        position: number;
        assignee_id: string;
        deadline: string | null;
        created_at: string;
      };
      const result = data as CreateResult;

      // Append the new task to local state. Re-derivation re-runs via
      // useMemo dependency on tasksState. Stage subtitle (X/Y task)
      // updates immediately.
      setTasksState((prev) => [
        ...prev,
        {
          id: result.id,
          stage_id: result.stage_id,
          position: result.position,
          title: result.title,
          done: false,
          assignee_id: result.assignee_id,
          completed_at: null,
          completed_by: null,
        },
      ]);
    },
    [],
  );

  // ── Task row click — step 6 stub ──────────────────────────────────────
  const onTaskClick = useCallback(
    (taskId: string) => {
      // Step 6 wires this to the task detail side panel. For 5c, log
      // the intent so we can verify the wiring without a panel.
      console.log(
        "[canvas 5c] task row clicked (body, not checkbox). step 6 opens detail panel.",
        { taskId, pipelineId },
      );
    },
    [pipelineId],
  );

  // ── 5e: stage mutation — add (append or insert-between) ───────────────
  // Calls create_stage RPC. after_stage_id null = append; non-null =
  // insert immediately after that stage (RPC shifts subsequent
  // positions +1 server-side). Appends to local state on success and
  // re-fetches positions from the RPC return value to stay consistent
  // with the server's shift.
  const addStage = useCallback(
    async (name: string, afterStageId: string | null) => {
      const { data, error } = await supabase.rpc("create_stage", {
        pipeline_id: pipelineId,
        name,
        after_stage_id: afterStageId,
      });
      if (error || !data) {
        console.error("[canvas 5e] create_stage failed:", error?.message);
        return;
      }

      type CreateStageResult = {
        id: string;
        pipeline_id: string;
        name: string;
        position: number;
      };
      const result = data as CreateStageResult;

      // For insert-between: RPC shifted server-side positions, but our
      // local stagesState is stale. Cheapest correct fix is to apply
      // the same shift locally based on the returned position.
      setStagesState((prev) => {
        const shifted = afterStageId
          ? prev.map((s) =>
              s.position >= result.position ? { ...s, position: s.position + 1 } : s,
            )
          : prev;
        return [
          ...shifted,
          { id: result.id, position: result.position, name: result.name },
        ].sort((a, b) => a.position - b.position);
      });
    },
    [pipelineId],
  );

  // ── 5e: stage mutation — rename (direct UPDATE, no RPC) ────────────────
  // Direct UPDATE on stages.name — RLS already gates this via the
  // can_edit_pipeline policy on tasks/stages tables. No new RPC needed
  // (per the 5e backend note in PROGRESS.md). Optimistic update +
  // revert on error matches the toggleTaskDone pattern.
  const renameStage = useCallback(
    async (stageId: string, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed) return; // empty rename = no-op (caller should handle)

      let prevName: string | undefined;
      setStagesState((prev) =>
        prev.map((s) => {
          if (s.id !== stageId) return s;
          prevName = s.name;
          return { ...s, name: trimmed };
        }),
      );

      const { error } = await supabase
        .from("stages")
        .update({ name: trimmed })
        .eq("id", stageId);

      if (error) {
        console.error("[canvas 5e] renameStage failed; reverting:", error.message);
        if (prevName !== undefined) {
          setStagesState((prev) =>
            prev.map((s) => (s.id === stageId ? { ...s, name: prevName! } : s)),
          );
        }
      }
    },
    [],
  );

  // ── 5e: stage mutation — delete (direct DELETE, no RPC) ────────────────
  // Tasks cascade via the existing tasks_stage_id_fkey ON DELETE CASCADE.
  // Locally we drop the stage's tasks too so the canvas re-derives
  // immediately. Revert on error restores BOTH the stage and its tasks.
  const deleteStage = useCallback(
    async (stageId: string) => {
      let removedStage: StageRaw | undefined;
      let removedTasks: TaskRaw[] = [];

      setStagesState((prev) => {
        const found = prev.find((s) => s.id === stageId);
        if (found) removedStage = found;
        return prev.filter((s) => s.id !== stageId);
      });
      setTasksState((prev) => {
        removedTasks = prev.filter((t) => t.stage_id === stageId);
        return prev.filter((t) => t.stage_id !== stageId);
      });

      const { error } = await supabase
        .from("stages")
        .delete()
        .eq("id", stageId);

      if (error) {
        console.error("[canvas 5e] deleteStage failed; reverting:", error.message);
        if (removedStage) {
          setStagesState((prev) =>
            [...prev, removedStage!].sort((a, b) => a.position - b.position),
          );
        }
        if (removedTasks.length > 0) {
          setTasksState((prev) => [...prev, ...removedTasks]);
        }
      }
    },
    [],
  );

  // ── 5e: stage mutation — reorder via reorder_stages RPC ────────────────
  // Caller passes ALL stage ids in the desired new order. RPC rewrites
  // all positions atomically. Local optimistic update assigns position
  // by index (1-based, matching RPC behavior). Revert on error restores
  // the pre-call ordering.
  const reorderStages = useCallback(
    async (orderedStageIds: string[]) => {
      let prevSnapshot: StageRaw[] = [];
      setStagesState((prev) => {
        prevSnapshot = prev;
        const byId = new Map(prev.map((s) => [s.id, s]));
        return orderedStageIds
          .map((id, idx) => {
            const s = byId.get(id);
            return s ? { ...s, position: idx + 1 } : null;
          })
          .filter((s): s is StageRaw => s !== null);
      });

      const { error } = await supabase.rpc("reorder_stages", {
        pipeline_id: pipelineId,
        ordered_stage_ids: orderedStageIds,
      });

      if (error) {
        console.error(
          "[canvas 5e] reorder_stages failed; reverting:",
          error.message,
        );
        setStagesState(prevSnapshot);
      }
    },
    [pipelineId],
  );

  // ── 5e: task mutation — rename (direct UPDATE, no RPC) ─────────────────
  const renameTask = useCallback(
    async (taskId: string, nextTitle: string) => {
      const trimmed = nextTitle.trim();
      if (!trimmed) return;

      let prevTitle: string | undefined;
      setTasksState((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          prevTitle = t.title;
          return { ...t, title: trimmed };
        }),
      );

      const { error } = await supabase
        .from("tasks")
        .update({ title: trimmed })
        .eq("id", taskId);

      if (error) {
        console.error("[canvas 5e] renameTask failed; reverting:", error.message);
        if (prevTitle !== undefined) {
          setTasksState((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, title: prevTitle! } : t)),
          );
        }
      }
    },
    [],
  );

  // ── 5e: task mutation — move (cross-stage OR within-stage) ─────────────
  // Calls move_task RPC. The RPC clamps target_position inclusive-end
  // (within-stage [1, count]; cross-stage [1, count+1]) and shifts the
  // surrounding tasks server-side. Local optimistic update mirrors that
  // shift so the UI doesn't pop on the round-trip.
  const moveTask = useCallback(
    async (taskId: string, targetStageId: string, targetPosition: number) => {
      let prevSnapshot: TaskRaw[] = [];

      setTasksState((prev) => {
        prevSnapshot = prev;
        const task = prev.find((t) => t.id === taskId);
        if (!task) return prev;
        const sourceStageId = task.stage_id;
        const sourcePos = task.position;

        // Build a clamped target position matching the RPC: within-stage
        // [1, count]; cross-stage [1, count+1].
        const targetStageTaskCount = prev.filter(
          (t) => t.stage_id === targetStageId,
        ).length;
        const maxPos =
          sourceStageId === targetStageId
            ? targetStageTaskCount
            : targetStageTaskCount + 1;
        const clamped = Math.max(1, Math.min(targetPosition, maxPos));

        if (sourceStageId === targetStageId) {
          // Within-stage shift.
          return prev.map((t) => {
            if (t.id === taskId) return { ...t, position: clamped };
            if (t.stage_id !== sourceStageId) return t;
            if (clamped > sourcePos) {
              if (t.position > sourcePos && t.position <= clamped) {
                return { ...t, position: t.position - 1 };
              }
            } else if (clamped < sourcePos) {
              if (t.position >= clamped && t.position < sourcePos) {
                return { ...t, position: t.position + 1 };
              }
            }
            return t;
          });
        }

        // Cross-stage: source-stage tasks above sourcePos shift down,
        // target-stage tasks at-or-after clamped shift up, the moved
        // task lands in the target at clamped.
        return prev.map((t) => {
          if (t.id === taskId) {
            return { ...t, stage_id: targetStageId, position: clamped };
          }
          if (t.stage_id === sourceStageId && t.position > sourcePos) {
            return { ...t, position: t.position - 1 };
          }
          if (t.stage_id === targetStageId && t.position >= clamped) {
            return { ...t, position: t.position + 1 };
          }
          return t;
        });
      });

      const { error } = await supabase.rpc("move_task", {
        task_id: taskId,
        target_stage_id: targetStageId,
        target_position: targetPosition,
      });

      if (error) {
        console.error("[canvas 5e] move_task failed; reverting:", error.message);
        setTasksState(prevSnapshot);
      }
    },
    [],
  );

  // ── 5e: task mutation — reorder within stage via reorder_tasks RPC ─────
  // Caller passes ALL task ids in the stage in desired new order. RPC
  // rewrites positions atomically. We could equivalently call move_task
  // for single-position moves; reorder_tasks_in_stage is preferred for
  // larger reorderings or when we already have the full new sequence.
  const reorderTasksInStage = useCallback(
    async (stageId: string, orderedTaskIds: string[]) => {
      let prevSnapshot: TaskRaw[] = [];

      setTasksState((prev) => {
        prevSnapshot = prev;
        const posById = new Map(orderedTaskIds.map((id, i) => [id, i + 1]));
        return prev.map((t) =>
          t.stage_id === stageId && posById.has(t.id)
            ? { ...t, position: posById.get(t.id)! }
            : t,
        );
      });

      const { error } = await supabase.rpc("reorder_tasks_in_stage", {
        stage_id: stageId,
        ordered_task_ids: orderedTaskIds,
      });

      if (error) {
        console.error(
          "[canvas 5e] reorder_tasks_in_stage failed; reverting:",
          error.message,
        );
        setTasksState(prevSnapshot);
      }
    },
    [],
  );

  // ── 5e: dnd-kit drag-and-drop wiring ───────────────────────────────────
  // ONE DndContext lives at the canvas level. Stages are sortable
  // (horizontal). Tasks are sortable within their stage's per-StageNode
  // SortableContext. The onDragEnd handler discriminates by active.data
  // .type ('stage' | 'task'):
  //   * 'stage' → reorder_stages with new ordered ids
  //   * 'task' → either reorder_tasks_in_stage (same source/target
  //     stage) or move_task (cross-stage). Target position comes from
  //     the over item: a task's position if over.data.type === 'task',
  //     or append-to-end if over.data.type === 'stage'.
  //
  // 8px distance activation is THE critical config: a click on a stage
  // name (or a task title in edit mode) inside the 8px threshold opens
  // inline rename. A drag past 8px starts dnd-kit's tracking. Without
  // this you'd have to choose between draggable OR clickable per element.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const stageIds = useMemo(() => stagesState.map((s) => s.id), [stagesState]);

  // ── 5e polish: DragOverlay for STAGE drag (not tasks) ──────────────────
  // Tracks which stage is actively being dragged so DragOverlay can
  // render a lightweight ghost following the pointer. The live stage
  // node hides (opacity 0) during the drag — without this, the heavy
  // StageNode subtree (SVG + N TaskRows + per-stage SortableContext)
  // re-renders every pointer-move frame as its `transform` updates,
  // which stutters visibly with 5+ tasks per stage.
  //
  // Why only stages: TaskRows are lightweight enough that the per-
  // frame re-render on task drag is imperceptible (Jordan confirmed
  // task drag feels fine). DragOverlay for tasks would be extra code
  // for no observable benefit.
  const [activeStageDragId, setActiveStageDragId] = useState<string | null>(
    null,
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as
      | { type: "stage" }
      | { type: "task"; stageId: string }
      | undefined;
    if (data?.type === "stage") {
      setActiveStageDragId(event.active.id as string);
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveStageDragId(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      // Always clear the overlay ghost first — early-returns below
      // would otherwise leave a stuck ghost on no-op drags.
      setActiveStageDragId(null);

      const { active, over } = event;
      if (!over) return;
      if (active.id === over.id) return;

      const activeData = active.data.current as
        | { type: "stage" }
        | { type: "task"; stageId: string }
        | undefined;
      const overData = over.data.current as
        | { type: "stage" }
        | { type: "task"; stageId: string }
        | undefined;

      if (!activeData) return;

      // ── Stage reorder ────────────────────────────────────────────────
      if (activeData.type === "stage") {
        const oldIndex = stagesState.findIndex((s) => s.id === active.id);
        const newIndex = stagesState.findIndex((s) => s.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        const newOrder = arrayMove(
          stagesState.map((s) => s.id),
          oldIndex,
          newIndex,
        );
        void reorderStages(newOrder);
        return;
      }

      // ── Task drag (within OR cross stage) ────────────────────────────
      if (activeData.type === "task") {
        const sourceStageId = activeData.stageId;
        const taskId = active.id as string;

        // Determine target stage + position from the over item.
        let targetStageId: string;
        let targetPosition: number;

        if (overData?.type === "task") {
          targetStageId = overData.stageId;
          const overTask = tasksState.find((t) => t.id === over.id);
          if (!overTask) return;
          targetPosition = overTask.position;
        } else if (overData?.type === "stage") {
          // Dropped on a stage container with no task at cursor — append.
          targetStageId = over.id as string;
          const targetCount = tasksState.filter(
            (t) => t.stage_id === targetStageId,
          ).length;
          // For same-stage drop on container → clamp to count (RPC
          // also clamps within-stage to [1, count]); for cross-stage →
          // count + 1 (append slot).
          targetPosition =
            targetStageId === sourceStageId ? targetCount : targetCount + 1;
        } else {
          return;
        }

        if (sourceStageId === targetStageId) {
          // Within-stage reorder via reorder_tasks_in_stage. We compute
          // the new full ordering locally (arrayMove) and ship the full
          // id list — matches the RPC's "must include all task ids"
          // contract.
          const stageTasks = tasksState
            .filter((t) => t.stage_id === sourceStageId)
            .sort((a, b) => a.position - b.position);
          const oldIndex = stageTasks.findIndex((t) => t.id === taskId);
          let newIndex: number;
          if (overData?.type === "task") {
            newIndex = stageTasks.findIndex((t) => t.id === over.id);
          } else {
            newIndex = stageTasks.length - 1; // drop on container = last
          }
          if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
          const newOrder = arrayMove(
            stageTasks.map((t) => t.id),
            oldIndex,
            newIndex,
          );
          void reorderTasksInStage(sourceStageId, newOrder);
        } else {
          // Cross-stage move via move_task.
          void moveTask(taskId, targetStageId, targetPosition);
        }
      }
    },
    [stagesState, tasksState, reorderStages, reorderTasksInStage, moveTask],
  );

  // ── 5e: delete-confirm dialog state ────────────────────────────────────
  // Single dialog at canvas level (avoids per-stage modal mounts). Click
  // on a stage delete button sets pendingDeleteId; the dialog reads
  // name + task count from current state and confirms via deleteStage().
  // Cancel clears the id.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const requestDeleteStage = useCallback((stageId: string) => {
    setPendingDeleteId(stageId);
  }, []);
  const cancelDeleteStage = useCallback(() => {
    setPendingDeleteId(null);
  }, []);
  const confirmDeleteStage = useCallback(() => {
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    if (id) void deleteStage(id);
  }, [pendingDeleteId, deleteStage]);

  // ── Imperative controls (unchanged from 5b) ───────────────────────────
  const onRecenter = useCallback(() => {
    if (anchorStageId) {
      transformRef.current?.zoomToElement(
        anchorStageId,
        1,
        280,
        "easeOut",
      );
    } else {
      transformRef.current?.centerView(1, 280, "easeOut");
    }
  }, [anchorStageId]);

  const onZoomIn = useCallback(() => {
    transformRef.current?.zoomIn(0.25, 200, "easeOut");
  }, []);
  const onZoomOut = useCallback(() => {
    transformRef.current?.zoomOut(0.25, 200, "easeOut");
  }, []);
  const onFit = useCallback(() => {
    onRecenter();
  }, [onRecenter]);

  // Current stage's position (for the pill text). Recomputes on every
  // re-derive — pill counter is live alongside the colors.
  const currentPosition = useMemo(() => {
    if (!anchorStageId) return 1;
    const found = stageVMs.find((s) => s.id === anchorStageId);
    return found?.position ?? 1;
  }, [anchorStageId, stageVMs]);

  return (
    <div
      ref={wrapperRef}
      className="flex-1"
      data-pipeline-id={pipelineId}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#212124",
        cursor: "grab",
        // 5e: thin blue (#108CE9 = stages-blue) top-border when edit
        // mode is active — the canvas's at-a-glance "you're editing"
        // signal, paired with the header toggle button. We render a
        // 2px transparent border in normal mode so layout doesn't
        // shift on toggle.
        borderTop: editMode ? "2px solid #108CE9" : "2px solid transparent",
        transition: "border-color 160ms ease-out",
      }}
    >
      {/* 5a/5b/5c rendered a minimal "back arrow + pipeline name"
          placeholder header band INSIDE the canvas wrapper. Removed
          in 5d — the real chrome (PipelineHeader + LeftRail) lives
          OUTSIDE this component, wrapping it via PipelineChromeShell.
          The canvas is now purely the pan/zoom surface. */}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
        // autoScroll fights with the react-zoom-pan-pinch surface
        // (there's no scrollable container to autoscroll IN), and an
        // active drag near the canvas edge would jitter as dnd-kit
        // tried to scroll a non-scrollable parent. Off in both modes.
        autoScroll={false}
      >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.25}
        maxScale={2}
        limitToBounds={false}
        centerOnInit={false}
        smooth
        wheel={{
          activationKeys: (keys: string[]) =>
            keys.includes("Meta") || keys.includes("Control"),
          step: 0.03,
        }}
        pinch={{ step: 5 }}
        panning={{
          velocityDisabled: false,
          allowLeftClickPan: true,
          // 5e POST-COMMIT FIX: dropped "[role=button]" from this list.
          // react-zoom-pan-pinch's isExcludedNode constructs the matcher
          //   `.wrapper {x}, .wrapper .{x}, .wrapper {x} *, .wrapper .{x} *`
          // and calls `node.matches(selectorList)`. For x = "[role=button]"
          // the second selector resolves to `.wrapper .[role=button]`
          // which is MALFORMED CSS — browsers throw `SyntaxError`. With
          // a single throwing entry in the list, the entire `matches()`
          // call throws, propagating out of isExcludedNode and aborting
          // the whole pan-start check. The result: click-drag pan on
          // empty canvas was silently broken on every browser since 5c
          // (when [role=button] was first added) — wheel-pan still worked
          // so it slipped past testing.
          //
          // Replacement uses tag-name + class-name entries only (both
          // round-trip cleanly through the matcher). dnd-kit-managed
          // stage/task drag exclusion comes from `pan-disabled` class
          // which is now CONDITIONALLY applied (editMode + canEditPipeline)
          // in StageNode + TaskRow — so in normal mode, click-drag on a
          // stage's background ALSO pans (matches the locked spec:
          // normal mode has no drag-reorder, nothing should capture pan).
          excluded: [
            "input",
            "button",
            "pan-disabled",
          ],
        }}
        trackPadPanning={{ disabled: true }}
        doubleClick={{ disabled: true }}
        onInit={(ref) => {
          requestAnimationFrame(() => {
            if (anchorStageId) {
              const el = document.getElementById(anchorStageId);
              if (!el) {
                console.warn(
                  "[canvas] auto-center: current stage element not found:",
                  anchorStageId,
                );
                ref.centerView(1, 0);
              } else {
                ref.zoomToElement(anchorStageId, 1, 0);
              }
            } else {
              ref.centerView(1, 0);
            }
            requestAnimationFrame(() => {
              const s = ref.state;
              recomputeEdges(s.positionX, s.positionY, s.scale);
            });
          });
        }}
        onTransform={(_ref, state) =>
          recomputeEdges(state.positionX, state.positionY, state.scale)
        }
      >
        <TransformComponent
          wrapperStyle={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
          }}
          contentStyle={{
            width: PLANE_W,
            height: PLANE_H,
            position: "relative",
          }}
        >
          {/* Dotted-grid background. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "radial-gradient(circle, #4A4A4A 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              pointerEvents: "none",
            }}
          />

          {stageVMs.length === 0 && !editMode && (
            <div
              style={{
                position: "absolute",
                left: PLANE_CX - 110,
                top: PLANE_CY - 24,
                width: 220,
                padding: "12px 16px",
                background: "rgba(33,33,36,0.85)",
                border: "1px dashed #4A4A50",
                borderRadius: 10,
                color: "rgba(255,255,255,0.6)",
                fontSize: 13,
                textAlign: "center",
                fontStyle: "italic",
              }}
            >
              no stages yet
            </div>
          )}

          {/* 5e: when empty + edit mode, the placeholder becomes an
              actionable "+ Add first stage" affordance — clicking opens
              the inline title input. Replaces (not augments) the
              "no stages yet" italic pill so the surface doesn't double up. */}
          {stageVMs.length === 0 && editMode && canEditPipeline && (
            <AddStageEndButton
              x={PLANE_CX - 16}
              y={PLANE_CY - 16}
              onAdd={(name) => addStage(name, null)}
            />
          )}

          {/* Badge-to-badge connectors (5b — between adjacent stages,
              horizontal, state-driven solid/dashed/grey). */}
          {stageVMs.length >= 2 &&
            stageVMs.slice(0, -1).map((left, idx) => {
              const right = stageVMs[idx + 1];
              const leftPos = layout.positions.get(left.id);
              const rightPos = layout.positions.get(right.id);
              if (!leftPos || !rightPos) return null;
              const leftBadgeCx = leftPos.x + BADGE_DIAMETER / 2;
              const rightBadgeCx = rightPos.x + BADGE_DIAMETER / 2;
              const badgeCy = leftPos.y + BADGE_DIAMETER / 2;
              const fromX = leftBadgeCx + BADGE_DIAMETER / 2;
              const toX = rightBadgeCx - BADGE_DIAMETER / 2;
              return (
                <StageConnector
                  key={`${left.id}->${right.id}`}
                  fromX={fromX}
                  toX={toX}
                  y={badgeCy}
                  leftState={left.state}
                  rightState={right.state}
                />
              );
            })}

          {/* 5e: gap-hover "+" insert-between affordances. One per gap
              between adjacent stages. Only render in edit mode + when
              the user can edit. Hit area = full gap × badge row height
              (32px); the "+" pill is invisible until hovered. Clicking
              calls create_stage(after_stage_id = LEFT stage of the gap). */}
          {editMode &&
            canEditPipeline &&
            stageVMs.length >= 2 &&
            stageVMs.slice(0, -1).map((left) => {
              const leftPos = layout.positions.get(left.id);
              if (!leftPos) return null;
              return (
                <InsertStageHandle
                  key={`insert-${left.id}`}
                  afterStageId={left.id}
                  x={leftPos.x + STAGE_NODE_WIDTH}
                  y={leftPos.y}
                  hitWidth={STAGE_GAP}
                  hitHeight={BADGE_DIAMETER}
                  onInsert={(afterStageId, name) =>
                    addStage(name, afterStageId)
                  }
                />
              );
            })}

          {/* Stage nodes — now with their tasks beneath. 5e adds
              rename / delete / drag affordances inside StageNode when
              editMode is true (read via useEditMode in StageNode).
              SortableContext (horizontal) makes stages reorderable as
              a row when their useSortable is active (editMode +
              canEditPipeline). Tasks have their own per-stage
              SortableContext inside StageNode. */}
          <SortableContext
            items={stageIds}
            strategy={horizontalListSortingStrategy}
          >
            {stageVMs.map((s) => {
              const pos = layout.positions.get(s.id);
              if (!pos) return null;
              return (
                <StageNode
                  key={s.id}
                  stage={s}
                  tasks={tasksByStage.get(s.id) ?? []}
                  x={pos.x}
                  y={pos.y}
                  currentUserId={currentUserId}
                  canEditPipeline={canEditPipeline}
                  onToggleDone={toggleTaskDone}
                  onAddTask={addTask}
                  onTaskClick={onTaskClick}
                  onRenameStage={renameStage}
                  onRequestDeleteStage={requestDeleteStage}
                  onRenameTask={renameTask}
                />
              );
            })}
          </SortableContext>

          {/* 5e: persistent "+ add stage" end button — only visible in
              edit mode + only to owner/admin. Lives at the right edge
              of the cluster, vertically centered on the badge row. */}
          {editMode && canEditPipeline && layout.bbox && (
            <AddStageEndButton
              x={layout.bbox.right - BBOX_PADDING + 12}
              y={PLANE_CY - BADGE_DIAMETER / 2}
              onAdd={(name) => addStage(name, null)}
            />
          )}
        </TransformComponent>
      </TransformWrapper>

      {/* 5e polish: DragOverlay portals to document.body and
          positions itself in viewport coords following the pointer
          delta. The child renders ONCE on dragStart — dnd-kit
          updates the overlay's transform directly via DOM mutation,
          so no React re-render per frame. This is what makes stage
          reorder feel Linear-smooth even with 5+ tasks per stage.
          dropAnimation:null skips the "snap into place on drop"
          animation since our optimistic state update already snaps
          the source stage to its new spot. */}
      <DragOverlay dropAnimation={null}>
        {activeStageDragId
          ? (() => {
              const s = stageVMs.find((v) => v.id === activeStageDragId);
              return s ? <StageDragGhost stage={s} /> : null;
            })()
          : null}
      </DragOverlay>
      </DndContext>

      <EdgeFades edges={edges} />
      <StageIndicatorPill
        current={currentPosition}
        total={stageVMs.length}
        onRecenter={onRecenter}
      />
      {/* 5e: zoom controls hidden in edit mode (zoom snapped + locked
          to 1.0 in edit mode per the locked spec). */}
      {!editMode && (
        <ZoomControls
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          onFit={onFit}
        />
      )}
      {!coachmarkInitiallyDismissed && (
        <CanvasCoachmark canvasRef={wrapperRef} />
      )}

      {/* 5e: delete-stage confirm dialog. Rendered at the canvas root
          (outside the TransformWrapper) so it sits in fixed viewport
          coords — pan/zoom can't move it off-screen. Looks up name +
          live task count from local state on every render so the copy
          reflects the latest counts (e.g. if a task drops in during
          confirmation). */}
      {pendingDeleteId && (() => {
        const stage = stagesState.find((s) => s.id === pendingDeleteId);
        if (!stage) return null;
        const taskCount = tasksState.filter(
          (t) => t.stage_id === pendingDeleteId,
        ).length;
        return (
          <DeleteStageConfirmDialog
            stageName={stage.name}
            taskCount={taskCount}
            onCancel={cancelDeleteStage}
            onConfirm={confirmDeleteStage}
          />
        );
      })()}
    </div>
  );
}
