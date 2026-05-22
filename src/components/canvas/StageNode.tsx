"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StageState } from "@/lib/current-stage";
import { useEditMode } from "@/components/chrome/EditModeContext";
import { TaskRow } from "./TaskRow";

/**
 * One stage on the pipeline canvas — numbered badge at top + stage box +
 * stack of task rows beneath + optional "+add task" affordance. Phase 4a
 * step 5c.
 *
 * Layout (top-to-bottom inside the node):
 *   1. Numbered badge (32px circle, left-aligned with box's left edge)
 *   2. 14px gap
 *   3. Stage box (220px wide, name + "Stage N · X/Y task" subtitle)
 *   4. 12px gap
 *   5. Task cards (one per task; height = TASK_CARD_HEIGHT each;
 *      vertical gap = TASK_CARD_GAP between cards)
 *   6. (if canEditPipeline) "+ Add task" affordance — collapsed button
 *      that expands to an inline input on click
 *
 * Stage node height is variable (depends on task count + whether the
 * +add row is shown). PipelineCanvas uses the exported layout constants
 * to compute the content bbox correctly. See `computeStageNodeHeight()`.
 *
 * Behind-the-scenes — the badge→task connector SVG:
 *   * One curved path per task, dimmed grey, low-opacity
 *   * Starts at the stage box's bottom-CENTER (5c annotation polish),
 *     curves down + left into each task card's left edge (where the
 *     left-edge dot on TaskRow sits)
 *   * pointerEvents: none so it never intercepts task card clicks
 *
 * Permission gating (UI mirrors the tightened RLS from
 * 20260521120000_tighten_member_task_update_to_assignee.sql):
 *   * Per-task checkbox interactive when canEditPipeline OR
 *     assignee_id === currentUserId
 *   * +add task affordance: canEditPipeline only
 *
 * The wrapper div carries the stage's `id` attribute so PipelineCanvas
 * can call `zoomToElement(stageId)` for auto-center + recenter actions.
 *
 * 5c stubs the red activity dot (top-right of badge) — slot exists,
 * never renders. Activity tracking wires up later.
 */

// Color tokens (locked — DO NOT redefine ad-hoc elsewhere).
// Keyed by the new StageState values from src/lib/current-stage.ts
// (post-5c annotation polish — the positional keys current/passed/
// future were renamed to in-progress/done/not-started). Hex values
// unchanged; only the keys moved.
const COLORS = {
  "in-progress": {
    badgeBg: "#6E5BE8",
    badgeText: "#FFFFFF",
    badgeBorder: "#6E5BE8",
    boxBg: "#6E5BE8",
    boxText: "#FFFFFF",
    boxSubtitle: "rgba(255,255,255,0.75)",
    boxBorder: "#6E5BE8",
  },
  done: {
    badgeBg: "#1F4535",
    badgeText: "#15B981",
    badgeBorder: "#15B981",
    boxBg: "#1F4535",
    boxText: "#15B981",
    boxSubtitle: "rgba(21,185,129,0.7)",
    boxBorder: "rgba(21,185,129,0.35)",
  },
  "not-started": {
    badgeBg: "#2C2C2F",
    badgeText: "#979393",
    badgeBorder: "#36363A",
    boxBg: "#2C2C2F",
    boxText: "#E4E4E7",
    boxSubtitle: "rgba(151,147,147,0.7)",
    boxBorder: "#36363A",
  },
} as const;

// Geometry (px in canvas-plane coordinates — scale with zoom).
const BADGE_DIAMETER = 32;
const BADGE_TO_BOX_GAP = 14;
// BOX_WIDTH bumped from 180 → 220 (5c annotation polish 2026-05-22) so
// full task titles ("Send DocuSign contract", "Conduct discovery
// interview") render without aggressive truncation. Stage cluster width
// grows ~200px overall; still fits a 1280px viewport at zoom 1.0.
const BOX_WIDTH = 220;
const BOX_HEIGHT = 64;
// Gap between the stage box's bottom edge and the FIRST task card's
// top. Tuned across two rounds: 12 (initial) → 22 (still tight) → 32
// (5c annotation polish 2026-05-22 round 4). The stage box now sits
// clearly above its task stack with breathing room; the SVG
// connector's arc has visible curve length to land on each task
// card's left-edge dot.
const BOX_TO_TASKS_GAP = 32;

