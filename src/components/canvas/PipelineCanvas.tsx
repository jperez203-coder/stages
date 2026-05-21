"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Pipeline canvas — Phase 4a step 5a (canvas core only).
 *
 * Empty pan/zoom shell built on react-zoom-pan-pinch v4. Library handles:
 *   * click-drag pan (mouse) + velocity inertia
 *   * Cmd/Ctrl + wheel zoom (via `wheel.activationKeys`)
 *   * trackpad pinch zoom (browser fires synthetic ctrlKey on pinch,
 *     caught by the same activationKeys)
 *   * touch pinch zoom (`pinch.disabled: false`)
 *
 * We add a custom wheel handler on top for figma-parity pan semantics
 * that the library doesn't cover natively:
 *   * mouse wheel (no modifier) → vertical pan
 *   * shift + wheel → horizontal pan
 *   * trackpad two-finger pan (deltaX + deltaY both non-zero) → free pan
 *
 * `trackPadPanning` is disabled in the library config so the lib's own
 * trackpad pan logic doesn't fight our custom wheel handler. Net effect:
 * every wheel event is routed deterministically — Cmd/Ctrl → library zoom,
 * everything else → our pan handler.
 *
 * 5a renders 3-4 throwaway placeholder boxes spread across the canvas plane
 * to test gesture feel against real content + edge fades. These go away in
 * 5b when real stages render.
 */

type Props = {
  pipelineId: string;
  pipelineName: string;
  workspaceSlug: string;
  coachmarkInitiallyDismissed: boolean;
};

// Canvas plane size — big enough that pan + edge fades have room to
// breathe at all zoom levels. The plane is the transformed inner content
// (dotted grid + placeholders). When zoomed to 1x and centered on the
// origin, the visible area shows a small slice of this plane.
const PLANE_W = 4000;
const PLANE_H = 4000;

// Placeholder box positions in canvas-plane coordinates. Spread across
// the plane to exercise pan, edge fades, and the "first placeholder
// auto-center" affordance. Removed in 5b when real stages render.
const PLACEHOLDERS: Array<{
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}> = [
  // Clustered near the geometric center of the 4000×4000 plane so that
  // auto-center on placeholder-1 keeps the other 3 within (or just past)
  // the viewport edges — that way "off-screen content" is true on the
  // right side immediately after mount, exercising the right edge fade.
  { id: "placeholder-1", x: 1800, y: 1940, w: 220, h: 120, label: "Stage 1 (placeholder)" },
  { id: "placeholder-2", x: 2050, y: 1940, w: 220, h: 120, label: "Stage 2" },
  { id: "placeholder-3", x: 2300, y: 1940, w: 220, h: 120, label: "Stage 3" },
  { id: "placeholder-4", x: 2550, y: 1940, w: 220, h: 120, label: "Stage 4" },
];

// Content bounding box in plane coords, derived from placeholder spread.
// EdgeFades uses this + the current transform to decide which side fades.
// In 5b this becomes "min/max stage position with padding."
const CONTENT_BBOX = (() => {
  const xs = PLACEHOLDERS.map((p) => p.x);
  const xsR = PLACEHOLDERS.map((p) => p.x + p.w);
  const ys = PLACEHOLDERS.map((p) => p.y);
  const ysB = PLACEHOLDERS.map((p) => p.y + p.h);
  return {
    left: Math.min(...xs) - 24,
    right: Math.max(...xsR) + 24,
    top: Math.min(...ys) - 24,
    bottom: Math.max(...ysB) + 24,
  };
})();

