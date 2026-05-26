import { CanvasChromeSkeleton } from "@/components/skeletons/CanvasChromeSkeleton";

/**
 * Loading skeleton for the canvas Chat tab. Perf Win #1 (2026-05-26).
 *
 * Chrome skeleton + channel-sidebar placeholder on the left + message-
 * thread placeholders on the right. Coarse match to the real Chat
 * layout (sidebar + thread).
 */
export default function CanvasChatLoading() {
  return (
    <CanvasChromeSkeleton>
      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
        }}
        aria-hidden="true"
      >
        {/* Channel sidebar */}
        <div
          style={{
            width: 220,
            borderRight: "1px solid #2A2A2D",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse"
              style={{
                height: 32,
                background: "#2C2C2F",
                borderRadius: 6,
              }}
            />
          ))}
        </div>

        {/* Message thread */}
        <div
          style={{
            flex: 1,
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              <div
                className="animate-pulse"
                style={{
                  width: 32,
                  height: 32,
                  background: "#2C2C2F",
                  borderRadius: 6,
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
                    height: 12,
                    width: 100,
                    background: "#2C2C2F",
                    borderRadius: 4,
                  }}
                />
                <div
                  className="animate-pulse"
                  style={{
                    height: 36,
                    width: "70%",
                    background: "#2C2C2F",
                    borderRadius: 6,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </CanvasChromeSkeleton>
  );
}