// Task CARDS (post-figma annotation polish — Phase 4a step 5c). Each
// task renders as a self-contained card (TaskRow). Fixed height for
// predictable layout math.
//
// Tuned across rounds: 32 (initial) → 40 (round 5, 2026-05-22). The
// 32px height pinched the checkbox + title vertically; 40px reads as
// a more substantial card with breathing room around the content.
// **IMPORTANT — TaskRow.tsx hardcodes the same value as inline
// `height: 40`. If you change this constant, update there too.**
// Layout math (computeStageNodeHeight) + SVG connector geometry
// cascade automatically from this constant.
const TASK_CARD_HEIGHT = 40;
// TASK_CARD_GAP tuned across rounds: 6 (initial, too tight) → 10
// (annotation polish round 2) → 14 (round 4 — Jordan: "slightly more").
// 14px between cards keeps the inter-card spacing clearly LESS than
// the 32px stage→first-task gap, preserving the parent/child visual
// hierarchy while giving each task card distinct presence.
const TASK_CARD_GAP = 14;

// Indent on the task stack — cards sit visually inset from the stage
// box's left edge to read as "children" of the stage. The badge→task
// SVG connector terminates at this x-offset on each card.
const TASK_STACK_PAD_LEFT = 16;
const TASK_STACK_PAD_RIGHT = 4;

// "+ Add task" affordance dimensions — match TASK_CARD_HEIGHT so the
// affordance reads as the natural "next slot" in the card stack.
const ADD_TASK_ROW_HEIGHT = 40;
const TASK_LIST_TO_ADD_GAP = 6;

/** y-position (inside StageNode local coords) of the first task card's top. */
const TASKS_START_Y =
  BADGE_DIAMETER + BADGE_TO_BOX_GAP + BOX_HEIGHT + BOX_TO_TASKS_GAP;

/** Total visual height of a StageNode — depends on task count + whether
 *  the +add row is rendered. PipelineCanvas calls this for bbox math
 *  (the cluster's max height drives the content-bbox bottom).
 *
 *  Layout cases:
 *    0 tasks, no add row    → just the badge + box (TASKS_START_Y baseline)
 *    0 tasks, add row shown → badge + box + add row (no gap before it
 *                             since there are no tasks to gap from)
 *    N tasks, no add row    → badge + box + N cards + (N-1) gaps
 *    N tasks, add row shown → ...above + TASK_LIST_TO_ADD_GAP + add row
 */
export function computeStageNodeHeight(
  taskCount: number,
  showAddRow: boolean,
): number {
  let height = TASKS_START_Y;
  if (taskCount > 0) {
    height += taskCount * TASK_CARD_HEIGHT + (taskCount - 1) * TASK_CARD_GAP;
    if (showAddRow) {
      height += TASK_LIST_TO_ADD_GAP + ADD_TASK_ROW_HEIGHT;
    }
  } else if (showAddRow) {
    height += ADD_TASK_ROW_HEIGHT;
  }
  return height;
}

/** Pre-5c stage-only node height (badge + gap + box). Still exported for
 *  callers that don't care about tasks. */
export const STAGE_NODE_HEIGHT =
  BADGE_DIAMETER + BADGE_TO_BOX_GAP + BOX_HEIGHT;
export const STAGE_NODE_WIDTH = BOX_WIDTH;
export { BADGE_DIAMETER };

type TaskLike = {
  id: string;
  title: string;
  done: boolean;
  assignee_id: string | null;
};

