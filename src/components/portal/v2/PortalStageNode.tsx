"use client";

import {
  STAGE_NODE_WIDTH,
  BADGE_DIAMETER,
  BADGE_TO_BOX_GAP,
  BOX_HEIGHT,
  BOX_TO_TASKS_GAP,
  TASK_CARD_HEIGHT,
  TASK_CARD_GAP,
  TASK_STACK_PAD_LEFT,
  TASK_STACK_PAD_RIGHT,
  TASKS_START_Y,
  COLORS,
  computeStageNodeHeight,
} from "@/components/canvas/StageNode";
import type { StageState } from "@/lib/current-stage";
import type { VisibleTask } from "@/lib/portal-canvas-data";
import { PortalTaskRow } from "./PortalTaskRow";

/**
 * Portal stage node. Phase 4b-2-a follow-up (visual parity pass).
 *
 * Visually IDENTICAL to the agency canvas's StageNode — same numbered
 * circular badge, same state palette (in-progress purple / done green /
 * not-started grey), same stage box with name + subtitle, same
 * badge→task curved-SVG connectors, same task stack spacing.
 *
 * Geometry + COLORS palette are IMPORTED from the agency StageNode so
 * the two surfaces stay in lockstep. The agency canvas is unchanged
 * (only `export` keywords were added to its constants).
 *
 * Differences from agency StageNode (the only divergences):
 *   * NO dnd-kit / useSortable wrapper — no drag-reorder for stages
 *   * NO inline rename input on the stage name — read-only display
 *   * NO trash / delete button
 *   * NO +Add task affordance — clients don't author work
 *   * NO `useEditMode` context — the portal has no edit mode
 *   * NO done-state opacity dampening — actually KEPT; matches agency
 *   * Badge number sources from `displayPosition` (= filteredIndex + 1
 *     per the portal privacy rule) NOT the server's raw `stage.position`
 *     which would leak that hidden stages exist before this one
 *   * Subtitle reads "Stage {displayPosition} · X/Y task(s)" using the
 *     SAME filtered count
 *
 * Layout is absolute on the canvas plane; PortalCanvas computes the
 * stage's (x, y) and passes them in.
 */

type Props = {
  /** Stage VM with the FILTERED display position. `displayPosition`
   *  is 1..N over the visible stage set (= filteredIndex + 1), NEVER
   *  the server's raw position field. */
  stage: {
    id: string;
    name: string;
    displayPosition: number;
    state: StageState;
    completed: number;
    total: number;
  };
  /** Absolute position on the canvas plane. */
  x: number;
  y: number;
  /** Tasks for this stage, already filtered to client-visible. */
  tasks: VisibleTask[];
  /** Done toggle handler — passed through to each task row. */
  onToggleDone: (taskId: string, nextDone: boolean) => void;
  /** Task body click handler — opens detail (stubbed in 4b-2-a). */
  onOpenDetail: (taskId: string) => void;
};

export function PortalStageNode({
  stage,
  x,
  y,
  tasks,
  onToggleDone,
  onOpenDetail,
}: Props) {
  const colors = COLORS[stage.state];

  // Total visual height — reused agency helper. showAddRow=false
  // because clients never see the +Add affordance.
  const totalHeight = computeStageNodeHeight(tasks.length, false);

  return (
    <div
      id={stage.id}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: STAGE_NODE_WIDTH,
        height: totalHeight,
        // Done-state opacity dampening — matches agency exactly (0.7
        // for done stages so they recede). Same visual hierarchy:
        // greens mute, purples + greys stay full opacity.
        opacity: stage.state === "done" ? 0.7 : 1,
      }}
    >
      {/* Badge → task curved SVG connectors. Same path math as agency
          StageNode (bottom-CENTER of stage box → left edge of each
          task card, cubic Bezier with cp1 directly below start +
          cp2 at end's xy → drop-down-then-curve-left L-shape).
          pointerEvents: none so it never blocks card clicks. */}
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
            const startX = STAGE_NODE_WIDTH / 2;
            const startY = BADGE_DIAMETER + BADGE_TO_BOX_GAP + BOX_HEIGHT;
            const endX = TASK_STACK_PAD_LEFT;
            const endY =
              TASKS_START_Y +
              idx * (TASK_CARD_HEIGHT + TASK_CARD_GAP) +
              TASK_CARD_HEIGHT / 2;
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

      {/* Numbered badge — circular, state-colored. Shows the FILTERED
          displayPosition (not the raw server position) to preserve the
          portal privacy rule. Same geometry + palette + in-progress
          glow as agency. */}
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
        {stage.displayPosition}
      </div>

      {/* Stage box — name + "Stage N · X/Y task" subtitle. Read-only;
          no inline rename, no trash button. Same fill/border/typography
          as agency StageNode. The subtitle's "Stage N" uses
          displayPosition; "X/Y task" uses the FILTERED counts. */}
      <div
        style={{
          position: "relative",
          marginTop: BADGE_TO_BOX_GAP,
          width: STAGE_NODE_WIDTH,
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
          Stage {stage.displayPosition} · {stage.completed}/{stage.total} task
          {stage.total === 1 ? "" : "s"}
        </div>
      </div>

      {/* Task stack — same padding + gap as agency StageNode. Tasks
          render via PortalTaskRow (the read+toggle slim sibling of
          agency TaskRow). */}
      {tasks.length > 0 && (
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
          {tasks.map((t) => (
            <PortalTaskRow
              key={t.id}
              task={t}
              stageState={stage.state}
              onToggleDone={onToggleDone}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      )}
    </div>
  );
}
