/**
 * Empty state for the client portal canvas. Phase 4b-2-a.
 *
 * Renders when the pipeline has no stages with any client-visible
 * tasks — either no client-visible work has been planned yet, OR
 * every visible stage has zero visible tasks (filtered out by the
 * stage-hiding rule). Either way the client sees a friendly message
 * rather than an empty viewport.
 *
 * No CTA — clients can't add stages or tasks themselves. The agency
 * adds visible work; the client tracks it once present.
 *
 * Tone: confident + welcoming, not apologetic. "Your project journey
 * will appear here as the team adds visible work" tells the client
 * (a) what this surface is for, and (b) why it's currently empty,
 * without leaking that hidden work might exist behind it.
 */

export function PortalCanvasEmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        gap: 8,
        // Match the canvas's dark background so the empty state reads
        // as the same surface, just empty.
        background: "#212124",
      }}
    >
      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "white",
          margin: 0,
        }}
      >
        No visible stages yet
      </h2>
      <p
        style={{
          fontSize: 14,
          color: "rgba(255,255,255,0.55)",
          margin: 0,
          maxWidth: 420,
          lineHeight: 1.5,
        }}
      >
        Your project journey will appear here as the team adds visible
        work.
      </p>
    </div>
  );
}
