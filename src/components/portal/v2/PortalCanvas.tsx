"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { supabase } from "@/lib/supabase";
import {
  pickAnchorStage,
  stageStateFromCounts,
  type StageState,
} from "@/lib/current-stage";
import {
  STAGE_NODE_WIDTH,
  BADGE_DIAMETER,
  computeStageNodeHeight,
} from "@/components/canvas/StageNode";
import { StageConnector } from "@/components/canvas/StageConnector";
import { ZoomControls } from "@/components/canvas/ZoomControls";
import type {
  PortalCanvasData,
  VisibleTask,
} from "@/lib/portal-canvas-data";
import { PortalStageNode } from "./PortalStageNode";
import { PortalCanvasEmptyState } from "./PortalCanvasEmptyState";
import { PortalTaskDetailPanel } from "./PortalTaskDetailPanel";

/**
 * Client portal canvas. Phase 4b-2-a.
 *
 * Read-only "project journey" view for the client:
 *   * pan/zoom shell (react-zoom-pan-pinch) — same plane size + scale
 *     limits as the agency canvas, no edit-mode visual treatment
 *   * stages rendered LEFT-to-RIGHT, filtered to those with ≥1
 *     client-visible task (others are dropped entirely — no visual
 *     trace of hidden stages)
 *   * per-stage state colors derived from stageStateFromCounts over
 *     the FILTERED task counts — the locked helpers in current-stage.ts
 *     are reused untouched
 *   * anchor stage picked via pickAnchorStage over the FILTERED set;
 *     auto-center on mount targets the anchor
 *   * "Stage X of Y" pill in the top-right uses FILTERED counts only —
 *     leaks no information about hidden stages
 *   * task done toggle is functional: optimistic UPDATE via the
 *     browser supabase client; revert + console.error on failure
 *
 * ─── PRIVACY FOREVER-RULE — DO NOT VIOLATE ─────────────────────────
 *
 *   Every count, label, position, and connector in this view must
 *   reflect the FILTERED stage/task set ONLY. The raw server data
 *   (which may include hidden stages and tasks for agency previewers
 *   even when the explicit filter strips them — but let's be defensive
 *   anyway) is for the server's eyes; clients see only their slice.
 *
 *   Specifically:
 *     * Stage layout x-position uses `filteredIndex` (0..N-1 over the
 *       visible stage set), NOT the server's `stage.position` (which
 *       has gaps where hidden stages sat).
 *     * Stage ordinals ("Stage 2 of 4") use `filteredIndex + 1` and
 *       `visibleStages.length`, never raw `stage.position` or
 *       `stages.length`.
 *     * Per-stage task counts ("3 tasks") reflect client-visible tasks
 *       only — agency-only tasks must never bump the displayed count.
 *
 *   The fetch helper (fetchPortalCanvasData) already applies both
 *   RLS + explicit client_visible=true filters server-side, so the
 *   raw data arriving here SHOULD already be the client's slice.
 *   This component compounds that with its own re-indexing so the
 *   surface is robust to any future fetch change.
 *
 *   See CLAUDE.md "Client visibility scope" (rule 3 of the four
 *   critical isolation rules).
 *
 * ─── SCOPE BOUNDARIES (4b-2-a) ─────────────────────────────────────
 *   * Task click → console.log stub. PortalTaskDetailPanel ships in
 *     4b-2-b; this commit reserves the call site.
 *   * No realtime — matches agency canvas. Refresh to see new state.
 *   * No edit mode, no dnd-kit, no +Add task, no inline rename, no
 *     delete. Read + done-toggle only.
 */

// Layout-plane dimensions match the agency canvas so the pan/zoom feel
// is identical. Stages render centered horizontally on the plane.
const PLANE_W = 4000;
const PLANE_H = 4000;
const PLANE_CX = PLANE_W / 2;
const PLANE_CY = PLANE_H / 2;
const STAGE_GAP = 100;

// Stage VM: filtered stage + state. `filteredIndex` is the 0..N-1
// position over the visible set (NOT the server's `position` field).
// `total`/`completed` are filtered-task counts (visible-tasks-only).
type StageVM = {
  id: string;
  name: string;
  filteredIndex: number;
  state: StageState;
  tasks: VisibleTask[];
  total: number;
  completed: number;
};

type Props = {
  data: PortalCanvasData;
  /** Pipeline display name — threaded from canvas/page.tsx into the
   *  task detail panel's breadcrumb ("Pipeline › Stage"). Falls back
   *  to empty string if the pipeline name fetch returned nothing
   *  (shouldn't happen since layout-level auth gating already
   *  confirmed the pipeline exists for this caller). */
  pipelineName: string;
};

