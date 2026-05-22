"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { HeaderProfileMenu } from "@/components/app/HeaderProfileMenu";
import { MembersPopover } from "./MembersPopover";
import type {
  CanvasChromeData,
  ChromeMember,
} from "@/lib/canvas-chrome-data";

/**
 * Pipeline canvas header. Phase 4a step 5d.
 *
 * Renders ABOVE the canvas + rail. Replaces the dashboard's AppShell
 * nav for the (canvas) route group only — sibling routes in
 * (workspace) keep their AppShell.
 *
 * Left:    [← back] [icon] [name + subline]
 * Right:   [member cluster] [Edit pipeline] | [profile menu]
 *
 * VISUAL SEPARATION between member cluster + profile menu (per
 * Jordan's spec): clear gap + a vertical divider between the two so
 * the cluster reads as "pipeline people" and the profile menu reads as
 * "me, the logged-in user." Without the separator they'd be ambiguous
 * piles of avatars.
 *
 * "Edit pipeline" button:
 *   * Visible only when `canEditPipeline === true` (workspace owner OR
 *     pipeline owner/admin). Mirrors the same gate used everywhere else.
 *   * Click is STUBBED in 5d — `console.log` only. Edit mode ships in
 *     5e.
 *
 * Member cluster click opens MembersPopover (top-right anchor).
 * Subline format: "Last edited {rel} · {completed}/{total} completed · {company}"
 * with `{company}` omitted when null.
 */

const HEADER_HEIGHT = 52; // px — shorter than AppShell's 64px per figma