type Props = {
  stage: {
    id: string;
    position: number;
    name: string;
    total: number;
    completed: number;
    state: StageState;
  };
  /** Tasks belonging to this stage, ordered by position ascending. */
  tasks: TaskLike[];
  /** Anchor coordinates in canvas-plane space — top-left of the node. */
  x: number;
  y: number;
  /** Calling user's id — for the per-task assignee gate. */
  currentUserId: string;
  /** Workspace owner OR pipeline owner/admin → can toggle any task +
   *  see the +add row. Mirrors can_edit_pipeline in app code. */
  canEditPipeline: boolean;
  /** Toggle a task's done state. Called by TaskRow on checkbox click;
   *  the parent (PipelineCanvas) handles optimistic update + UPDATE. */
  onToggleDone: (taskId: string, nextDone: boolean) => void;
  /** Add a new task to this stage. Called when the +add input is
   *  submitted; the parent invokes the create_task RPC. */
  onAddTask: (stageId: string, title: string) => void;
  /** Click on the task title body (NOT the checkbox). 5c stubs this to
   *  console.log in normal mode; in edit mode, TaskRow swaps in an
   *  inline rename input and calls onRenameTask instead — onTaskClick
   *  is unused while editing. Step 6 wires this to a detail panel. */
  onTaskClick: (taskId: string) => void;
  /** 5e — commit a new stage name (after inline edit). Direct UPDATE on
   *  stages.name in the parent; trim + non-empty handled here. */
  onRenameStage: (stageId: string, nextName: string) => void;
  /** 5e — open the parent's delete-confirm dialog for this stage. */
  onRequestDeleteStage: (stageId: string) => void;
  /** 5e — commit a new task title. Direct UPDATE on tasks.title in
   *  the parent. */
  onRenameTask: (taskId: string, nextTitle: string) => void;
};

