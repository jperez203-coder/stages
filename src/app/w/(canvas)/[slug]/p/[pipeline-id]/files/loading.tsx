import { CanvasChromeSkeleton } from "@/components/skeletons/CanvasChromeSkeleton";

/**
 * Loading skeleton for the canvas Files tab. Perf Win #1 (2026-05-26).
 *
 * Chrome skeleton + "Files" header row (title + Add link / Upload
 * buttons) + grid of 4 file-card placeholders. Grid columns match
 * the live FilesBody grid (auto-fill, min 360px).
 */
export default function CanvasFilesLoading() {
  return (
    <CanvasChromeSkeleton>
      <div
        style={{
          flex: 1,
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 0,
        }}
        aria-hidden="true"
      >
        {/* Header row — title on left, action buttons on right. */}
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
              width: 120,
              height: 22,
              background: "#2C2C2F",
              borderRadius: 6,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            {[0, 1].map((i) => (
              <div
                key={i}
                className="animate-pulse"
                style={{
                  width: 96,
                  height: 36,
                  background: "#2C2C2F",
                  borderRadius: 8,
                }}
              />
            ))}
          </div>
        </div>

        {/* File-card grid. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: 320,
                background: "#2C2C2F",
                border: "1px solid #36363A",
                borderRadius: 12,
              }}
            />
          ))}
        </div>
      </div>
    </CanvasChromeSkeleton>
  );
}