type Props = {
  workspaceSlug: string;
  chrome: CanvasChromeData;
  /** Aggregated task counts across the pipeline — caller computes from
   *  whatever tasks data they already have. Passed in to avoid
   *  refetching tasks just for a count. */
  completedTasks: number;
  totalTasks: number;
  /** Logged-in user's profile fields — fed straight into HeaderProfileMenu. */
  user: {
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

export function PipelineHeader({
  workspaceSlug,
  chrome,
  completedTasks,
  totalTasks,
  user,
}: Props) {
  const [membersOpen, setMembersOpen] = useState(false);

  const lastEdited = relativeTime(chrome.pipeline.last_edited_at);
  const subline = buildSubline({
    lastEdited,
    completed: completedTasks,
    total: totalTasks,
    company: chrome.pipeline.company,
  });

  return (
    <>
      <header
        className="sticky top-0 z-40"
        style={{
          height: HEADER_HEIGHT,
          background: "#121212",
          borderBottom: "1px solid #36363A",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: 12,
        }}
      >
        {/* ── LEFT: back arrow + icon + name + subline ──────────────── */}
        <Link
          href={`/w/${workspaceSlug}`}
          aria-label="Back to workspace"
          style={{
            // Boxed treatment matching the emoji box next to it: same
            // size, same corner radius, same #212124 fill + #36363A
            // border. The pair (back arrow + emoji) now reads as two
            // consistent chip controls in the top-left rather than an
            // unframed arrow next to a framed emoji.
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#212124",
            border: "1px solid #36363A",
            color: "rgba(255,255,255,0.7)",
            flexShrink: 0,
            transition: "background 120ms ease-out, color 120ms ease-out",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#2C2C2F";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#212124";
            e.currentTarget.style.color = "rgba(255,255,255,0.7)";
          }}
        >
          <ArrowLeft size={16} />
        </Link>

        <div
          aria-hidden
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#212124",
            border: "1px solid #36363A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          {chrome.pipeline.emoji}
        </div>

        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "white",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {chrome.pipeline.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subline}
          </div>
        </div>

        {/* ── RIGHT: member cluster + Edit button — separator — profile menu ── */}
        <MemberCluster
          visible={chrome.visibleMembers}
          overflow={chrome.overflowMembers}
          onClick={() => setMembersOpen((v) => !v)}
        />

        {chrome.canEditPipeline && (
          <button
            type="button"
            onClick={() => {
              // Step 5e ships the edit mode. For 5d this is a stub.
              console.log("[5d] Edit pipeline clicked — 5e wires this", {
                pipelineId: chrome.pipeline.id,
              });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid #36363A",
              color: "rgba(255,255,255,0.85)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              flexShrink: 0,
              transition: "background 120ms ease-out",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(255,255,255,0.1)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "rgba(255,255,255,0.06)")
            }
          >
            <Pencil size={13} />
            Edit pipeline
          </button>
        )}

        {/* Visual separator between "pipeline people" (left) and
            "the logged-in user, me" (right). 1px vertical line with
            extra horizontal spacing on each side so the two regions
            read as distinct. Per Jordan's spec — don't let cluster +
            profile menu pile up as one ambiguous avatar group. */}
        <div
          aria-hidden
          style={{
            width: 1,
            height: 24,
            background: "#36363A",
            margin: "0 4px",
            flexShrink: 0,
          }}
        />

        <HeaderProfileMenu
          email={user.email}
          displayName={user.displayName}
          avatarUrl={user.avatarUrl}
          // Smaller trigger here than in AppShell — the pipeline header
          // is 52px tall vs AppShell's 64px, so the default 40px avatar
          // crowded the nav edges. 32px gives ~10px breathing room top
          // + bottom and reads proportional to the header height.
          size={32}
        />
      </header>

      {membersOpen && (
        <MembersPopover
          members={chrome.members}
          anchorPosition="header"
          anchorTop={HEADER_HEIGHT + 6}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </>
  );
}

// ─── Member cluster (overlapping avatars + click target) ─────────────────

function MemberCluster({
  visible,
  overflow,
  onClick,
}: {
  visible: ChromeMember[];
  overflow: number;
  onClick: () => void;
}) {
  // If there are no visible members, render nothing — matches the
  // dashboard's MemberCluster guard. Without this, the click target
  // still rendered as an empty 8px-wide button (because of padding),
  // creating an invisible-but-clickable region between the subline
  // and the Edit pipeline button. The pre-fix bug where the cluster
  // appeared "missing" was a data problem (chrome data query returned
  // empty due to a broken nested-select — now fixed) AND this
  // missing guard combined. Both addressed.
  if (visible.length === 0 && overflow === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Pipeline members${overflow > 0 ? ` (+${overflow} more)` : ""}`}
      style={{
        display: "flex",
        alignItems: "center",
        background: "transparent",
        border: "none",
        padding: "4px 4px",
        cursor: "pointer",
        borderRadius: 6,
        flexShrink: 0,
        transition: "background 120ms ease-out",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(255,255,255,0.04)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      {visible.map((m, idx) => (
        <span
          key={m.user.id}
          style={{
            // Overlap each avatar slightly into the previous one — the
            // canonical "cluster" treatment from the dashboard's
            // PipelineCard.
            marginLeft: idx === 0 ? 0 : -8,
            // Square-ish wrapper (6px corners) so the cluster reads as
            // rounded-SQUARE chips matching the profile menu's avatar +
            // the popover's avatars. Previously used borderRadius:"50%"
            // which made the dark wrapper background show as a circular
            // halo at the corners of the rounded-square inner avatar,
            // making the whole thing read more circular than intended.
            borderRadius: 6,
            background: "#121212",
            padding: 2,
            display: "inline-flex",
          }}
        >
          <UserAvatar user={m.user} size={24} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{
            marginLeft: -8,
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "#36363A",
            color: "rgba(255,255,255,0.7)",
            fontSize: 10,
            fontWeight: 600,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #121212",
          }}
        >
          +{overflow}
        </span>
      )}
    </button>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  // Simple "Xm/h/d/w ago" string. Server-rendered (it's called from a
  // server-fetched timestamp); accept slight skew vs. the user's clock
  // since the precision needed is "rough" — no live ticking required.
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

function buildSubline({
  lastEdited,
  completed,
  total,
  company,
}: {
  lastEdited: string;
  completed: number;
  total: number;
  company: string | null;
}): string {
  const parts = [
    `Last edited ${lastEdited}`,
    `${completed}/${total} completed`,
  ];
  if (company) parts.push(company);
  return parts.join(" · ");
}
