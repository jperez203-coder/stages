import { CanvasChromeSkeleton } from "@/components/skeletons/CanvasChromeSkeleton";

/**
 * Loading skeleton for the canvas main page (/w/[slug]/p/[id]).
 * Perf Win #1 (2026-05-26).
 *
 * No shared layout exists under (canvas)/[slug]/p/[pipeline-id], so
 * every navigation re-mounts the chrome. Skeleton renders the
 * LeftRail + header shape (via CanvasChromeSkeleton) plus a dotted-
 * grid main area with four stage-node-shaped placeholders so the
 * canvas "feels right" before the real nodes paint in.
 */
export default function CanvasMainLoading() {
  return (
    <CanvasChromeSkeleton>
      <div
        className="dotted-grid"
        style={{
          flex: 1,
          position: "relative",
          minHeight: 0,
        }}
        aria-hidden="true"
      >
        {/* Stage-node-shaped placeholders. Positions roughly mimic a
            typical left-to-right pipeline layout. */}
        {[
          { left: 80, top: 80 },
          { left: 320, top: 140 },
          { left: 560, top: 80 },
          { left: 800, top: 200 },
        ].map((pos, i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              position: "absolute",
              left: pos.left,
              top: pos.top,
              width: 200,
              height: 120,
              background: "#2C2C2F",
              border: "1px solid #36363A",
              borderRadius: 12,
            }}
          />
        ))}
      </div>
    </CanvasChromeSkeleton>
  );
}