export function StageNode({
  stage,
  tasks,
  x,
  y,
  currentUserId,
  canEditPipeline,
  onToggleDone,
  onAddTask,
  onTaskClick,
  onRenameStage,
  onRequestDeleteStage,
  onRenameTask,
}: Props) {
  // editMode flips the stage name into an editable input + reveals the
  // delete button + flips TaskRow's click behavior to inline rename +
  // enables the stage drag handle.
  const { editMode } = useEditMode();
  const colors = COLORS[stage.state];
  const showAddRow = canEditPipeline;

  // ── dnd-kit: stage as a sortable item (5e) ───────────────────────────
  // Disabled when not editMode + canEditPipeline so the stage isn't
  // grabbable in view mode. PointerSensor activation distance (8px,
  // set on the parent DndContext) means clicks within 8px still fire
  // through to the inline rename / delete handlers.
  //
  // Transition override (5e polish): tighter than the default 250ms
  // ease so the non-dragged stages "snap" into their new slot rather
  // than glide. cubic-bezier(0.2, 0, 0, 1) is a fast-in / slow-out
  // ease — perceived snappier than `ease` while still settling
  // smoothly. Pair this with DragOverlay (in PipelineCanvas) so the
  // DRAGGED stage doesn't re-render per frame: only the other stages
  // sliding to make room use this transition.
  const sortable = useSortable({
    id: stage.id,
    data: { type: "stage" },
    disabled: !editMode || !canEditPipeline,
    transition: {
      duration: 180,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    },
  });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    // While dragging, the live stage becomes an invisible placeholder
    // (opacity 0). The visible drag visual is rendered by DragOverlay
    // at the canvas level using StageDragGhost — that decouples the
    // pointer-following visual from this stage's heavy subtree
    // (SVG connector + N TaskRows + per-stage SortableContext), which
    // is the root cause of stage-drag jank when N is non-trivial.
    opacity: sortable.isDragging ? 0 : 1,
    zIndex: sortable.isDragging ? 20 : "auto",
  };

  // ── Per-stage SortableContext for task drag (5e) ─────────────────────
  // Each stage's tasks form their own sortable context (vertical). The
  // outer DndContext is shared, so tasks can be dragged ACROSS stages
  // too — onDragEnd at the canvas level handles cross-stage moves.
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);

  // ── Inline stage-rename state ────────────────────────────────────────
  const [isRenaming, setIsRenaming] = useState(false);
  const [pendingName, setPendingName] = useState(stage.name);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Reset pending name + close the input if the prop changes (e.g. a
  // concurrent edit landed via another device / optimistic revert).
  // Also auto-exit rename mode when editMode globally turns off — user
  // hit "Done editing" mid-rename; we drop the in-flight edit silently.
  // Reset on editMode toggle-off is intentionally a setState-in-effect:
  // we're synchronizing a context-driven external flag into local state.
  // React 19's `react-hooks/set-state-in-effect` flags this even though
  // the alternative (e.g. derive `effective = editMode && isRenaming`)
  // would mean a stale `isRenaming=true` carries across edit-mode
  // toggle cycles and surprises the user with an auto-resumed edit on
  // re-enter. Pre-existing similar pattern noted in 5d launch-prep
  // deferrals; deferred to a future React 19 purity sweep.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!editMode) {
      setIsRenaming(false);
      setPendingName(stage.name);
    }
  }, [editMode, stage.name]);

  const startRename = useCallback(() => {
    if (!editMode || !canEditPipeline) return;
    setPendingName(stage.name);
    setIsRenaming(true);
    // Focus on next tick — input not mounted yet.
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  }, [editMode, canEditPipeline, stage.name]);

  const submitRename = useCallback(() => {
    const cleaned = pendingName.trim();
    if (!cleaned || cleaned === stage.name) {
      // No-op: empty OR unchanged. Close the input, leave name as-is.
      setIsRenaming(false);
      setPendingName(stage.name);
      return;
    }
    onRenameStage(stage.id, cleaned);
    setIsRenaming(false);
  }, [pendingName, stage.name, stage.id, onRenameStage]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
    setPendingName(stage.name);
  }, [stage.name]);

  // Total height for the wrapper bounding box. Doesn't affect rendering
  // (children are stacked naturally), but documenting it here makes the
  // bbox math obvious.
  const totalHeight = computeStageNodeHeight(tasks.length, showAddRow);

  return (
    <div
      id={stage.id}
      // dnd-kit's setNodeRef is a callback ref + attributes/listeners
      // are event-handler bags — React 19's `react-hooks/refs` rule
      // flags these as "Cannot access refs during render" even though
      // callback refs are explicitly allowed to be assigned at render.
      // False positive for any drag-and-drop library following the
      // dnd-kit pattern.
      /* eslint-disable-next-line react-hooks/refs */
      ref={sortable.setNodeRef}
      /* eslint-disable-next-line react-hooks/refs */
      {...sortable.attributes}
      /* eslint-disable-next-line react-hooks/refs */
      {...sortable.listeners}
      // `pan-disabled` is read by PipelineCanvas's react-zoom-pan-pinch
      // `panning.excluded` list — anything with this class (or its
      // descendants) won't start a canvas pan on pointerdown.
      //
      // POST-5e FIX: conditional on (editMode && canEditPipeline) — i.e.
      // ONLY when useSortable is active. In normal mode, the stage is
      // not draggable (no reorder), so click-drag on a stage's
      // background should pan the canvas (matches the locked spec
      // "normal mode: click-drag anywhere pans"). In edit mode, the
      // class re-engages so dnd-kit owns drag-tracking on stages without
      // competing with the pan handler. Inner interactive elements
      // (checkbox, +Add task, etc.) keep their own exclusion via the
      // tag-name matchers — pan doesn't start on buttons regardless.
      className={editMode && canEditPipeline ? "pan-disabled" : undefined}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: STAGE_NODE_WIDTH,
        height: totalHeight,
        // Done-state opacity dampening — completed stages recede so
        // they don't compete visually with in-progress (purple) stages.
        // Previously keyed on "passed" (positional model); now keyed on
        // "done" (per-stage state model, 5c annotation polish). Same
        // visual intent: greens mute, purples + greys stay full
        // opacity. Multiple done stages can coexist; multiple
        // in-progress can coexist (parallel workstreams).
        // Note: when sortable.isDragging is true, dragStyle.opacity
        // (0.5) overrides this — that's correct (drag visual takes
        // priority over done-state dampening).
        opacity:
          sortable.isDragging
            ? dragStyle.opacity
            : stage.state === "done"
              ? 0.7
              : 1,
        transform: dragStyle.transform,
        transition: dragStyle.transition,
        zIndex: dragStyle.zIndex,
        // In edit mode the wrapper is the drag handle — show grab/
        // grabbing cursors. The actual sortable.listeners attached
        // above own pointer-capture; this is purely visual.
        cursor:
          editMode && canEditPipeline
            ? sortable.isDragging
              ? "grabbing"
              : "grab"
            : "default",
        // Disable touch-action so dnd-kit's pointer events aren't
        // swallowed by the browser's pan/zoom on touch devices.
        touchAction: editMode && canEditPipeline ? "none" : "auto",
      }}
    >
      {/* Badge→task connector SVG. Rendered absolutely under all other
          content so it lies behind the box + task rows visually.
          pointerEvents: none so it never blocks clicks. Single SVG with
          one path per task — cheaper than N separate SVGs. */}
      {tasks.length > 0 && (
        <svg
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: STAGE_NODE_WIDTH,
            height: totalHeight,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {tasks.map((task, idx) => {
            // Start point: bottom-CENTER of the stage box (5c annotation
            // polish — connectors originate from the box midline now,
            // not the left edge). Gives a balanced curve that reads as
            // "all tasks hang from the stage" instead of "left rail
            // branches into tasks."
            const startX = BOX_WIDTH / 2;
            const startY = BADGE_DIAMETER + BADGE_TO_BOX_GAP + BOX_HEIGHT;
            // End point: at the task CARD's left edge, vertically
            // centered on the card. Card top = TASKS_START_Y +
            // idx * (cardHeight + gap); center = top + cardHeight/2.
            // endX matches TASK_STACK_PAD_LEFT so the connector lands
            // exactly at the card's outer edge.
            const endX = TASK_STACK_PAD_LEFT;
            const endY =
              TASKS_START_Y +
              idx * (TASK_CARD_HEIGHT + TASK_CARD_GAP) +
              TASK_CARD_HEIGHT / 2;
            // Cubic Bezier biased for a "drop down then curve left"
            // L-shape with rounded corner. cp1 directly below start
            // forces straight-down launch; cp2 at end's xy forces
            // horizontal landing into the card edge.
            const cp1X = startX;
            const cp1Y = endY;
            const cp2X = endX;
            const cp2Y = endY;
            return (
              <path
                key={task.id}
                d={`M ${startX} ${startY} C ${cp1X} ${cp1Y} ${cp2X} ${cp2Y} ${endX} ${endY}`}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={1.5}
                fill="none"
              />
            );
          })}
        </svg>
      )}

      {/* Numbered badge — left-aligned with box's left edge (per figma). */}
      <div
        style={{
          position: "relative",
          width: BADGE_DIAMETER,
          height: BADGE_DIAMETER,
          borderRadius: "50%",
          background: colors.badgeBg,
          border: `1.5px solid ${colors.badgeBorder}`,
          color: colors.badgeText,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 600,
          boxShadow:
            stage.state === "in-progress"
              ? "0 2px 8px rgba(110,91,232,0.35)"
              : "none",
        }}
      >
        {stage.position}
        {/* Activity-dot slot — never renders in 5c (stub from 5b). */}
        <span
          aria-hidden
          style={{
            display: "none",
            position: "absolute",
            top: -2,
            right: -2,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#DF1E5A",
            border: "1.5px solid #212124",
          }}
        />
      </div>

      {/* Stage box — name + "Stage N · X/Y task" subtitle.
          5e: in edit mode, the name swaps to an inline input on click,
          and a small delete button (X / trash) appears in the
          top-right corner. The stage box itself doesn't change size in
          edit mode — only the affordances appear. */}
      <div
        style={{
          position: "relative",
          marginTop: BADGE_TO_BOX_GAP,
          width: BOX_WIDTH,
          minHeight: BOX_HEIGHT,
          padding: "10px 14px",
          background: colors.boxBg,
          border: `1px solid ${colors.boxBorder}`,
          borderRadius: 10,
          color: colors.boxText,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 4,
          boxShadow:
            stage.state === "in-progress"
              ? "0 4px 16px rgba(110,91,232,0.25)"
              : "none",
          boxSizing: "border-box",
        }}
      >
        {isRenaming ? (
          <input
            ref={nameInputRef}
            type="text"
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={submitRename}
            maxLength={80}
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.2,
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(255,255,255,0.3)",
              borderRadius: 4,
              color: colors.boxText,
              padding: "2px 6px",
              outline: "none",
              width: "100%",
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <div
            onClick={editMode && canEditPipeline ? startRename : undefined}
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              cursor: editMode && canEditPipeline ? "text" : "default",
              // Reserve room on the right for the delete button so the
              // ellipsis doesn't clip under it in edit mode.
              paddingRight: editMode && canEditPipeline ? 22 : 0,
            }}
          >
            {stage.name}
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: colors.boxSubtitle,
            lineHeight: 1.2,
            fontWeight: 500,
          }}
        >
          Stage {stage.position} · {stage.completed}/{stage.total} task
          {stage.total === 1 ? "" : "s"}
        </div>

        {/* Delete button — edit mode only, owner/admin only. Sits in
            the box's top-right corner; clicking opens the confirm
            dialog (state lives in PipelineCanvas). Uses a small trash
            glyph rather than X so it doesn't read as a "close" button. */}
        {editMode && canEditPipeline && !isRenaming && (
          <button
            type="button"
            aria-label={`Delete stage ${stage.name}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRequestDeleteStage(stage.id);
            }}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 22,
              height: 22,
              borderRadius: 6,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
              transition: "background 120ms ease-out, color 120ms ease-out",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(244,63,94,0.85)";
              e.currentTarget.style.color = "white";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(0,0,0,0.25)";
              e.currentTarget.style.color = "rgba(255,255,255,0.7)";
            }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Task card stack. Indented from the stage box's left edge
          (TASK_STACK_PAD_LEFT) so cards read as "children" of the stage
          and the badge→task connector has visual room to land at the
          card edge. Vertical gap between cards = TASK_CARD_GAP.
          5e: wrapped in a per-stage SortableContext so tasks reorder
          via dnd-kit within this stage. Cross-stage moves work via
          the shared outer DndContext + the parent's onDragEnd. */}
      <SortableContext
        items={taskIds}
        strategy={verticalListSortingStrategy}
      >
        <div
          style={{
            position: "relative",
            paddingTop: BOX_TO_TASKS_GAP,
            paddingLeft: TASK_STACK_PAD_LEFT,
            paddingRight: TASK_STACK_PAD_RIGHT,
            display: "flex",
            flexDirection: "column",
            gap: TASK_CARD_GAP,
          }}
        >
          {tasks.map((task) => {
            const userCanToggle =
              canEditPipeline || task.assignee_id === currentUserId;
            return (
              <TaskRow
                key={task.id}
                stageId={stage.id}
                task={{ id: task.id, title: task.title, done: task.done }}
                stageState={stage.state}
                userCanToggle={userCanToggle}
                canEditPipeline={canEditPipeline}
                onToggleDone={onToggleDone}
                onTitleClick={onTaskClick}
                onRenameTask={onRenameTask}
              />
            );
          })}

          {showAddRow && (
            <AddTaskRow stageId={stage.id} onAddTask={onAddTask} />
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// ─── StageDragGhost (5e polish — DragOverlay child) ──────────────────────

/**
 * Lightweight visual stand-in for a stage being dragged. Rendered
 * inside <DragOverlay> at the canvas level — DragOverlay positions
 * this in viewport coords following the pointer, via direct DOM
 * transform mutations (no React re-render per frame).
 *
 * What we deliberately DO NOT render here (the whole point):
 *   * The badge → task SVG connector
 *   * The task card stack + per-stage SortableContext + TaskRows
 *   * The trash button + inline rename input
 *   * useSortable / useEffect / any hook subscription
 *
 * What we DO render — just enough to feel like "I'm dragging THIS
 * stage": the badge with position number and the stage box with name
 * + subtitle + a "+ N tasks" hint line so the ghost still
 * communicates the stage's task count without paying to render each
 * task. Plus a translucent lift shadow so it reads as "floating
 * above the canvas."
 *
 * Colors come from the SAME COLORS map StageNode uses — keyed on
 * stage.state — so the ghost matches its source visually (purple if
 * in-progress, green if done, grey if not-started).
 */
export function StageDragGhost({
  stage,
}: {
  stage: {
    id: string;
    position: number;
    name: string;
    total: number;
    completed: number;
    state: StageState;
  };
}) {
  const colors = COLORS[stage.state];

  return (
    <div
      style={{
        width: STAGE_NODE_WIDTH,
        // Lift shadow + slight scale so the ghost reads as "above"
        // the canvas plane. No tilt — Linear / Figma don't tilt drag
        // ghosts; a tilt feels cartoonish here.
        filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.5))",
        // Match the StageNode's done-state opacity dampening so a
        // dragged done-stage ghost matches what the user sees in the
        // canvas.
        opacity: stage.state === "done" ? 0.85 : 1,
      }}
    >
      {/* Numbered badge — matches StageNode's badge geometry. */}
      <div
        style={{
          width: BADGE_DIAMETER,
          height: BADGE_DIAMETER,
          borderRadius: "50%",
          background: colors.badgeBg,
          border: `1.5px solid ${colors.badgeBorder}`,
          color: colors.badgeText,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 600,
          boxShadow:
            stage.state === "in-progress"
              ? "0 2px 8px rgba(110,91,232,0.35)"
              : "none",
        }}
      >
        {stage.position}
      </div>

      {/* Stage box — matches StageNode's box geometry. */}
      <div
        style={{
          marginTop: BADGE_TO_BOX_GAP,
          width: BOX_WIDTH,
          minHeight: BOX_HEIGHT,
          padding: "10px 14px",
          background: colors.boxBg,
          border: `1px solid ${colors.boxBorder}`,
          borderRadius: 10,
          color: colors.boxText,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 4,
          boxShadow:
            stage.state === "in-progress"
              ? "0 4px 16px rgba(110,91,232,0.25)"
              : "none",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {stage.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: colors.boxSubtitle,
            lineHeight: 1.2,
            fontWeight: 500,
          }}
        >
          Stage {stage.position} · {stage.completed}/{stage.total} task
          {stage.total === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}

// ─── + Add task affordance ───────────────────────────────────────────────

/**
 * Small affordance card at the bottom of a stage's task list. Collapsed
 * by default — renders as a card with a dashed border (to signal
 * "tap to add" / "this slot is empty") and "+ Add task" text. Click
 * expands to an inline title input. Enter submits via the create_task
 * RPC (handled by parent's onAddTask). Esc collapses. Blur with empty
 * title collapses; blur with text submits.
 *
 * Sized to match TASK_CARD_HEIGHT so the affordance reads as the
 * natural "next slot" in the card stack — same dimensions, same
 * spacing rhythm, just dashed instead of filled.
 *
 * After a successful submit the input clears + stays focused — rapid
 * multi-add for bulk entry. Matches the /my-tasks quick-add behavior.
 */
function AddTaskRow({
  stageId,
  onAddTask,
}: {
  stageId: string;
  onAddTask: (stageId: string, title: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = useCallback(() => {
    const cleaned = title.trim();
    if (!cleaned) {
      setExpanded(false);
      setTitle("");
      return;
    }
    onAddTask(stageId, cleaned);
    setTitle("");
    // Keep input focused for rapid multi-add.
    inputRef.current?.focus();
  }, [onAddTask, stageId, title]);

  const expand = useCallback(() => {
    setExpanded(true);
    // Focus on the next tick — input isn't mounted in collapsed state.
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  if (!expanded) {
    // Collapsed — card with dashed border, "+ Add task" inside.
    // Stop pointer-down propagation so clicking the affordance in
    // edit mode never starts the parent stage's drag.
    return (
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={expand}
        style={{
          height: ADD_TASK_ROW_HEIGHT,
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          background: "transparent",
          border: "1px dashed rgba(255,255,255,0.15)",
          borderRadius: 8,
          color: "rgba(255,255,255,0.45)",
          fontSize: 13,
          fontWeight: 500,
          textAlign: "left",
          cursor: "pointer",
          boxSizing: "border-box",
        }}
      >
        <Plus size={13} />
        Add task
      </button>
    );
  }

  // Expanded — same card geometry, but the dashed border softens to a
  // solid hairline + the inside is a text input.
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        height: ADD_TASK_ROW_HEIGHT,
        width: "100%",
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 8,
        boxSizing: "border-box",
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setExpanded(false);
            setTitle("");
          }
        }}
        onBlur={submit}
        placeholder="Task title…"
        maxLength={200}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          color: "white",
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          outline: "none",
        }}
      />
    </div>
  );
}
