"use client";

/**
 * Content-aware edge fade overlays for the pipeline canvas.
 *
 * Renders subtle ~35% black gradients on the canvas edges where there's
 * content OFF-screen in that direction — signaling "there's more to pan
 * to over there." Fades hide automatically when the user has reached
 * the content boundary on that side.
 *
 * Per locked spec: black only (not the color-coded fades from the early
 * sketch). All four sides. ~55% opacity at the edge, fading to 0
 * (bumped from 0.35 in step 5a verification — 0.35 read as a faint hint
 * users could miss; 0.55 is the sweet spot where the fade clearly
 * signals "more content over there" without obscuring the content
 * closest to the edge).
 *
 * Pure presentational component — the bbox-vs-visible-region math lives
 * in the parent (PipelineCanvas) where the transform state is tracked
 * via TransformWrapper's `onTransform` callback. Keeping the math in the
 * parent avoids depending on react-zoom-pan-pinch's React context being
 * available to siblings of TransformWrapper.
 */

type Edges = {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
};

type Props = {
  edges: Edges;
};

export function EdgeFades({ edges }: Props) {
  return (
    <>
      {/* Each fade is a 60px-wide gradient strip pinned to the edge it
          covers. transition on opacity so fades soft-enter/leave instead
          of popping. zIndex 10 keeps them above canvas content but below
          coachmark / pill / zoom controls (zIndex 20+). pointer-events
          none so they don't intercept pan drags. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: 60,
          background:
            "linear-gradient(to right, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          opacity: edges.left ? 1 : 0,
          transition: "opacity 180ms ease-out",
          pointerEvents: "none",
          zIndex: 10,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: 60,
          background:
            "linear-gradient(to left, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          opacity: edges.right ? 1 : 0,
          transition: "opacity 180ms ease-out",
          pointerEvents: "none",
          zIndex: 10,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          opacity: edges.top ? 1 : 0,
          transition: "opacity 180ms ease-out",
          pointerEvents: "none",
          zIndex: 10,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 60,
          background:
            "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          opacity: edges.bottom ? 1 : 0,
          transition: "opacity 180ms ease-out",
          pointerEvents: "none",
          zIndex: 10,
        }}
      />
    </>
  );
}
