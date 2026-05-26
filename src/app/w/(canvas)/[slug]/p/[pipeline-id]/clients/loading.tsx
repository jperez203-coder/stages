import { CanvasChromeSkeleton } from "@/components/skeletons/CanvasChromeSkeleton";

/**
 * Loading skeleton for the canvas Clients tab. Perf Win #1
 * (2026-05-26). Chrome skeleton + header + Invite button + a stack
 * of client-row placeholders.
 */
export default function CanvasClientsLoading() {
  return (
    <CanvasChromeSkeleton>
      <div
        style={{
          flex: 1,
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
        aria-hidden="true"
      >
        {/* Page header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            className="animate-pulse"
            style={{
              width: 140,
              height: 24,
              background: "#2C2C2F",
              borderRadius: 6,
            }}
          />
          <div
            className="animate-pulse"
            style={{
              width: 140,
              height: 36,
              background: "#2C2C2F",
              borderRadius: 8,
            }}
          />
        </div>

        {/* Client rows */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{
              height: 64,
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
