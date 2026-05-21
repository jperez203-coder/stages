"use client";

import type { StageState } from "@/lib/current-stage";

/**
 * One stage on the pipeline canvas — numbered badge at top + stage box
 * below, anchored at (x, y) in canvas-plane coordinates. Phase 4a step 5b.
 *
 * Visual is purely a function of `state` (passed / current / future)
 * derived in src/lib/current-stage.ts. NOT a per-stage task-completion
 * check — see stateForStage() docs for why.
 *
 * Layout (top-to-bottom inside the node):
 *   1. Numbered badge (32px circle, position number, state-colored)
 *   2. 14px gap
 *   3. Stage box (180px wide, name + "Stage N · X/Y task" subtitle)
 *
 * The wrapper div carries the stage's `id` attribute so PipelineCanvas
 * can call `zoomToElement(stageId)` for auto-center + recenter actions.
 *
 * 5b stubs the red activity dot (top-right of badge) since activity
 * tracking isn't wired yet — the SLOT exists but always renders nothing.
 * Wiring is later.
 */

// Color tokens (locked — DO NOT redefine ad-hoc elsewhere).
// Pulled from PROGRESS.md step 4 polish round + 5b spec:
//   * Purple (current) — #6E5BE8 figma indigo, full brightness
//   * Green  (passed)  — #15B981 / #1F4535 pair (Done badge family)
//   * Grey   (future)  — #2C2C2F bg, #979393 text (recessed)
const COLORS = {
  current: {
    badgeBg: "#6E5BE8",
    badgeText: "#FFFFFF",
    badgeBorder: "#6E5BE8",
    boxBg: "#6E5BE8",
    boxText: "#FFFFFF",
    boxSubtitle: "rgba(255,255,255,0.75)",
    boxBorder: "#6E5BE8",
  },
  passed: {
    badgeBg: "#1F4535",
    badgeText: "#15B981",
    badgeBorder: "#15B981",
    boxBg: "#1F4535",
    boxText: "#15B981",
    boxSubtitle: "rgba(21,185,129,0.7)",
    boxBorder: "rgba(21,185,129,0.35)",
  },
  future: {
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
const BOX_WIDTH = 180;
const BOX_HEIGHT = 64;

/** Total visual height of a StageNode (badge + gap + box). Exported so
 *  PipelineCanvas can compute content-bbox correctly. */
export const STAGE_NODE_HEIGHT = BADGE_DIAMETER + BADGE_TO_BOX_GAP + BOX_HEIGHT;
export const STAGE_NODE_WIDTH = BOX_WIDTH;
export { BADGE_DIAMETER };

type Props = {
  stage: {
    id: string;
    position: number;
    name: string;
    total: number;
    completed: number;
    state: StageState;
  };
  /** Anchor coordinates in canvas-plane space — top-left of the node. */
  x: number;
  y: number;
};

export function StageNode({ stage, x, y }: Props) {
  const colors = COLORS[stage.state];

  return (
    <div
      id={stage.id}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: STAGE_NODE_WIDTH,
        // Don't constrain height — let the badge + box stack naturally.
        // The wrapper's bounding box still reads as STAGE_NODE_HEIGHT
        // because that's what the children sum to.
        //
        // Hierarchy hint: passed/green stages render at 0.7 opacity so
        // they recede visually against the brighter purple current
        // stage. Locked rule (Phase 4a step 5b verification):
        //   current  → brightest (opacity 1.0)
        //   passed   → present but receded (opacity 0.7)
        //   future   → dim/grey (opacity 1.0 but already-muted tokens)
        // Without this dampening, the bright #15B981 text + border on
        // green boxes competed with the current stage's purple for
        // visual prominence, flattening the "current is brightest"
        // signal. Connectors stay at full saturation (rendered as
        // siblings, not inside this wrapper) — they represent the
        // completed PATH, which should still read cleanly while the
        // stage cards themselves recede.
        opacity: stage.state === "passed" ? 0.7 : 1,
      }}
    >
      {/* Numbered badge — circle, LEFT-ALIGNED with the stage box's
          left edge (not centered above the box). Matches figma
          Figma_pipeline_stage_view.png — badges sit at the top-left
          of each stage rather than floating centered. Connectors still
          link badge-to-badge horizontally (see PipelineCanvas's
          connector x-math, which anchors on `pos.x + BADGE_DIAMETER/2`
          for badge center now that badges are left-aligned). */}
      <div
        style={{
          width: BADGE_DIAMETER,
          height: BADGE_DIAMETER,
          // No horizontal margin — badge anchors flush with the
          // wrapper's left edge, which IS the stage box's left edge
          // (the wrapper width === STAGE_NODE_WIDTH === BOX_WIDTH).
          borderRadius: "50%",
          background: colors.badgeBg,
          border: `1.5px solid ${colors.badgeBorder}`,
          color: colors.badgeText,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 13,
          fontWeight: 600,
          // Subtle drop shadow only on the current (purple) badge to
          // give it slight elevation. Passed + future stay flat.
          boxShadow:
            stage.state === "current"
              ? "0 2px 8px rgba(110,91,232,0.35)"
              : "none",
          position: "relative",
        }}
      >
        {stage.position}
        {/* Activity-dot slot — top-right of badge. 5b stub: never
            renders. Wiring activity tracking is later. Keeping the
            absolute-positioned span here as a layout placeholder so
            when activity flags ship, the dot can simply gain a
            conditional `display: "block"` without re-jiggering geometry. */}
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
          marginTop: BADGE_TO_BOX_GAP,
          width: BOX_WIDTH,
          // height: BOX_HEIGHT — set via padding instead so text wrap
          // doesn't push the bottom beyond the expected box height.
          padding: "10px 14px",
          minHeight: BOX_HEIGHT,
          background: colors.boxBg,
          border: `1px solid ${colors.boxBorder}`,
          borderRadius: 10,
          color: colors.boxText,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 4,
          // Match the figma drop on current — slightly more elevation
          // than the connector strip, less than a fully-floating modal.
          boxShadow:
            stage.state === "current"
              ? "0 4px 16px rgba(110,91,232,0.25)"
              : "none",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.2,
            // Truncate long stage names — better than wrapping in a
            // fixed-height box. Real figma shows single-line names.
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
