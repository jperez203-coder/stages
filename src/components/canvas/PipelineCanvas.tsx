"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { EdgeFades } from "./EdgeFades";
import { CanvasCoachmark } from "./CanvasCoachmark";
import { StageIndicatorPill } from "./StageIndicatorPill";
import { ZoomControls } from "./ZoomControls";
import {
  StageNode,
  STAGE_NODE_WIDTH,
  STAGE_NODE_HEIGHT,
  BADGE_DIAMETER,
  computeStageNodeHeight,
} from "./StageNode";
import { StageConnector } from "./StageConnector";
import {
  pickAnchorStage,
  stageStateFromCounts,
  type StageState,
} from "@/lib/current-stage";
import { supabase } from "@/lib/supabase";
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
  stages,
  tasks: initialTasks,
  currentUserId,
  canEditPipeline,
}: Props) {
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // ── Live task state ────────────────────────────────────────────────────
  // The server hands us the initial array; we mutate locally on
  // optimistic updates + RPC successes. Re-derivation reads from this
  // state, so any change here propagates through the whole canvas
  // (counts, current stage, colors, connector states).
  const [tasksState, setTasksState] = useState<TaskRaw[]>(initialTasks);
  // Note: no useEffect to re-sync tasksState from initialTasks. Route
  // remount creates a new component when navigating to a different
  // pipeline-id, so initialTasks only changes on remount (when useState
  // re-initializes from the new prop). Adding a sync effect here would
  // trigger React 19's react-hooks/set-state-in-effect warning AND
  // overwrite local optimistic mutations on every re-render of the
  // parent.

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
    for (const s of stages) {
      const c = stageCounts.get(s.id) ?? { total: 0, completed: 0 };
      stageStates.set(s.id, stageStateFromCounts(c));
    }

    // Single anchor stage for auto-center + pill — picked by the
    // shared rule (first in-progress → first not-started → last).
    const anchor = pickAnchorStage(stages, stageStates);

    const vms: StageVM[] = stages.map((s) => {
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
    const n = stages.length;
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

      stages.forEach((s, idx) => {
        const x = startX + idx * (STAGE_NODE_WIDTH + STAGE_GAP);
        positions.set(s.id, { x, y: yTop });
      });

      // Tallest column's bottom = bbox.bottom. Each stage's height
      // depends on its task count + whether the +add row is shown
      // (canEditPipeline gates it).
      const tallestColumnBottom = stages.reduce((max, s) => {
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
  }, [stages, tasksState, tasksByStage, canEditPipeline]);

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
      }}
    >
      {/* 5a/5b/5c rendered a minimal "back arrow + pipeline name"
          placeholder header band INSIDE the canvas wrapper. Removed
          in 5d — the real chrome (PipelineHeader + LeftRail) lives
          OUTSIDE this component, wrapping it via PipelineChromeShell.
          The canvas is now purely the pan/zoom surface. */}

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
          // Exclude inputs + interactive descendants from triggering pan.
          // Without this, clicking on the +add task input or a task
          // checkbox could start a pan drag that swallows the click.
          excluded: ["input", "button", "[role=button]"],
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

          {stageVMs.length === 0 && (
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

          {/* Stage nodes — now with their tasks beneath. */}
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
              />
            );
          })}
        </TransformComponent>
      </TransformWrapper>

      <EdgeFades edges={edges} />
      <StageIndicatorPill
        current={currentPosition}
        total={stageVMs.length}
        onRecenter={onRecenter}
      />
      <ZoomControls onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />
      {!coachmarkInitiallyDismissed && (
        <CanvasCoachmark canvasRef={wrapperRef} />
      )}
    </div>
  );
}
