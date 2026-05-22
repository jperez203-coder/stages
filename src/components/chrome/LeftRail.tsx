"use client";

import { useState } from "react";
import Link from "next/link";
import {
  MousePointer2,
  Activity,
  Folder,
  Users,
  UserPlus,
  ExternalLink,
} from "lucide-react";
import { MembersPopover } from "./MembersPopover";
import type { ChromeMember } from "@/lib/canvas-chrome-data";

/**
 * Vertical icon rail on the left edge of the pipeline canvas. Phase 4a
 * step 5d.
 *
 * Per-pipeline section switcher — each icon corresponds to a future
 * section view. Only a subset is LIVE in 5d:
 *
 *   live: cursor (active = canvas view), members (popover), invite (→ /clients)
 *   coming-soon: chat, activity, links/files, external-link (view-as-client)
 *
 * "Coming soon" state: icon visible but muted-grey, tooltip on hover
 * ("Chat — coming soon"), NOT clickable (`disabled` + no-op handler).
 * When each feature ships later (chat in 4b, activity later, files
 * later, portal in 4c), the corresponding rail entry flips live by
 * toggling `comingSoon: false` + adding the real handler. No layout
 * change needed.
 *
 * Role gating: the "+invite" icon is owner/admin-only (canEditPipeline);
 * members + clients don't see it. Other icons visible to all agency
 * members. Client-specific rail content ships with the client portal
 * (Phase 4c) — not part of 5d.
 *
 * The rail itself is fixed chrome (doesn't pan/zoom with the canvas).
 */

const RAIL_WIDTH = 56;

type Props = {
  workspaceSlug: string;
  pipelineId: string;
  /** Pipeline members — for the Members icon popover. Same data the
   *  header avatar cluster uses; shared via PipelineChromeShell. */
  members: ChromeMember[];
  /** Workspace owner OR pipeline owner/admin. Gates the +invite icon. */
  canEditPipeline: boolean;
};

