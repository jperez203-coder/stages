"use client";

/**
 * Top-center "showing stage X of Y" pill on the pipeline canvas.
 *
 * 5a: shows "showing stage 1 of N" against the placeholder boxes. Click
 * recenters the canvas on the in-progress stage (for 5a, that's
 * placeholder-1 — the parent wires up the recenter handler).
 *
 * 5b: the current stage index comes from the locked 3-state derivation
 * (highest position with completed task, fallback to position 1). The
 * pill text becomes dynamic and the recenter targets the real stage's
 * DOM node.
 *
 * Click affordance is full-pill — easier to hit than a dedicated "recenter"
 * icon. Hover cue is subtle (cursor pointer + slight bg lift) since this
 * is a persistent surface, not a primary action.
 */

type Props = {
  current: number;
  total: number;
  onRecenter: () => void;
};

export function StageIndicatorPill({ current, total, onRecenter }: Props) {
  return (
    <button
      type="button"
      onClick={onRecenter}
      aria-label={`Recenter on stage ${current} of ${total}`}
      style={{
        position: "absolute",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 20,
        background: "rgba(33,33,36,0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid #36363A",
        borderRadius: 999,
        padding: "6px 14px",
        color: "rgba(255,255,255,0.7)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 120ms ease-out, color 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(44,44,47,0.95)";
        e.currentTarget.style.color = "rgba(255,255,255,0.9)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(33,33,36,0.85)";
        e.currentTarget.style.color = "rgba(255,255,255,0.7)";
      }}
    >
      showing stage {current} of {total}
    </button>
  );
}
