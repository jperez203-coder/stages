"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Three-tab nav for the client portal. Phase 4b-1.
 *
 * Tabs are sub-routes — each Link is a real navigation, not in-page
 * tab state. Active state derives from usePathname so the indicator
 * stays in sync with browser back/forward and shareable URLs.
 *
 * Slice-1 surface:
 *   * Canvas — placeholder (coming in 4b-2)
 *   * Chat   — functional (slice 4b-1)
 *   * Files  — placeholder (coming when files feature exists)
 */

type Props = {
  pipelineId: string;
};

export function PortalTabs({ pipelineId }: Props) {
  const pathname = usePathname();
  const base = `/portal/${pipelineId}`;

  // Tab order matches the prototype: Canvas / Chat / Files.
  const tabs = [
    { id: "canvas", label: "Canvas", href: `${base}/canvas` },
    { id: "chat", label: "Chat", href: `${base}/chat` },
    { id: "files", label: "Files", href: `${base}/files` },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "0 24px",
        borderBottom: "1px solid #2A2A2D",
        background: "#1A1A1C",
      }}
    >
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "12px 16px",
              fontSize: 14,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "white" : "rgba(255,255,255,0.55)",
              textDecoration: "none",
              // Underline indicator. marginBottom: -1 overlaps the
              // parent's borderBottom so the active tab's blue line
              // visually replaces the gray divider at that segment.
              borderBottom: `2px solid ${isActive ? "#108CE9" : "transparent"}`,
              marginBottom: -1,
              transition:
                "color 120ms ease-out, border-color 120ms ease-out",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
