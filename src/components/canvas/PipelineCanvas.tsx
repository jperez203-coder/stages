"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import { EdgeFades } from "./EdgeFades";
import { CanvasCoachmark } from "./CanvasCoachmark";
import { StageIndicatorPill } from "./StageIndicatorPill";
import { ZoomControls } from "./ZoomControls";
import {
  StageNode,
  STAGE_NODE_WIDTH,
  STAGE_NODE_HEIGHT,
  BADGE_DIAMETER,
} from "./StageNode";
import { StageConnector } from "./StageConnector";
import type { StageViewModel } from "@/app/w/[slug]/p/[pipeline-id]/page";

/**
 * Pipeline canvas — Phase 4a step 5b (real stage rendering on the 5a shell).
 *
 * Stages laid out left-to-right horizontally at the geometric center of
 * the 4000×4000 transform plane. Each stage renders as a StageNode
 * (badge + box) with a StageConnector between adjacent badges. State
 * coloring (passed/current/future → green/purple/grey) is derived
 * server-side via deriveCurrentStage + stateForStage and arrives in the
 * `stages` prop as `StageViewModel[]`.
 *
 * 5a's wheel handling (pan via custom listener, Cmd/Ctrl+wheel zoom via
 * lib activationKeys), edge fades, coachmark, and zoom controls are all
 * preserved unchanged. The placeholder boxes from 5a are deleted; the
 * content-bbox now derives from real stage positions.
 *
 * Empty-stage fallback: when the pipeline has zero stages, the canvas
 * renders the grid + a small "no stages yet" pill at the plane center.
 * Auto-center is skipped (nothing to target). 5e will surface a real
 * "create your first stage" affordance.
 */

type Props = {
  pipelineId: string;
  pipelineName: string;
  workspaceSlug: string;
  coachmarkInitiallyDismissed: boolean;
  stages: StageViewModel[];
  currentStageId: string | null;
};

// Canvas plane size — big enough that pan + edge fades have room to
// breathe at all zoom levels. The plane is the transformed inner content
// (dotted grid + stage nodes). When zoomed to 1x and centered on the
// origin, the visible area shows a small slice of this plane.
const PLANE_W = 4000;
const PLANE_H = 4000;

// Plane center — where the stage row is anchored.
const PLANE_CX = PLANE_W / 2;
const PLANE_CY = PLANE_H / 2;

// Horizontal gap between stages. STAGE_NODE_WIDTH (180) + STAGE_GAP (100)
// = 280px between adjacent stage left edges, which puts badge centers
// ~280px apart — matches the figma's spacing rhythm.
const STAGE_GAP = 100;

// Bounding-box padding around the stage cluster for the edge fades.
// Fades activate when the user pans content past this padded boundary
// instead of right at the cluster's literal edge — gives a small "you
// haven't quite reached the limit" buffer.
const BBOX_PADDING = 40;