export function PortalCanvas({ data, pipelineName }: Props) {
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  // Outer wrapper ref — used by the custom wheel→pan handler below to
  // attach the listener at the canvas-area level (so the wheel event
  // is intercepted before the browser would absorb it into page scroll
  // or the canvas would silently swallow it).
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // ── Custom wheel handler (pan semantics) ────────────────────────────
  // Mirrors agency PipelineCanvas's wheel handler. The TransformWrapper
  // config below sets `wheel.activationKeys` to require Cmd/Ctrl —
  // without this handler, plain (non-Cmd) wheel scrolls would be
  // silently swallowed: the TransformWrapper ignores them, the canvas
  // overflow:hidden absorbs them, and nothing visible happens. That's
  // the "canvas feels locked" symptom.
  //
  // This handler:
  //   * preventDefault on every wheel — stops any browser-level
  //     scrolling on the canvas area
  //   * if Cmd/Ctrl held → return early, let TransformWrapper's
  //     built-in handler take over (zoom)
  //   * otherwise → manually pan by the wheel delta via setTransform
  //   * Shift+wheel with no horizontal delta → swap dx/dy so the
  //     trackpad's vertical wheel becomes a horizontal pan (matches
  //     agency exactly)
  //
  // The empty deps array is intentional — the wrapperRef + transformRef
  // are stable across renders, and we want to attach exactly once.
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

  // Local tasks state — seeded from the server prop. Mutated by the
  // optimistic done-toggle handler; reverts on UPDATE failure.
  const [tasksState, setTasksState] = useState<VisibleTask[]>(data.tasks);

  // 4b-2-b: open task id for the slide-in PortalTaskDetailPanel.
  // Null = panel closed. Clicking a task title sets this; the panel's
  // onClose clears it.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // ── Group tasks by stage (after any local optimistic mutations) ───
  const tasksByStage = useMemo(() => {
    const map = new Map<string, VisibleTask[]>();
    for (const t of tasksState) {
      const list = map.get(t.stage_id) ?? [];
      list.push(t);
      map.set(t.stage_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return map;
  }, [tasksState]);

  // ── Derive visible stages + states + anchor + layout ─────────────
  // PRIVACY: every value here comes from the FILTERED set. Never feed
  // raw server position into anything user-visible.
  const { stageVMs, anchorStageId, layoutPositions } = useMemo(() => {
    // Filter to stages with ≥1 client-visible task. Stages with zero
    // visible tasks are dropped entirely — no trace in layout or pill.
    const filteredStages = data.stages
      .filter((s) => (tasksByStage.get(s.id)?.length ?? 0) > 0)
      .sort((a, b) => a.position - b.position);

    // Compute per-stage state from the FILTERED counts.
    const stageStates = new Map<string, StageState>();
    for (const s of filteredStages) {
      const tasks = tasksByStage.get(s.id) ?? [];
      const total = tasks.length;
      const completed = tasks.filter((t) => t.done).length;
      stageStates.set(s.id, stageStateFromCounts({ total, completed }));
    }

    // Anchor for auto-center + pill — over the FILTERED set.
    // pickAnchorStage operates on a list of {id, position}-like items;
    // we pass filteredStages directly (it has the server `position`
    // field still, but pickAnchorStage doesn't index by it — only
    // uses array order to choose first/last).
    const anchor = pickAnchorStage(filteredStages, stageStates);

    // Build VMs with filteredIndex (0..N-1) for downstream rendering.
    // total/completed reflect FILTERED task counts (client-visible only)
    // — leaking the underlying total would defeat the privacy rule.
    const vms: StageVM[] = filteredStages.map((s, i) => {
      const stageTasks = tasksByStage.get(s.id) ?? [];
      const total = stageTasks.length;
      const completed = stageTasks.filter((t) => t.done).length;
      return {
        id: s.id,
        name: s.name,
        filteredIndex: i,
        state: stageStates.get(s.id) ?? "not-started",
        tasks: stageTasks,
        total,
        completed,
      };
    });

    // Layout: stages centered horizontally on the plane, evenly spaced.
    // X positions derived from `filteredIndex` only.
    const n = vms.length;
    const totalWidth =
      n > 0 ? n * STAGE_NODE_WIDTH + (n - 1) * STAGE_GAP : 0;
    const startX = PLANE_CX - totalWidth / 2;
    const positions = new Map<string, { x: number; y: number; h: number }>();
    for (const vm of vms) {
      const x = startX + vm.filteredIndex * (STAGE_NODE_WIDTH + STAGE_GAP);
      // Use computeStageNodeHeight with showAddRow=false — clients
      // don't get an add affordance, so the stage height accounts only
      // for the stage box + task cards.
      const h = computeStageNodeHeight(vm.tasks.length, false);
      positions.set(vm.id, { x, y: PLANE_CY, h });
    }

    // Dev-only diagnostic: if everything renders grey unexpectedly,
    // this log shows the computed state per stage so we can confirm
    // whether the policy fired correctly (grey = no visible tasks done
    // from the client's view, per CLAUDE.md rule 3 — the client's
    // slice). Stripped from production builds.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(
        "[portal canvas] computed stage states:",
        Object.fromEntries([...stageStates.entries()]),
      );
    }

    return {
      stageVMs: vms,
      anchorStageId: anchor?.id ?? null,
      layoutPositions: positions,
    };
  }, [data.stages, tasksByStage]);

  // ── Done toggle — optimistic with revert ──────────────────────────
  // RLS allows clients to UPDATE done on client_visible tasks
  // (migration 20260521120000). The enforce_client_task_update_scope
  // trigger restricts the column set to `done` only, so even if this
  // call accidentally tried to update something else, the server
  // would reject it.
  const onToggleDone = useCallback(
    async (taskId: string, nextDone: boolean) => {
      const snapshot = tasksState;
      setTasksState((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, done: nextDone } : t)),
      );

      const { error } = await supabase
        .from("tasks")
        .update({ done: nextDone })
        .eq("id", taskId);

      if (error) {
        console.error("[portal canvas] toggle done failed:", error);
        setTasksState(snapshot);
      }
    },
    [tasksState],
  );

  // 4b-2-b: open the task detail panel for the clicked task. The
  // single source of truth for which task is open lives in this
  // canvas component; the panel itself reads the task data via a
  // lookup on tasksState each render (so any toggle from the panel
  // OR the card propagates to the other view in one render pass —
  // see PortalTaskDetailPanel header for the sync rationale).
  const onOpenDetail = useCallback((taskId: string) => {
    setOpenTaskId(taskId);
  }, []);

  // ── Zoom controls — same signatures as agency PipelineCanvas:1153-1161
  //    so the visual + interaction model is identical. ZoomControls is
  //    reused from @/components/canvas/ZoomControls (shared component,
  //    no portal-specific variant needed).
  const onZoomIn = useCallback(() => {
    transformRef.current?.zoomIn(0.25, 200, "easeOut");
  }, []);
  const onZoomOut = useCallback(() => {
    transformRef.current?.zoomOut(0.25, 200, "easeOut");
  }, []);
  const onFit = useCallback(() => {
    // Re-center on the anchor stage if there is one; otherwise frame
    // the whole plane. Mirrors agency onRecenter / onFit behavior.
    if (anchorStageId) {
      transformRef.current?.zoomToElement(anchorStageId, 1, 280, "easeOut");
    } else {
      transformRef.current?.centerView(1, 280, "easeOut");
    }
  }, [anchorStageId]);

  // Empty state when no stages have visible tasks.
  if (stageVMs.length === 0) {
    return <PortalCanvasEmptyState />;
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        flex: 1,
        position: "relative",
        background: "#212124",
        overflow: "hidden",
        // Grab/grabbing cursor over empty canvas — same as agency
        // PipelineCanvas:1180. Indicates "you can drag to pan."
        // react-zoom-pan-pinch handles the grab→grabbing transition
        // during active drag at the library level.
        cursor: "grab",
      }}
    >
      {/* "Stage X of Y" pill — top-right. Uses FILTERED counts. The
          anchor stage drives "X"; visible-stage count drives "Y". */}
      {anchorStageId && (
        <StageCountPill
          anchorIndex={
            stageVMs.find((vm) => vm.id === anchorStageId)?.filteredIndex ?? 0
          }
          total={stageVMs.length}
        />
      )}

      {/* Bottom-right zoom controls — same shared component the agency
          canvas uses, same callback shape. Matches the figma layout
          (zoom controls bottom-right, persistent across zoom levels). */}
      <ZoomControls
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onFit={onFit}
      />

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
          // Same pan-exclusion shape as the agency canvas. The portal
          // has no dnd-kit, so no `pan-disabled` carve-outs are needed
          // for drag-handle areas — but excluding the interactive
          // elements (the done-toggle button + the title button)
          // keeps click-vs-pan reliable.
          excluded: ["input", "button"],
        }}
        trackPadPanning={{ disabled: true }}
        doubleClick={{ disabled: true }}
        onInit={(ref) => {
          // Auto-center on the anchor stage on mount. Same pattern as
          // agency canvas — defer one frame so the DOM element exists.
          requestAnimationFrame(() => {
            if (anchorStageId) {
              const el = document.getElementById(anchorStageId);
              if (el) {
                ref.zoomToElement(anchorStageId, 1, 0);
              } else {
                ref.centerView(1, 0);
              }
            } else {
              ref.centerView(1, 0);
            }
          });
        }}
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
          {/* Dotted-grid background — single shared source of truth.
              The dim treatment (was an inline opacity:0.4 here) is
              now baked into the .dotted-grid CSS rule itself, so this
              surface and every other dotted surface in the app share
              the same look without per-call-site overrides. Visual
              unchanged from before. */}
          <div
            aria-hidden="true"
            className="dotted-grid"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          />

          {/* Badge-to-badge inter-stage connectors. Reuses the shared
              StageConnector component (agency canvas's exact visual:
              solid/dashed/grey per the locked 3×3 state-pair matrix —
              done→any solid green, in-progress→in-progress solid
              purple, in-progress→not-started dashed purple,
              not-started→any inert grey). Same state-pair rules apply
              to the portal — the visual language stays consistent. */}
          {stageVMs.length >= 2 &&
            stageVMs.slice(0, -1).map((leftVM, i) => {
              const rightVM = stageVMs[i + 1];
              const leftPos = layoutPositions.get(leftVM.id);
              const rightPos = layoutPositions.get(rightVM.id);
              if (!leftPos || !rightPos) return null;
              // Badge centerline = stage.y + BADGE_DIAMETER/2 (matches
              // agency PipelineCanvas's connector positioning exactly).
              const badgeCy = leftPos.y + BADGE_DIAMETER / 2;
              const fromX = leftPos.x + BADGE_DIAMETER;
              const toX = rightPos.x;
              return (
                <StageConnector
                  key={`${leftVM.id}->${rightVM.id}`}
                  fromX={fromX}
                  toX={toX}
                  y={badgeCy}
                  leftState={leftVM.state}
                  rightState={rightVM.state}
                />
              );
            })}

          {/* Stage nodes — each positions itself absolutely on the
              plane via the (x, y) we pass in. PortalStageNode owns
              its own absolute positioning (mirrors agency StageNode). */}
          {stageVMs.map((vm) => {
            const pos = layoutPositions.get(vm.id);
            if (!pos) return null;
            return (
              <PortalStageNode
                key={vm.id}
                stage={{
                  id: vm.id,
                  name: vm.name,
                  displayPosition: vm.filteredIndex + 1,
                  state: vm.state,
                  completed: vm.completed,
                  total: vm.total,
                }}
                x={pos.x}
                y={pos.y}
                tasks={vm.tasks}
                onToggleDone={onToggleDone}
                onOpenDetail={onOpenDetail}
              />
            );
          })}
        </TransformComponent>
      </TransformWrapper>

      {/* 4b-2-b: PortalTaskDetailPanel. Rendered at the canvas root
          (outside TransformWrapper) so it sits in fixed viewport coords
          — pan/zoom can't move it off-screen. Mounts only when openTaskId
          is set AND that task is still present in tasksState (defensive:
          a task that vanished mid-session implies the panel auto-closes
          by virtue of not rendering). The panel's lookup-from-tasksState
          pattern means any onToggleDone from either the panel OR the
          card propagates to both views in one render. */}
      {openTaskId &&
        (() => {
          const task = tasksState.find((t) => t.id === openTaskId);
          if (!task) {
            // Task gone — defensive self-close. Shouldn't happen on the
            // portal surface (no delete UI) but covers any future path
            // where the data could disappear underneath an open panel.
            return null;
          }
          const stage = stageVMs.find((s) => s.id === task.stage_id);
          const stageName = stage?.name ?? "";
          return (
            <PortalTaskDetailPanel
              task={task}
              pipelineName={pipelineName}
              stageName={stageName}
              onClose={() => setOpenTaskId(null)}
              onToggleDone={onToggleDone}
            />
          );
        })()}
    </div>
  );

}

// ─── Stage count pill ──────────────────────────────────────────────────
// Compact top-right indicator: "Stage 2 of 4". Uses FILTERED counts
// only — passing total = visibleStages.length here, NOT stages.length.

function StageCountPill({
  anchorIndex,
  total,
}: {
  anchorIndex: number;
  total: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        right: 16,
        zIndex: 10,
        padding: "6px 12px",
        background: "rgba(28,28,30,0.9)",
        border: "1px solid #36363A",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: "rgba(255,255,255,0.75)",
        backdropFilter: "blur(8px)",
      }}
    >
      Stage {anchorIndex + 1} of {total}
    </div>
  );
}


