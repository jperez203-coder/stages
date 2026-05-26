"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookmarkPlus, Check, MoreHorizontal, Pencil } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { HeaderProfileMenu } from "@/components/app/HeaderProfileMenu";
import { SaveAsTemplateModal } from "@/components/templates/SaveAsTemplateModal";
import { MembersPopover } from "./MembersPopover";
import { useEditMode } from "./EditModeContext";
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
  /** Hide the Edit pipeline toggle button entirely (e.g. on /clients,
   *  where edit mode doesn't apply). Defaults to false. */
  hideEditButton?: boolean;
};

export function PipelineHeader({
  workspaceSlug,
  chrome,
  completedTasks,
  totalTasks,
  user,
  hideEditButton = false,
}: Props) {
  const [membersOpen, setMembersOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const { editMode, toggleEditMode } = useEditMode();

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

        {chrome.canEditPipeline && !hideEditButton && (
          <EditPipelineToggleButton
            editMode={editMode}
            onToggle={toggleEditMode}
          />
        )}

        {/* Overflow menu (slice 3, 2026-05-26). Only item today is
            "Save as template" — gated on canEditPipeline because the
            RPC also gates on can_edit_pipeline server-side (defense
            in depth). Trigger button is gated on the same flag so
            non-editors don't see an empty menu.
            NOT gated on `hideEditButton` — the overflow menu is
            independent of edit mode; saving a template makes sense
            on any canvas-group tab (chat/files/clients too). When
            more items are added later that don't require
            canEditPipeline, the trigger gate can relax. */}
        {chrome.canEditPipeline && (
          <PipelineOverflowMenu
            onSaveAsTemplate={() => setSaveTemplateOpen(true)}
          />
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

      {saveTemplateOpen && (
        <SaveAsTemplateModal
          sourcePipelineId={chrome.pipeline.id}
          defaultName={chrome.pipeline.name}
          onCancel={() => setSaveTemplateOpen(false)}
          onSaved={() => setSaveTemplateOpen(false)}
        />
      )}
    </>
  );
}

// ─── Edit pipeline toggle (5e — was a console.log stub in 5d) ────────────

/**
 * "Edit pipeline" ↔ "Done editing" toggle. Inactive styling matches the
 * 5d-era stub (subtle white-on-dark chip). Active styling uses the
 * #108CE9 (stages-blue) accent — distinct enough from purple
 * (in-progress) and green (done) that the chrome's "we're editing"
 * signal can't be confused with a stage state signal. Mirrors the same
 * accent we use on the canvas's thin top-border edit-mode signal.
 */
function EditPipelineToggleButton({
  editMode,
  onToggle,
}: {
  editMode: boolean;
  onToggle: () => void;
}) {
  const active = editMode;

  // Inline colour tokens — kept here vs hoisted because they're the
  // only place in the file that needs a "blue active" variant; if a
  // second consumer ever needs this treatment, extract into globals.css.
  const bg = active ? "rgba(16,140,233,0.18)" : "rgba(255,255,255,0.06)";
  const bgHover = active ? "rgba(16,140,233,0.28)" : "rgba(255,255,255,0.1)";
  const border = active ? "#108CE9" : "#36363A";
  const fg = active ? "#108CE9" : "rgba(255,255,255,0.85)";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 32,
        padding: "0 12px",
        borderRadius: 8,
        background: bg,
        border: `1px solid ${border}`,
        color: fg,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        flexShrink: 0,
        transition:
          "background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = bgHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = bg)}
    >
      {active ? <Check size={13} /> : <Pencil size={13} />}
      {active ? "Done editing" : "Edit pipeline"}
    </button>
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
        // Pill container wrapping the cluster — matches the figma
        // reference's outer rect: fill #121212, 1px #36363A stroke,
        // rx proportional to height (~0.21). Hover deepens border to
        // #4A4A50. Sized down 2026-05-22 polish round (was padding
        // 4px/5px + radius 9 around a 34px tile; now 3px/4px + radius 8
        // around a 30px tile — same proportions, ~12% smaller overall).
        display: "flex",
        alignItems: "center",
        background: "#121212",
        border: "1px solid #36363A",
        padding: "3px 4px",
        cursor: "pointer",
        borderRadius: 8,
        flexShrink: 0,
        transition: "border-color 120ms ease-out",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.borderColor = "#4A4A50")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.borderColor = "#36363A")
      }
    >
      {visible.map((m, idx) => (
        <span
          key={m.user.id}
          style={{
            // Tiles: 30×30 wrapper (24px UserAvatar + 3px #121212 ring
            // on each side) with rx ≈ 0.3 × wrapper = 9 → keeps the
            // figma reference's wrapper-rx ratio (11.5/39 ≈ 0.295).
            // The 3px ring is the dark separator that shows between
            // overlapping tiles — preserved at original thickness so
            // the separator remains visually crisp at the smaller
            // tile size. Overlap proportional to wrapper.
            marginLeft: idx === 0 ? 0 : -7,
            borderRadius: 9,
            background: "#121212",
            padding: 3,
            display: "inline-flex",
          }}
        >
          <UserAvatar user={m.user} size={24} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{
            // Same tile treatment as a member avatar — wrapper ring +
            // proportional corner radius — but with #36363A fill +
            // white text instead of a deterministic per-user color.
            // Reads as "more members, none of them individually" while
            // staying visually flush with the avatar tiles.
            marginLeft: -7,
            borderRadius: 9,
            background: "#121212",
            padding: 3,
            display: "inline-flex",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "#36363A",
              color: "white",
              fontSize: 10,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            +{overflow}
          </span>
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

// ─── Overflow menu (slice 3 — 2026-05-26) ──────────────────────────────
//
// Small "..." button + dropdown anchored bottom-right of the trigger.
// Self-contained: owns its open state, click-outside listener, Esc
// handler. Parent passes a callback per menu item.
//
// Currently one item — "Save as template". Future items (Archive,
// Duplicate, Rename, etc.) get added here without restructuring the
// trigger. When a future item should be visible to non-editors, the
// trigger-level gate in PipelineHeader needs to relax accordingly.
//
// Z-index: dropdown sits at z-45, above the header's z-40 sticky
// container but below any full-screen modal (z-100). Matches the
// MembersPopover's positioning posture.

function PipelineOverflowMenu({
  onSaveAsTemplate,
}: {
  onSaveAsTemplate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside mousedown. Mousedown (not click) so the closer
  // fires before any click handler inside the menu — prevents a stray
  // re-open race when the trigger button is part of the same DOM.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Pipeline actions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: open ? "rgba(255,255,255,0.06)" : "transparent",
          border: `1px solid ${open ? "#4A4A50" : "transparent"}`,
          color: "rgba(255,255,255,0.7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition:
            "background 120ms ease-out, border-color 120ms ease-out",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 200,
            background: "#1A1A1C",
            border: "1px solid #36363A",
            borderRadius: 10,
            boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
            zIndex: 45,
            padding: 4,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSaveAsTemplate();
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              background: "transparent",
              border: "none",
              borderRadius: 6,
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "#28282C")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <BookmarkPlus size={14} style={{ flexShrink: 0 }} />
            Save as template
          </button>
        </div>
      )}
    </div>
  );
}