export function LeftRail({
  workspaceSlug,
  pipelineId,
  members,
  canEditPipeline,
}: Props) {
  const [membersOpen, setMembersOpen] = useState(false);

  return (
    <>
      <aside
        aria-label="Pipeline section rail"
        style={{
          width: RAIL_WIDTH,
          flexShrink: 0,
          background: "#121212",
          borderRight: "1px solid #36363A",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "16px 0",
          gap: 4,
        }}
      >
        {/* Cursor / canvas view — LIVE + currently active. The canvas
            IS what we built; this is just the indicator. Clicking does
            nothing useful (we're already here). */}
        <RailIcon
          label="Canvas"
          active
          onClick={() => {
            /* Already viewing canvas — no-op */
          }}
        >
          <MousePointer2 size={18} />
        </RailIcon>

        {/* Chat — COMING SOON (4b). Custom SVG: round speech bubble
            outline (adapted from lucide MessageCircle) + 2 horizontal
            lines inside to suggest message text. Lucide ships
            MessageCircleMore (with dots) and MessageCircle (empty) but
            not a "circle bubble with text lines" variant — closest to
            the figma reference is this inline custom. Second line
            shorter than the first so it reads "second line of a
            message" rather than two parallel bars. */}
        <RailIcon label="Chat — coming soon" comingSoon>
          <ChatBubbleLinesIcon size={18} />
        </RailIcon>

        {/* Activity — COMING SOON (later). */}
        <RailIcon label="Activity — coming soon" comingSoon>
          <Activity size={18} />
        </RailIcon>

        {/* Files — COMING SOON. Folder icon per polish round (was a
            generic Link icon; folder reads more clearly as "the
            attachments + links section." Figma shows a "1" badge here
            when files exist — we'll add it when files ship. */}
        <RailIcon label="Files — coming soon" comingSoon>
          <Folder size={18} />
        </RailIcon>

        {/* Members — LIVE. Opens the same popover as the header
            avatar cluster (shared component, same data). */}
        <RailIcon
          label="Members"
          onClick={() => setMembersOpen((v) => !v)}
        >
          <Users size={18} />
        </RailIcon>

        {/* + Invite — LIVE for owners/admins. Navigates to the
            existing /clients invite UI (built phase 3.4). The /clients
            route is also in the (canvas) route group post-Phase-1, so
            the chrome stays visible — clicking "Canvas" in the rail
            from there returns the user here. */}
        {canEditPipeline && (
          <RailIcon
            label="Invite client"
            href={`/w/${workspaceSlug}/p/${pipelineId}/clients`}
          >
            <UserPlus size={18} />
          </RailIcon>
        )}

        {/* External link / view-as-client — COMING SOON (4c, client
            portal). When the portal ships, this becomes the "open in
            client view" link. */}
        <RailIcon label="View as client — coming soon" comingSoon>
          <ExternalLink size={18} />
        </RailIcon>
      </aside>

      {membersOpen && (
        <MembersPopover
          members={members}
          anchorPosition="rail"
          // Anchored roughly opposite the Members icon in the rail.
          // The members icon is the 5th icon from the top of the rail
          // (0-indexed: 4). With 16px top padding + 36px per icon
          // (32 button + 4 gap) the icon center sits at:
          //   16 + 4 * 36 + 16 = ~176px from top. Position the popover
          //   to start at viewport-fixed top corresponding to (header
          //   52px + 176px - 6px adjustment) ≈ 222.
          anchorTop={228}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </>
  );
}

// ─── Individual rail icon ───────────────────────────────────────────────

type RailIconProps = {
  label: string;
  /** Currently-active state — only the canvas/cursor icon uses this
   *  for 5d. Renders with elevated background + bright color. */
  active?: boolean;
  /** Coming-soon state — muted + tooltip + non-clickable. */
  comingSoon?: boolean;
  /** If set, renders as a Link to this href (used by +invite → /clients). */
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
};

function RailIcon({
  label,
  active,
  comingSoon,
  href,
  onClick,
  children,
}: RailIconProps) {
  const baseStyle = {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // Active state: subtle grey wash + bright white icon (NOT purple).
    // Purple read as "this is the in-progress stage color" which clashed
    // with the canvas's in-progress purple — too much purple in the
    // viewport made the rail's active state compete with the actual
    // current stage. Neutral grey treatment keeps "I am the selected
    // view" signal via the contrast jump (white vs 60% muted) without
    // borrowing a color token that means something elsewhere.
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    border: "none",
    color: active
      ? "white"
      : comingSoon
        ? "rgba(255,255,255,0.25)"
        : "rgba(255,255,255,0.6)",
    cursor: comingSoon ? "not-allowed" : "pointer",
    transition: "background 120ms ease-out, color 120ms ease-out",
  } as const;

  // Hover styling — only apply to non-active, non-coming-soon icons
  // (active stays in its highlighted state; coming-soon stays muted).
  const onMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (active || comingSoon) return;
    e.currentTarget.style.background = "rgba(255,255,255,0.06)";
    e.currentTarget.style.color = "rgba(255,255,255,0.85)";
  };
  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    if (active || comingSoon) return;
    e.currentTarget.style.background = "transparent";
    e.currentTarget.style.color = "rgba(255,255,255,0.6)";
  };

  // title attribute provides the native tooltip — same UX path as
  // /my-tasks' search "coming soon" hint. Cheap, accessible, no
  // tooltip library needed.
  if (href && !comingSoon) {
    return (
      <Link
        href={href}
        title={label}
        aria-label={label}
        style={baseStyle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={comingSoon}
      onClick={comingSoon ? undefined : onClick}
      style={baseStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </button>
  );
}

// ─── Custom chat-bubble icon ────────────────────────────────────────────

/**
 * Round speech bubble with two horizontal text lines inside. Matches
 * the figma chat icon — distinct from both the cursor (above) and the
 * folder (below) in the rail.
 *
 * Outline path adapted from lucide-react MessageCircle (same viewBox
 * + stroke style for visual consistency with the other rail icons).
 * Two `<line>` children inside the bubble represent message text;
 * the second is shorter than the first so it reads "second line of
 * a sent message" rather than parallel bars.
 *
 * Inline component because lucide doesn't ship a circle-bubble-with-
 * lines variant — only MessageCircleMore (dots) and MessageCircle
 * (empty). Defining inline rather than as a separate file because it's
 * used in exactly one place.
 */
function ChatBubbleLinesIcon({ size = 18 }: { size?: number }) {
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
      {/* Bubble outline (lucide MessageCircle's path). */}
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
      {/* Two horizontal text lines inside, vertically centered. */}
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="13" y2="14" />
    </svg>
  );
}