export function PipelineCanvas({
  pipelineId,
  pipelineName,
  workspaceSlug,
  coachmarkInitiallyDismissed,
  stages,
  currentStageId,
}: Props) {
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // ── Layout coordinates for each stage ─────────────────────────────────
  // Stages laid out left-to-right horizontally, centered on the plane.
  // All stages share the same y (badge centers aligned on one axis).
  //
  // Recomputed only when `stages` changes (rare — typically once per
  // page load).
  const layout = useMemo(() => {
    const n = stages.length;
    if (n === 0) {
      return { positions: new Map<string, { x: number; y: number }>(), bbox: null };
    }
    const totalWidth = n * STAGE_NODE_WIDTH + (n - 1) * STAGE_GAP;
    const startX = PLANE_CX - totalWidth / 2;
    const yTop = PLANE_CY - STAGE_NODE_HEIGHT / 2;

    const positions = new Map<string, { x: number; y: number }>();
    stages.forEach((s, idx) => {
      const x = startX + idx * (STAGE_NODE_WIDTH + STAGE_GAP);
      positions.set(s.id, { x, y: yTop });
    });

    // Content bbox in canvas-plane coords for edge-fade detection,
    // padded a bit so fades activate slightly past the literal cluster
    // edge.
    const bbox = {
      left: startX - BBOX_PADDING,
      right: startX + totalWidth + BBOX_PADDING,
      top: yTop - BBOX_PADDING,
      bottom: yTop + STAGE_NODE_HEIGHT + BBOX_PADDING,
    };

    return { positions, bbox };
  }, [stages]);

  // ── Edge-fade visibility ──────────────────────────────────────────────
  const [edges, setEdges] = useState({
    left: false,
    right: false,
    top: false,
    bottom: false,
  });

  const recomputeEdges = useCallback(
    (positionX: number, positionY: number, scale: number) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !layout.bbox) return;
      const W = wrapper.clientWidth;
      const H = wrapper.clientHeight;
      const planeLeft = -positionX / scale;
      const planeRight = (W - positionX) / scale;
      const planeTop = -positionY / scale;
      const planeBottom = (H - positionY) / scale;
      const EPS = 1;
      setEdges({
        left: layout.bbox.left + EPS < planeLeft,
        right: layout.bbox.right - EPS > planeRight,
        top: layout.bbox.top + EPS < planeTop,
        bottom: layout.bbox.bottom - EPS > planeBottom,
      });
    },
    [layout.bbox],
  );

  // ── Custom wheel handler (pan semantics — unchanged from 5a) ──────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onWheel = (e: WheelEvent) => {
      // Always preventDefault — covers both zoom (modifier held, lib
      // handles) and pan (no modifier, we handle). Blocks browser
      // native Cmd+wheel page-zoom.
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) return; // lib handles zoom
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

  // ── Imperative controls ───────────────────────────────────────────────
  // Recenter targets the current stage (passed from the server-derived
  // currentStageId). Falls back to centerView if no current stage
  // (empty-pipeline case) so the button still does something useful.
  const onRecenter = useCallback(() => {
    if (currentStageId) {
      transformRef.current?.zoomToElement(
        currentStageId,
        1,
        280,
        "easeOut",
      );
    } else {
      transformRef.current?.centerView(1, 280, "easeOut");
    }
  }, [currentStageId]);

  const onZoomIn = useCallback(() => {
    transformRef.current?.zoomIn(0.25, 200, "easeOut");
  }, []);
  const onZoomOut = useCallback(() => {
    transformRef.current?.zoomOut(0.25, 200, "easeOut");
  }, []);
  const onFit = useCallback(() => {
    // "Fit" in 5b recenters on the current stage at 1x — same as the
    // pill click. True "fit-to-pipeline" with auto-zoom to frame all
    // stages is a 5d polish item (needs the wrapper dimensions + cluster
    // width to compute the right scale).
    onRecenter();
  }, [onRecenter]);

  // Current stage's position (for the pill text). Defaults to 1 when
  // empty so the pill doesn't render "stage 0 of 0" — though when
  // stages.length === 0, the empty-state branch below renders something
  // else anyway and the pill stays.
  const currentPosition = useMemo(() => {
    if (!currentStageId) return 1;
    const found = stages.find((s) => s.id === currentStageId);
    return found?.position ?? 1;
  }, [currentStageId, stages]);

  return (
    <div
      ref={wrapperRef}
      className="flex-1"
      data-pipeline-id={pipelineId}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#212124",
        cursor: "grab",
      }}
    >
      {/* Minimal header band — 5b still placeholder. The real header
          (left rail + member cluster + Edit pipeline button) ships in 5d.
          For now: back arrow + pipeline name. */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Link
          href={`/w/${workspaceSlug}`}
          aria-label="Back to workspace"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "#212124",
            border: "1px solid #36363A",
            color: "rgba(255,255,255,0.7)",
          }}
        >
          <ArrowLeft size={16} />
        </Link>
        <div
          style={{
            background: "rgba(33,33,36,0.85)",
            backdropFilter: "blur(8px)",
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid #36363A",
            color: "white",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {pipelineName}
        </div>
      </div>

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
        }}
        trackPadPanning={{ disabled: true }}
        doubleClick={{ disabled: true }}
        onInit={(ref) => {
          // Defer a frame so stage DOM is committed before zoomToElement
          // measures it. Targets the current in-progress stage; if the
          // pipeline has no stages OR no current stage somehow, fall
          // back to centerView so the canvas still lands somewhere
          // sensible (geometric plane center).
          requestAnimationFrame(() => {
            if (currentStageId) {
              const el = document.getElementById(currentStageId);
              if (!el) {
                console.warn(
                  "[canvas] auto-center: current stage element not found:",
                  currentStageId,
                );
                ref.centerView(1, 0);
              } else {
                ref.zoomToElement(currentStageId, 1, 0);
              }
            } else {
              // No current stage — empty pipeline. Center on the plane
              // origin so the "no stages yet" pill is in view.
              ref.centerView(1, 0);
            }
            requestAnimationFrame(() => {
              const s = ref.state;
              recomputeEdges(s.positionX, s.positionY, s.scale);
            });
          });
        }}
        onTransform={(_ref, state) =>
          recomputeEdges(state.positionX, state.positionY, state.scale)
        }
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
          {/* Dotted-grid background — pans + zooms with content. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "radial-gradient(circle, #4A4A4A 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              pointerEvents: "none",
            }}
          />

          {/* Empty-state: pipeline has no stages yet. Small centered
              pill so the user knows the canvas is live but empty.
              5e ships the real "create stage" affordance. */}
          {stages.length === 0 && (
            <div
              style={{
                position: "absolute",
                left: PLANE_CX - 110,
                top: PLANE_CY - 24,
                width: 220,
                padding: "12px 16px",
                background: "rgba(33,33,36,0.85)",
                border: "1px dashed #4A4A50",
                borderRadius: 10,
                color: "rgba(255,255,255,0.6)",
                fontSize: 13,
                textAlign: "center",
                fontStyle: "italic",
              }}
            >
              no stages yet
            </div>
          )}

          {/* Connectors render BEFORE stage nodes so the badges paint
              on top of the line endings (line passes behind the
              badge edges, not over them). */}
          {stages.length >= 2 &&
            stages.slice(0, -1).map((left, idx) => {
              const right = stages[idx + 1];
              const leftPos = layout.positions.get(left.id);
              const rightPos = layout.positions.get(right.id);
              if (!leftPos || !rightPos) return null;
              // Badge centers in plane coords. Badges are LEFT-aligned
              // with each stage's box (per figma), so badge center sits
              // at `pos.x + BADGE_DIAMETER/2` — half a badge inward
              // from the stage's left edge, not at the stage's
              // horizontal midpoint.
              const leftBadgeCx = leftPos.x + BADGE_DIAMETER / 2;
              const rightBadgeCx = rightPos.x + BADGE_DIAMETER / 2;
              const badgeCy = leftPos.y + BADGE_DIAMETER / 2;
              // Pull connector in by half-badge so the line starts
              // at the badge edge, not the badge center.
              const fromX = leftBadgeCx + BADGE_DIAMETER / 2;
              const toX = rightBadgeCx - BADGE_DIAMETER / 2;
              return (
                <StageConnector
                  key={`${left.id}->${right.id}`}
                  fromX={fromX}
                  toX={toX}
                  y={badgeCy}
                  leftState={left.state}
                  rightState={right.state}
                />
              );
            })}

          {/* Stage nodes — one per stage. id on the wrapper for
              zoomToElement targeting. */}
          {stages.map((s) => {
            const pos = layout.positions.get(s.id);
            if (!pos) return null;
            return (
              <StageNode key={s.id} stage={s} x={pos.x} y={pos.y} />
            );
          })}
        </TransformComponent>
      </TransformWrapper>

      {/* Overlays — rendered OUTSIDE TransformWrapper so they don't pan
          or zoom with the canvas. */}
      <EdgeFades edges={edges} />
      <StageIndicatorPill
        current={currentPosition}
        total={stages.length}
        onRecenter={onRecenter}
      />
      <ZoomControls onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />
      {!coachmarkInitiallyDismissed && <CanvasCoachmark />}
    </div>
  );
}
