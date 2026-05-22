"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import type { ChromeMember } from "@/lib/canvas-chrome-data";

/**
 * Pipeline members popover. Phase 4a step 5d.
 *
 * Shared by two triggers in the canvas chrome:
 *   * Header avatar cluster click (top-right of PipelineHeader)
 *   * Left rail "Members" icon click
 *
 * Both render this same popover with the same data — fetched once
 * server-side via fetchCanvasChromeData. The popover anchors near
 * its trigger; the caller passes an `anchorPosition` prop ("header"
 * for top-right, "rail" for left-near-rail).
 *
 * Styling matches the figma `members_tab.png` reference:
 *   * Large "Members" title + "{N} members" subcount line
 *   * Subtle divider below the header block
 *   * Per-row: 48px square avatar with COLORED STROKE around photos
 *     (initial-variant avatars use the color as background, no border
 *     needed), bold name, muted role text on the line below
 *   * X close button top-right
 *
 * Click-outside closes. Esc closes. Members are listed agency-first
 * (owner → admin → member → client) within group by joined_at; that
 * sort happens upstream in fetchCanvasChromeData. No member-management
 * actions here — that lives in /clients (for client members) and
 * /settings/team (for workspace members).
 */

type Props = {
  members: ChromeMember[];
  /** Where to anchor visually — drives left/right positioning.
   *  - "header": top-right under the header's avatar cluster
   *  - "rail":   right of the rail, vertically near the Members icon */
  anchorPosition: "header" | "rail";
  /** Y-pixel offset (from the trigger element) — passed by the caller
   *  to fine-tune vertical anchoring against the actual button. */
  anchorTop: number;
  onClose: () => void;
};

export function MembersPopover({
  members,
  anchorPosition,
  anchorTop,
  onClose,
}: Props) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close. Bind to mousedown (not click) so the
  // popover dismisses before any button it covers fires its onClick.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (!popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Position: header anchor pulls right-aligned to viewport's right
  // edge with margin; rail anchor pushes right-of-rail with margin.
  const positionStyle =
    anchorPosition === "header"
      ? { right: 20, top: anchorTop }
      : { left: 60, top: anchorTop };

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Pipeline members"
      style={{
        position: "fixed",
        ...positionStyle,
        zIndex: 50,
        // Sized down ~25% from first pass (was 360/20/14): popover felt
        // too imposing for what's essentially a roster list. 300px wide
        // + 14px padding + 12px corners reads as a "compact menu" rather
        // than a dialog.
        width: 300,
        maxHeight: 460,
        overflowY: "auto",
        background: "#1F1F22",
        border: "1px solid #36363A",
        borderRadius: 12,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        padding: 14,
      }}
    >
      {/* Header: title + close + subcount + divider */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "white",
              lineHeight: 1.1,
            }}
          >
            Members
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              fontWeight: 400,
            }}
          >
            {members.length} {members.length === 1 ? "member" : "members"}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close members"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: 6,
            background: "transparent",
            border: "1px solid #36363A",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
            flexShrink: 0,
            transition: "background 120ms ease-out, color 120ms ease-out",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "white";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(255,255,255,0.6)";
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Divider */}
      <div
        aria-hidden
        style={{
          height: 1,
          background: "#36363A",
          marginTop: 12,
          marginBottom: 2,
        }}
      />

      {/* Member rows */}
      {members.length === 0 ? (
        <div
          style={{
            padding: "20px 4px",
            fontSize: 14,
            color: "rgba(255,255,255,0.5)",
          }}
        >
          No members yet.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            // gap bumped from 4 → 8 (2026-05-22 polish) — at 4 + 6px
            // row vertical padding, members felt stacked. 8 adds a
            // breath of space between rows without growing the
            // popover much (~16px taller across 5 members).
            gap: 8,
            marginTop: 8,
          }}
        >
          {members.map((m) => (
            <MemberRow key={m.user.id} member={m} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single member row ──────────────────────────────────────────────────

function MemberRow({ member }: { member: ChromeMember }) {
  const displayName = resolveMemberDisplay(member.user);
  // Role label — capitalize the lowercase schema value for display.
  const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 4px",
      }}
    >
      <UserAvatar user={member.user} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "white",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 12,
            color: "rgba(255,255,255,0.45)",
            lineHeight: 1.2,
          }}
        >
          {roleLabel}
        </div>
      </div>
    </div>
  );
}

// ─── Display-name resolution ────────────────────────────────────────────

/**
 * Resolve the rendered name for a member, walking the same fallback
 * chain that UserAvatar uses for the initial char:
 *
 *   display_name (trimmed, non-empty)
 *     → email PREFIX (the part before '@', e.g. "jane.doe" from
 *       "jane.doe@example.com")
 *     → "Pending member" (truly nothing — defensive case for
 *       missing-profile-row / invited-but-not-onboarded scenarios)
 *
 * Per Jordan 2026-05-22: real invited-but-not-yet-onboarded users
 * have null display_name. Showing "Unknown" there looks broken in a
 * real product. Email prefix is friendly + readable + matches what
 * the avatar initial derives from (so the avatar's "J" lines up with
 * the text "jane.doe" instead of "Unknown").
 *
 * If display_name AND email are both null (schema-illegal since
 * profiles.email is NOT NULL, but defensive against RLS-filtered
 * fetches that return undefined for some user_ids), fall back to
 * "Pending member" — still bad-data signal, but more informative
 * than "Unknown". This case should only fire when something has
 * gone wrong upstream (broken profile fetch, missing profile row).
 */
function resolveMemberDisplay(user: {
  display_name: string | null;
  email: string | null;
}): string {
  const name = user.display_name?.trim();
  if (name) return name;
  const email = user.email?.trim();
  if (email) {
    const atIdx = email.indexOf("@");
    return atIdx > 0 ? email.slice(0, atIdx) : email;
  }
  return "Pending member";
}
