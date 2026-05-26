import type { ReactNode } from "react";

/**
 * Shared skeleton for the pipeline-canvas chrome (LeftRail vertical
 * strip + PipelineChromeShell top header). Used by the four canvas
 * `loading.tsx` files (main canvas + chat/files/clients tabs).
 *
 * Lives in a shared component because there's currently no shared
 * layout under `(canvas)/[slug]/p/[pipeline-id]` — each tab page
 * renders its own chrome via PipelineChromeShell. Without a shared
 * layout, every tab navigation re-mounts the chrome, which means the
 * skeleton fallback ALSO has to render a chrome shape (otherwise the
 * whole canvas surface disappears during a tab switch). Win #2 from
 * the perf diagnosis would hoist this into a real layout and most of
 * this skeleton would become unnecessary — but until then, this is
 * the cheap fix.
 *
 * Pure visual layer: no state, no data, no animation beyond
 * Tailwind's `animate-pulse`. Dark-mode tokens match the live chrome
 * (page bg #212124, card surfaces #2C2C2F, dividers #2A2A2D/#36363A).
 */
export function CanvasChromeSkeleton({ children }: { children?: ReactNode }) {
  return (
    <div
      style={{
        background: "#212124",
        minHeight: "100vh",
        display: "flex",
      }}
    >
      {/* LeftRail strip — 5 icon-button placeholders matching the
          live rail's count + spacing. */}
      <div
        style={{
          width: 56,
          background: "#121212",
          borderRight: "1px solid #36363A",
          padding: "16px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
        }}
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              width: 32,
              height: 32,
              background: "#2C2C2F",
              borderRadius: 8,
            }}
          />
        ))}
      </div>

      {/* Main column — top header (matches PipelineChromeShell layout
          roughly: back button + pipeline icon + title block + member
          chips on the right) then children. */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <div
          style={{
            height: 72,
            padding: "16px 24px",
            borderBottom: "1px solid #2A2A2D",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
          aria-hidden="true"
        >
          <div
            className="animate-pulse"
            style={{
              width: 40,
              height: 40,
              background: "#2C2C2F",
              borderRadius: 10,
              flexShrink: 0,
            }}
          />
          <div
            className="animate-pulse"
            style={{
              width: 40,
              height: 40,
              background: "#2C2C2F",
              borderRadius: 10,
              flexShrink: 0,
            }}
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
            }}
          >
            <div
              className="animate-pulse"
              style={{
                width: 200,
                height: 18,
                background: "#2C2C2F",
                borderRadius: 4,
              }}
            />
            <div
              className="animate-pulse"
              style={{
                width: 140,
                height: 12,
                background: "#2C2C2F",
                borderRadius: 4,
              }}
            />
          </div>
          <div
            className="animate-pulse"
            style={{
              width: 96,
              height: 32,
              background: "#2C2C2F",
              borderRadius: 8,
              flexShrink: 0,
            }}
          />
        </div>

        {children}
      </div>
    </div>
  );
}
