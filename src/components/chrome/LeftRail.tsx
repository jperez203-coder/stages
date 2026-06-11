"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MousePointer2,
  Activity,
  Folder,
  Users,
  ExternalLink,
} from "lucide-react";
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
  /** Pipeline members. Pre-PI-6 LeftRail rendered its own standalone
   *  Members popover trigger and consumed this prop directly; PI-6
   *  moved member viewing into the People tab (sub-tab Members) and
   *  removed the rail icon. The PipelineHeader avatar-cluster popover
   *  still shows the same data via its own copy of this prop. Kept on
   *  the rail's contract for symmetry — PipelineChromeShell passes it
   *  to both surfaces from one bundle. */
  members: ChromeMember[];
  /** Workspace owner OR pipeline owner/admin. Gates the People icon. */
  canEditPipeline: boolean;
  /** WORKSPACE-level owner/admin specifically (NOT pipeline-level admins).
   *  Gates the "View as client" icon — previewing the client portal is a
   *  workspace-operator affordance, narrower than canEditPipeline. */
  isWorkspaceOwnerOrAdmin: boolean;
  /** WT-5: parent workspace category. Personal workspaces have no
   *  client portal surface, so the People rail icon and "View as
   *  client" affordance are hidden on personal. Threaded from the
   *  canvas layout via PipelineChromeShell. */
  workspaceType: "agency" | "personal";
};

export function LeftRail({
  workspaceSlug,
  pipelineId,
  members: _members,
  canEditPipeline,
  isWorkspaceOwnerOrAdmin,
  workspaceType,
}: Props) {
  const isPersonal = workspaceType === "personal";
  const pathname = usePathname();

  // Section-icon active state derives from the current pathname:
  //   * Canvas (cursor)   → pathname is exactly `/w/<slug>/p/<id>`
  //   * Chat              → pathname ends with `/chat`
  // The +invite icon is not a section toggle — it's an action that takes
  // you to /clients — so /clients renders with no section icon active
  // (cursor and chat both correctly read as "not the current surface").
  // 4b slice 1 wires the chat icon active state; chat surface ships
  // with this commit.
  const canvasPath = `/w/${workspaceSlug}/p/${pipelineId}`;
  const chatPath = `${canvasPath}/chat`;
  const filesPath = `${canvasPath}/files`;
  const onCanvas = pathname === canvasPath;
  const onChat = pathname === chatPath;
  const onFiles = pathname === filesPath;

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
        {/* Cursor / canvas view — LIVE. Active when on the canvas
            route exactly. Renders as a Link back to the canvas from
            sibling routes (/clients, /chat) so users can return to
            the canvas surface in one click. */}
        <RailIcon label="Canvas" href={canvasPath} active={onCanvas}>
          <MousePointer2 size={18} />
        </RailIcon>

        {/* Chat — LIVE as of 4b slice 1. Active when pathname ends
            /chat. Round speech bubble + two horizontal text lines —
            see ChatBubbleLinesIcon below. */}
        <RailIcon label="Chat" href={chatPath} active={onChat}>
          <ChatBubbleLinesIcon size={18} />
        </RailIcon>

        {/* Activity — COMING SOON (later). */}
        <RailIcon label="Activity — coming soon" comingSoon>
          <Activity size={18} />
        </RailIcon>

        {/* Files — LIVE as of 4b-3-b. Active when pathname ends /files.
            Folder icon per polish round; figma's "1" badge for non-empty
            state is deferred (file counts come from pipeline_links;
            badge wire-up can come in a polish pass once we have real
            usage data on whether the count is useful here). */}
        <RailIcon label="Files" href={filesPath} active={onFiles}>
          <Folder size={18} />
        </RailIcon>

        {/* PI-6: the standalone Members popover trigger was removed
            here — viewing pipeline members now lives in the People
            tab's Members sub-tab. The PipelineHeader avatar-cluster
            click still opens the same popover for a quick peek. */}

        {/* People — LIVE for owners/admins. Navigates to the unified
            /clients route which hosts the People tab with Members |
            Clients sub-tabs (PI-6). URL stays /clients/ for backward
            compat with bookmarks + the email magic-link redirect
            target. WT-5: hidden on personal workspaces (no member
            invites + no client portal surface). */}
        {canEditPipeline && !isPersonal && (
          <RailIcon
            label="People"
            href={`/w/${workspaceSlug}/p/${pipelineId}/clients`}
          >
            <Users size={18} />
          </RailIcon>
        )}

        {/* View as client — LIVE. Workspace owners/admins only (a
            workspace-operator affordance, NOT pipeline-level admins or
            members — hence isWorkspaceOwnerOrAdmin, which is narrower
            than canEditPipeline). Opens the pipeline's client portal in
            a new tab so the agency's canvas tab stays put; the portal
            route accepts workspace owner/admin (portal layout gate
            widened in 20260614120000 / commit 20a6aa1) and shows the
            "Viewing as client → Switch to agency view" banner there.
            WT-5: hidden on personal workspaces (no client portal). */}
        {isWorkspaceOwnerOrAdmin && !isPersonal && (
          <RailIcon
            label="View as client"
            onClick={() =>
              window.open(`/portal/${pipelineId}`, "_blank", "noopener")
            }
          >
            <ExternalLink size={18} />
          </RailIcon>
        )}
      </aside>

      {/* PI-6: rail-anchored MembersPopover removed alongside the
          standalone Members icon. PipelineHeader's avatar-cluster
          popover is the only remaining trigger. */}
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
