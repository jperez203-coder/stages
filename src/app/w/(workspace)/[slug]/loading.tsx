/**
 * Loading skeleton for /w/[slug] (workspace dashboard). Perf Win #1
 * (2026-05-26) — Next.js Suspense fallback fires the instant a user
 * clicks toward this route, so they see motion immediately instead of
 * a frozen old page until the data fetch resolves.
 *
 * Renders BELOW the persistent AppShell (logo + workspace switcher +
 * search + profile menu) — AppShell lives in the parent layout.tsx
 * and stays mounted during navigation, so this file only needs to
 * fill the body area.
 *
 * Shape matches the dashboard body (greeting line + two-up cards row
 * + pipelines section + pipeline grid) at coarse granularity. Not
 * pixel-perfect — close enough that the swap from skeleton → real
 * content feels like a fade-in rather than a layout shift.
 */
export default function WorkspaceDashboardLoading() {
  return (
    <div
      style={{
        background: "#212124",
        flex: 1,
        padding: "32px 24px",
      }}
    >
      <div className="max-w-[1200px] mx-auto">
        {/* Greeting line */}
        <div
          className="animate-pulse mb-6"
          style={{
            height: 28,
            width: 280,
            background: "#2C2C2F",
            borderRadius: 8,
          }}
          aria-hidden="true"
        />

        {/* Two-card row: MyTasks + Activity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: 280,
                background: "#2C2C2F",
                borderRadius: 16,
              }}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* "Pipelines" section header */}
        <div
          className="animate-pulse mb-4"
          style={{
            height: 22,
            width: 160,
            background: "#2C2C2F",
            borderRadius: 6,
          }}
          aria-hidden="true"
        />

        {/* Pipeline grid — 3 card placeholders (matches min-width
            grid; real grid wraps to 1/2/3 columns same as this). */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: 220,
                background: "#2C2C2F",
                borderRadius: 16,
              }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
