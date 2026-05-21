"use client";

import type { StageState } from "@/lib/current-stage";

/**
 * Horizontal connector line between two adjacent badge centers on the
 * pipeline canvas. Phase 4a step 5c (annotation polish 2026-05-22).
 *
 * Connector type is decided from the LEFT + RIGHT stage states under
 * the NEW per-stage state model (passed/current/future replaced with
 * not-started/in-progress/done). Full 3×3 truth table:
 *
 *   left         | right         | style   | color           | width
 *   ─────────────┼───────────────┼─────────┼─────────────────┼──────
 *   done         | done          | solid   | green #15B981   | 2px
 *   done         | in-progress   | solid   | green #15B981   | 2px
 *   done         | not-started   | solid   | green #15B981   | 2px
 *   in-progress  | done          | solid   | green #15B981   | 2px
 *   in-progress  | in-progress   | solid   | purple #6E5BE8  | 2px  ← parallel active region
 *   in-progress  | not-started   | dashed  | purple #6E5BE8  | 2px  ← frontier
 *   not-started  | done          | solid   | grey  #36363A   | 1px  ← edge case
 *   not-started  | in-progress   | solid   | grey  #36363A   | 1px
 *   not-started  | not-started   | solid   | grey  #36363A   | 1px
 *
 * Simplification rule the table follows:
 *   * LEFT done            → solid green (path behind is complete)
 *   * LEFT in-progress:
 *       RIGHT done         → solid green (crossed into done)
 *       RIGHT in-progress  → solid purple (parallel active flow)
 *       RIGHT not-started  → dashed purple (frontier into untouched)
 *   * LEFT not-started     → thin flat grey (left has nothing to show)
 *
 * Rendered absolutely inside the canvas plane (pans + zooms with
 * content). pointerEvents: none — never intercepts pan drags.
 */

type ConnectorType =
  | "solid-done"
  | "solid-parallel"
  | "dashed-frontier"
  | "inert-grey";

function connectorType(left: StageState, right: StageState): ConnectorType {
  if (left === "done") return "solid-done";
  if (left === "in-progress") {
    if (right === "done") return "solid-done";
    if (right === "in-progress") return "solid-parallel";
    return "dashed-frontier"; // in-progress → not-started
  }
  // left === "not-started"
  return "inert-grey";
}

type Props = {
  /** Left-most x of the connector strip, in canvas-plane coordinates. */
  fromX: number;
  /** Right-most x. */
  toX: number;
  /** y of the connector — should match the badge centerline. */
  y: number;
  leftState: StageState;
  rightState: StageState;
};

export function StageConnector({
  fromX,
  toX,
  y,
  leftState,
  rightState,
}: Props) {
  const type = connectorType(leftState, rightState);

  let borderTopStyle: "solid" | "dashed";
  let borderTopColor: string;
  let borderTopWidth: number;

  switch (type) {
    case "solid-done":
      borderTopStyle = "solid";
      borderTopColor = "#15B981";
      borderTopWidth = 2;
      break;
    case "solid-parallel":
      borderTopStyle = "solid";
      borderTopColor = "#6E5BE8";
      borderTopWidth = 2;
      break;
    case "dashed-frontier":
      borderTopStyle = "dashed";
      borderTopColor = "#6E5BE8";
      borderTopWidth = 2;
      break;
    case "inert-grey":
      borderTopStyle = "solid";
      borderTopColor = "#36363A";
      borderTopWidth = 1;
      break;
  }

  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: fromX,
        // Center vertically on `y` — pull up by half the border width
        // so the LINE (not the border bottom) sits on the badge axis.
        top: y - borderTopWidth / 2,
        width: toX - fromX,
        height: 0,
        borderTop: `${borderTopWidth}px ${borderTopStyle} ${borderTopColor}`,
        pointerEvents: "none",
      }}
    />
  );
}
