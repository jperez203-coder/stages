"use client";

/**
 * Horizontal connector line between two adjacent badge centers on the
 * pipeline canvas. Phase 4a step 5b.
 *
 * Connector type is determined by the LEFT and RIGHT stage states:
 *
 *   left.state    | right.state    | type    | visual
 *   ──────────────┼────────────────┼─────────┼──────────────────────────
 *   passed        | passed         | solid   | solid green (#15B981)
 *   passed        | current        | solid   | solid green (still behind
 *                                              the current — the line
 *                                              represents completed
 *                                              path, not the active
 *                                              frontier)
 *   current       | future         | dashed  | dashed purple (#6E5BE8 —
 *                                              the active frontier from
 *                                              current → immediate-next)
 *   future        | future         | inert   | thin flat grey (#36363A)
 *
 * No other combinations occur given the locked state derivation —
 * states monotonically progress passed → current → future as position
 * increases. (passed → future would mean a future stage is to the left
 * of a passed stage, which can't happen.)
 *
 * Rendered as an absolutely-positioned <div> inside the canvas plane
 * (so it pans + zooms with the content). pointerEvents none so it
 * never intercepts pan drags.
 */

type ConnectorType = "solid-passed" | "dashed-frontier" | "inert-future";

function connectorType(
  left: "passed" | "current" | "future",
  right: "passed" | "current" | "future",
): ConnectorType {
  if (left === "current" && right === "future") return "dashed-frontier";
  if (left === "future") return "inert-future";
  // passed→passed, passed→current — both behind the active frontier
  return "solid-passed";
}

type Props = {
  /** Left-most x of the connector strip, in canvas-plane coordinates. */
  fromX: number;
  /** Right-most x. */
  toX: number;
  /** y of the connector — should match the badge centerline. */
  y: number;
  leftState: "passed" | "current" | "future";
  rightState: "passed" | "current" | "future";
};

export function StageConnector({
  fromX,
  toX,
  y,
  leftState,
  rightState,
}: Props) {
  const type = connectorType(leftState, rightState);

  // Border style + color by type.
  let borderTopStyle: "solid" | "dashed";
  let borderTopColor: string;
  let borderTopWidth: number;

  if (type === "solid-passed") {
    borderTopStyle = "solid";
    borderTopColor = "#15B981";
    borderTopWidth = 2;
  } else if (type === "dashed-frontier") {
    borderTopStyle = "dashed";
    borderTopColor = "#6E5BE8";
    borderTopWidth = 2;
  } else {
    // inert-future
    borderTopStyle = "solid";
    borderTopColor = "#36363A";
    borderTopWidth = 1;
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
