/**
 * Loading skeleton for the client portal content area. Perf Win #1
 * (2026-05-26).
 *
 * Unlike the agency canvas, the portal HAS a real layout
 * (src/app/portal/[pipeline-id]/layout.tsx) that wraps every tab in
 * PortalShell — so the persistent header + tabs bar stay visible
 * during navigation. This skeleton only fills the content area
 * BELOW the tabs.
 *
 * Generic enough to serve as the fallback for all three portal tabs
 * (Canvas / Chat / Files) — title + subtitle + two content cards.
 * If a single tab ever needs a more specific skeleton, add a
 * tab-scoped loading.tsx next to that tab's page.tsx and it'll take
 * precedence over this one.
 */
export default function PortalLoading() {
  return (
    <div
      style={{
        background: "#212124",
        flex: 1,
        padding: "20px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minHeight: 0,
      }}
      aria-hidden="true"
    >
      {/* Title */}
      <div
        className="animate-pulse"
        style={{
          width: 160,
          height: 26,
          background: "#2C2C2F",
          borderRadius: 6,
        }}
      />

      {/* Subtitle / count line */}
      <div
        className="animate-pulse"
        style={{
          width: 96,
          height: 14,
          background: "#2C2C2F",
          borderRadius: 4,
        }}
      />

      {/* Content cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
          gap: 16,
          marginTop: 8,
        }}
      >
        {[0, 1].map((i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              height: 280,
              background: "#2C2C2F",
              border: "1px solid #36363A",
              borderRadius: 12,
            }}
          />
        ))}
      </div>
    </div>
  );
}
