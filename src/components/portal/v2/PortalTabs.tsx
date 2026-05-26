"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Folder, MousePointer2 } from "lucide-react";

/**
 * Three-tab nav for the client portal. Phase 4b-1; icons added in
 * 4b-3-e polish round to match the agency-side LeftRail vocabulary.
 *
 * Tabs are sub-routes — each Link is a real navigation, not in-page
 * tab state. Active state derives from usePathname so the indicator
 * stays in sync with browser back/forward and shareable URLs.
 *
 * Icons match agency LeftRail exactly so a user moving between agency
 * and portal sees consistent symbols for the same routes:
 *   * Canvas → MousePointer2 (lucide)
 *   * Chat   → ChatBubbleLinesIcon (FORKED from LeftRail — speech
 *     bubble with two text lines; lucide doesn't ship this variant.
 *     Forked rather than shared per the "don't touch agency code"
 *     pattern; if the design ever needs to change, update both
 *     places.)
 *   * Files  → Folder (lucide)
 */

type Props = {
  pipelineId: string;
};

type Tab = {
  id: string;
  label: string;
  href: string;
  icon: ReactNode;
};

const ICON_SIZE = 14;

export function PortalTabs({ pipelineId }: Props) {
  const pathname = usePathname();
  const base = `/portal/${pipelineId}`;

  // Tab order matches the prototype + agency rail: Canvas / Chat / Files.
  const tabs: Tab[] = [
    {
      id: "canvas",
      label: "Canvas",
      href: `${base}/canvas`,
      icon: <MousePointer2 size={ICON_SIZE} />,
    },
    {
      id: "chat",
      label: "Chat",
      href: `${base}/chat`,
      icon: <ChatBubbleLinesIcon size={ICON_SIZE} />,
    },
    {
      id: "files",
      label: "Files",
      href: `${base}/files`,
      icon: <Folder size={ICON_SIZE} />,
    },
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
              gap: 6,
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
            {tab.icon}
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Round speech bubble with two horizontal text lines inside. FORKED
 * (verbatim copy) from LeftRail.tsx — lucide doesn't ship this
 * variant (only MessageCircle / MessageCircleMore), so it's a
 * custom SVG. Forked rather than extracted into a shared icon file
 * to honor the "don't touch agency code" pattern. If the bubble
 * design ever changes, update BOTH places (LeftRail.tsx
 * ChatBubbleLinesIcon + this copy).
 *
 * Default size differs from LeftRail's (14 vs 18) because portal
 * tabs are textual and a smaller icon balances better next to the
 * 14px label; LeftRail is icon-only at 18.
 */
function ChatBubbleLinesIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="13" y2="14" />
    </svg>
  );
}
