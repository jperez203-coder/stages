"use client";

import { Check } from "lucide-react";
import type { StageState } from "@/lib/current-stage";
import {
  COMPLETED,
  INCOMPLETE,
} from "@/components/canvas/TaskRow";
import {
  TASK_CARD_HEIGHT,
} from "@/components/canvas/StageNode";
import type { VisibleTask } from "@/lib/portal-canvas-data";

/**
 * Portal task card. Phase 4b-2-a follow-up (visual parity pass).
 *
 * Visually IDENTICAL to the agency canvas's TaskRow — same card
 * geometry, fill/border palette, checkbox treatment (two-mode for
 * completed cards), left-edge connector dot, font sizes, padding.
 *
 * The styling constants + state palettes are IMPORTED from the agency
 * TaskRow + StageNode so the two surfaces stay in lockstep — any future
 * polish round on the agency canvas's card aesthetic flows into the
 * portal automatically.
 *
 * Differences from agency TaskRow (the only divergences):
 *   * NO dnd-kit / useSortable (no drag-reorder)
 *   * NO inline rename input (clients don't edit titles)
 *   * NO `useEditMode` context (the portal has no edit mode)
 *   * NO `pan-disabled` class (the portal canvas's
 *     panning.excluded list doesn't need it — only buttons/inputs are
 *     excluded, and the card body is not a button so it allows pan)
 *   * Title click → opens the task detail panel (stubbed in 4b-2-a;
 *     wires up in 4b-2-b)
 *
 * Server-side enforcement (no UI gate needed; documented for posterity):
 *   * tasks_update RLS allows the client to UPDATE this row (client +
 *     client_visible + chain-visible — migration 20260521120000).
 *   * enforce_client_task_update_scope trigger restricts the column
 *     set to `done` only. Any other column change → server rejects.
 */

type Props = {
  task: VisibleTask;
  /** Parent stage's state — drives the COMPLETED card treatment.
   *  Computed in PortalCanvas via stageStateFromCounts over the
   *  FILTERED task counts. */
  stageState: StageState;
  /** Toggle done. Parent applies optimistic update + reverts on
   *  failure. */
  onToggleDone: (taskId: string, nextDone: boolean) => void;
  /** Title body click — opens the detail panel. Stubbed in 4b-2-a;
   *  wires PortalTaskDetailPanel in 4b-2-b. */
  onOpenDetail: (taskId: string) => void;
};

export function PortalTaskRow({
  task,
  stageState,
  onToggleDone,
  onOpenDetail,
}: Props) {
  // Card + checkbox treatment derived from stage state + own done flag —
  // matches agency TaskRow's exact rules.
  const completed = COMPLETED[stageState];
  const cardBg = task.done ? completed.cardBg : INCOMPLETE.cardBg;
  const cardBorder = task.done ? completed.cardBorder : INCOMPLETE.cardBorder;
  const titleColor = task.done ? completed.titleColor : INCOMPLETE.titleColor;
  const checkboxBg = task.done ? completed.checkboxBg : "transparent";
  const checkboxBorder = task.done
    ? completed.checkboxBorder
    : INCOMPLETE.checkboxBorder;
  const checkColor = completed.checkColor;

  return (
    <div
      style={{
        // CARD — rounded rectangle wrapping checkbox + title.
        // Matches agency TaskRow exactly.
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        borderRadius: 8,
        height: TASK_CARD_HEIGHT,
        padding: "0 10px",
        boxSizing: "border-box",
        width: "100%",
        cursor: "default",
      }}
    >
      {/* Left-edge connector dot — matches agency TaskRow exactly.
          Color follows the STAGE state (not the task's own done state)
          so the dot answers "which stage is this task in" while the
          card fill answers "is this task done." Same two-signal read
          as the agency canvas. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: -4,
          top: "50%",
          transform: "translateY(-50%)",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background:
            stageState === "in-progress"
              ? "#6E5BE8"
              : stageState === "done"
                ? "#15B981"
                : "#6B6B6B",
          pointerEvents: "none",
        }}
      />

      {/* Checkbox — interactive for the client on their visible tasks.
          Same sizing + two-mode treatment as agency TaskRow. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleDone(task.id, !task.done);
        }}
        aria-label={
          task.done
            ? `Uncheck task ${task.title}`
            : `Check off task ${task.title}`
        }
        aria-pressed={task.done}
        style={{
          flexShrink: 0,
          width: 16,
          height: 16,
          borderRadius: 4,
          background: checkboxBg,
          border: `1.5px solid ${checkboxBorder}`,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition:
            "background 120ms ease-out, border-color 120ms ease-out",
        }}
      >
        {task.done && <Check size={11} color={checkColor} strokeWidth={3} />}
      </button>

      {/* Title — click opens detail (stub in 4b-2-a). Truncates with
          ellipsis on overflow. No inline rename — clients don't edit
          titles. Read-only display only. */}
      <button
        type="button"
        onClick={() => onOpenDetail(task.id)}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          background: "transparent",
          border: "none",
          padding: 0,
          color: titleColor,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.3,
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textDecoration: task.done ? "line-through" : "none",
          fontFamily: "inherit",
        }}
      >
        {task.title}
      </button>
    </div>
  );
}