export function PipelineCanvas({
  pipelineId,
  pipelineName,
  workspaceSlug,
  coachmarkInitiallyDismissed,
}: Props) {
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Edge-fade visibility — computed from the live transform state + the
  // hardcoded content bbox + the wrapper's measured size. Lifted up to
  // PipelineCanvas (rather than inside EdgeFades via useTransformEffect)
  // so EdgeFades doesn't need to live inside TransformWrapper's React
  // context.
  const [edges, setEdges] = useState({
    left: false,
    right: false,
    top: false,
    bottom: false,
  });

  // Recomputes which edges have off-screen content given the current
  // transform. Called from onTransform (every tick) and from an initial
  // post-mount effect so the fades are correct on first paint.
  const recomputeEdges = useCallback(
    (positionX: number, positionY: number, scale: number) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const W = wrapper.clientWidth;
      const H = wrapper.clientHeight;
      // Visible-region edges in canvas-plane coordinates:
      //   plane_x_at_screen_0 = -positionX / scale
      //   plane_x_at_screen_W = (W - positionX) / scale
      const planeLeft = -positionX / scale;
      const planeRight = (W - positionX) / scale;
      const planeTop = -positionY / scale;
      const planeBottom = (H - positionY) / scale;

      const EPS = 1; // avoid edge-case flicker right at the boundary
      setEdges({
        left: CONTENT_BBOX.left + EPS < planeLeft,
        right: CONTENT_BBOX.right - EPS > planeRight,
        top: CONTENT_BBOX.top + EPS < planeTop,
        bottom: CONTENT_BBOX.bottom - EPS > planeBottom,
      });
    },
    [],
  );

  // Auto-center is wired via TransformWrapper's `onInit` callback below,
  // not via a setTimeout from a useEffect. The lib's onInit fires AFTER
  // its internal DOM measurements + ref setup are complete; setTimeout(0)
  // can race that init and result in zoomToElement no-op'ing because the
  // lib's internal state isn't ready. onInit is the lib-blessed entry
  // point for first-paint transforms.

  // ── Custom wheel handler — pan semantics ────────────────────────────
  // Attached natively (not via JSX) so we can call preventDefault on a
  // non-passive listener. React 19 + browser conventions: synthetic wheel
  // events default to passive, which blocks preventDefault. The native
  // `{ passive: false }` registration is the workaround.
  //
  // Routing:
  //   * ctrlKey || metaKey  → return (let library handle zoom)
  //   * shiftKey + dx≈0     → swap deltaY into deltaX (horizontal pan)
  //   * otherwise           → free pan via setTransform(positionX-dx, ...)
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onWheel = (e: WheelEvent) => {
      // Always preventDefault — covers both the zoom path (modifier held)
      // and the pan path (no modifier). Without this, Cmd/Ctrl+wheel
      // triggers the BROWSER's native page-zoom shortcut, which scales
      // the entire app chrome and makes the canvas feel like it's
      // navigating to a different page. The lib's own wheel handler
      // also calls preventDefault when its zoom path activates, but
      // doing it here unconditionally ensures we never lose a race
      // against the browser default.
      e.preventDefault();

      // ctrlKey here covers BOTH the keyboard Ctrl key AND the synthetic
      // ctrlKey browsers set on trackpad pinch gestures. Both should
      // route to the library's zoom handler — which they will, because
      // the wheel.activationKeys function below returns true for either
      // Meta or Control. Our handler simply gets out of the way.
      if (e.ctrlKey || e.metaKey) return;
      if (!transformRef.current) return;

      let dx = e.deltaX;
      let dy = e.deltaY;
      // Shift+wheel on mouse: some browsers auto-swap deltaY→deltaX,
      // others don't. If we see shift held but no horizontal delta,
      // promote deltaY manually so behavior is consistent.
      if (e.shiftKey && Math.abs(dx) < 0.01) {
        dx = dy;
        dy = 0;
      }

      const { positionX, positionY, scale } = transformRef.current.state;
      transformRef.current.setTransform(
        positionX - dx,
        positionY - dy,
        scale,
        0, // instant — no animation on wheel pan; native scroll feel
      );
    };

    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, []);

  // Recenter — used by the StageIndicatorPill click + the zoom-controls
  // "fit" button. For 5a, both target placeholder-1; in 5b the pill
  // targets the current in-progress stage and the fit button frames the
  // entire pipeline.
  const onRecenter = useCallback(() => {
    transformRef.current?.zoomToElement("placeholder-1", 1, 280, "easeOut");
  }, []);

  const onZoomIn = useCallback(() => {
    transformRef.current?.zoomIn(0.25, 200, "easeOut");
  }, []);
  const onZoomOut = useCallback(() => {
    transformRef.current?.zoomOut(0.25, 200, "easeOut");
  }, []);
  const onFit = useCallback(() => {
    // For 5a "fit" frames the placeholder cluster. In 5b this should fit
    // the actual stage bounding box. Identical implementation either way
    // — the call is `zoomToElement('placeholder-1')` in 5a vs
    // `centerView()` against a stage-bbox in 5b.
    transformRef.current?.zoomToElement("placeholder-1", 1, 280, "easeOut");
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="flex-1"
      data-pipeline-id={pipelineId}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#212124",
        // Cursor hint: "grab" when not actively panning (lib swaps to
        // "grabbing" on press). Lib doesn't set this itself.
        cursor: "grab",
      }}
    >
      {/* Minimal header band — 5a placeholder. The real header (left rail
          + member cluster + Edit pipeline button) is 5d. For now: back
          arrow + pipeline name, so the canvas isn't an unlabeled abyss. */}
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
        // Clamps zoom to 0.25x–2x — prevents runaway zoom-in (lib default
        // max is 8x which is unusable here) and the inverse zoom-out
        // shrink to nothing. 2x is plenty of detail for stage/task work
        // and matches Figma's typical "zoom for legibility" range.
        minScale={0.25}
        maxScale={2}
        limitToBounds={false}
        centerOnInit={false}
        smooth
        wheel={{
          // activationKeys MUST be the function form here. The array form
          // (`["Meta", "Control"]`) is interpreted by the lib as "ALL
          // keys in this array must be pressed simultaneously" — its
          // internal check is `keys.every(k => pressedKeys[k])`. So
          // `["Meta", "Control"]` required the user to hold Cmd AND Ctrl
          // at the same time, which is wrong for figma-parity (Cmd OR
          // Ctrl, either alone, should activate zoom). The function form
          // lets us return true on EITHER. Without this, Cmd+wheel never
          // activated the lib's zoom path — the browser then handled
          // Cmd+wheel as native page zoom, scaling the entire app chrome
          // and making the canvas feel like it was navigating elsewhere.
          activationKeys: (keys: string[]) =>
            keys.includes("Meta") || keys.includes("Control"),
          // Per-wheel-tick scale step. The lib multiplies this by the
          // wheel delta. With step=0.15 (10x the lib's default 0.015) a
          // single trackpad swipe slammed from min to max. step=0.03
          // (2x the lib default) gives gradual, controllable, Figma-like
          // zoom that lands cleanly on intermediate scales.
          step: 0.03,
        }}
        pinch={{
          step: 5,
        }}
        panning={{
          velocityDisabled: false,
          allowLeftClickPan: true,
        }}
        trackPadPanning={{
          // Disabled — our custom wheel handler covers trackpad two-finger
          // pan via raw deltaX/deltaY. Letting the lib's trackpad handler
          // also run would double-apply the pan and feel "fast/jumpy."
          disabled: true,
        }}
        doubleClick={{
          disabled: true,
        }}
        onInit={(ref) => {
          // Lib has finished measuring + setting up refs. Safe to read
          // state and call zoomToElement. Defer one frame so the
          // placeholder DOM is definitely committed (TransformComponent
          // renders children after the lib's own init in some race
          // conditions).
          requestAnimationFrame(() => {
            const el = document.getElementById("placeholder-1");
            if (!el) {
              console.warn(
                "[canvas] auto-center: placeholder-1 element not found in DOM",
              );
              return;
            }
            ref.zoomToElement("placeholder-1", 1, 0);
            // Defer once more so the transform applies before we read it
            // back for the initial edge-fade computation.
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
            // position: absolute + inset: 0 is the bulletproof way to
            // fill a position: relative parent. width/height 100% alone
            // can collapse when the lib's default CSS class (`.transform
            // -component-module_wrapper__SPB86`) competes with inline
            // styles in certain rendering states — position: absolute
            // sidesteps the resolution chain entirely. The parent
            // PipelineCanvas root has position: relative, so this
            // anchors correctly.
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
          {/* Dotted-grid background INSIDE the transform plane so it
              pans + zooms with the content. Dot color is #4A4A4A —
              one notch above the dashboard's #424242 token to nudge
              the dots back to dashboard-parity visibility against the
              transform context's sub-pixel softening, but pulled back
              from #525252 (tried first, read too prominent / "in your
              face"). #4A4A4A is the goldilocks middle. Spacing (24px)
              and dot size (1px) unchanged. Kept inline rather than
              applying the global .dotted-grid class because that class
              also sets a background-color, and we want the plane
              transparent so the wrapper's #212124 shows through at
              zoom-out. */}
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

          {/* Placeholder boxes — 5a only, removed in 5b. Bright blue
              dashed treatment so they're visually unmistakable against
              the grid pattern (the earlier #2C2C2F + #4A4A50 dark grey
              dashed treatment was too subtle to pop). Blue token chosen
              over green because green is reserved for the Done badge
              semantic; blue says "placeholder / informational" without
              colliding with any future stage state color. zoomToElement
              targets them by HTML id. */}
          {PLACEHOLDERS.map((p) => (
            <div
              key={p.id}
              id={p.id}
              style={{
                position: "absolute",
                left: p.x,
                top: p.y,
                width: p.w,
                height: p.h,
                background: "rgba(16,140,233,0.12)",
                border: "2px dashed #108CE9",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#7FA7D9",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {p.label}
            </div>
          ))}
        </TransformComponent>
      </TransformWrapper>

      {/* Overlays — rendered OUTSIDE TransformWrapper so they don't pan
          or zoom with the canvas. zIndex stacking above the canvas
          content. */}
      <EdgeFades edges={edges} />
      <StageIndicatorPill
        current={1}
        total={PLACEHOLDERS.length}
        onRecenter={onRecenter}
      />
      <ZoomControls onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />
      {!coachmarkInitiallyDismissed && <CanvasCoachmark />}
    </div>
  );
}
