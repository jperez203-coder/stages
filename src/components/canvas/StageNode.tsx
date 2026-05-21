"use client";

import { useCallback, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { StageState } from "@/lib/current-stage";
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
   *  console.log; step 6 wires the task detail side panel. */
  onTaskClick: (taskId: string) => void;
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
}: Props) {
  const colors = COLORS[stage.state];
  const showAddRow = canEditPipeline;

  // Total height for the wrapper bounding box. Doesn't affect rendering
  // (children are stacked naturally), but documenting it here makes the
  // bbox math obvious.
  const totalHeight = computeStageNodeHeight(tasks.length, showAddRow);

  return (
    <div
      id={stage.id}
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
        opacity: stage.state === "done" ? 0.7 : 1,
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

      {/* Stage box — name + "Stage N · X/Y task" subtitle. */}
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

      {/* Task card stack. Indented from the stage box's left edge
          (TASK_STACK_PAD_LEFT) so cards read as "children" of the stage
          and the badge→task connector has visual room to land at the
          card edge. Vertical gap between cards = TASK_CARD_GAP. */}
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
              task={{ id: task.id, title: task.title, done: task.done }}
              stageState={stage.state}
              userCanToggle={userCanToggle}
              onToggleDone={onToggleDone}
              onTitleClick={onTaskClick}
            />
          );
        })}

        {showAddRow && (
          <AddTaskRow stageId={stage.id} onAddTask={onAddTask} />
        )}
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
    return (
      <button
        type="button"
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
