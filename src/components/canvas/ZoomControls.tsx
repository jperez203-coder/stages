"use client";

import { Maximize2, Minus, Plus } from "lucide-react";

/**
 * Bottom-right zoom controls — three buttons per the figma:
 *   +   zoom in
 *   −   zoom out
 *   ⤢   fit-to-screen (zoomToElement on the in-progress stage in 5a;
 *       full pipeline bbox in 5b+)
 *
 * Stacked vertically. Each button is a 38px square with a 8px gap. Matches
 * the figma layout (zoom controls at bottom-right, not bottom-center).
 *
 * Buttons are persistent — visible at every zoom level. zIndex 20 keeps
 * them above edge fades but below coachmark (which is bottom-center, no
 * stacking conflict).
 */

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
};

export function ZoomControls({ onZoomIn, onZoomOut, onFit }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        right: 20,
        bottom: 20,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <ZoomButton onClick={onZoomIn} ariaLabel="Zoom in">
        <Plus size={16} />
      </ZoomButton>
      <ZoomButton onClick={onZoomOut} ariaLabel="Zoom out">
        <Minus size={16} />
      </ZoomButton>
      <ZoomButton onClick={onFit} ariaLabel="Fit to screen">
        <Maximize2 size={14} />
      </ZoomButton>
    </div>
  );
}

function ZoomButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 38,
        height: 38,
        borderRadius: 10,
        background: "rgba(33,33,36,0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid #36363A",
        color: "rgba(255,255,255,0.7)",
        cursor: "pointer",
        transition: "background 120ms ease-out, color 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(44,44,47,0.95)";
        e.currentTarget.style.color = "white";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(33,33,36,0.85)";
        e.currentTarget.style.color = "rgba(255,255,255,0.7)";
      }}
    >
      {children}
    </button>
  );
}
