"use client";

import { useEffect, useRef } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { resolveDisplayName } from "@/lib/display-name";
import type { ChromeMember } from "@/lib/canvas-chrome-data";

/**
 * NF-2.1: @mention autocomplete picker. Rendered above the composer
 * textarea when the user is mid-typing an @-token. Mirrors the
 * MembersPopover row shape (avatar + name + role badge), tightened
 * to a compact dropdown.
 *
 * Selection inserts the picker's canonical token (display-name-spaceless
 * preferred) so the typed mention always matches a form the
 * send_channel_message RPC can resolve. Eliminates the
 * "@William Wayne" / "@williamwayne" papercut.
 *
 * Positioning: anchored to the composer wrapper via bottom: 100%.
 * Simple absolute positioning — no floating-ui dependency added in
 * NF-2.1. If we ever need viewport-collision avoidance (e.g., a
 * full-screen composer that pushes the picker off-screen), upgrade
 * to @floating-ui/react in a separate commit.
 */

export type MentionCandidate = {
  /** Auth.users.id — what gets resolved on the RPC side. Picker uses
   *  it only for stable React keys + avatar color hashing. */
  id: string;
  /** Canonical insertable token. Always lowercase + no whitespace. */
  token: string;
  /** Display data — passed through to the row UI. */
  displayName: string | null;
  email: string | null;
  avatarUrl: string | null;
  /** "Member" or "Client" — the badge string the row renders. */
  roleBadge: "Member" | "Client";
};

type Props = {
  candidates: MentionCandidate[];
  highlightedIndex: number;
  onHover: (index: number) => void;
  onSelect: (candidate: MentionCandidate) => void;
};

export function MentionPicker({
  candidates,
  highlightedIndex,
  onHover,
  onSelect,
}: Props) {
  // Keep the highlighted row scrolled into view as keyboard nav moves.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(
      `[data-mention-row="${highlightedIndex}"]`,
    );
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  if (candidates.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Mention suggestions"
      ref={listRef}
      style={{
        position: "absolute",
        // Position above the composer wrapper. The Composer container
        // declares position:relative on its outer div so this anchors
        // cleanly. 8px gap keeps the dropdown from kissing the border.
        bottom: "calc(100% + 8px)",
        left: 0,
        width: 320,
        maxHeight: 280,
        overflowY: "auto",
        background: "#212124",
        border: "1px solid #36363A",
        borderRadius: 10,
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        padding: 4,
        zIndex: 20,
      }}
    >
      {candidates.map((cand, idx) => {
        const isHighlighted = idx === highlightedIndex;
        const displayName = resolveDisplayName(
          {
            display_name: cand.displayName,
            email: cand.email,
          },
          { whenMissing: "Pending member" },
        );
        return (
          <div
            key={cand.id}
            role="option"
            aria-selected={isHighlighted}
            data-mention-row={idx}
            onMouseDown={(e) => {
              // mousedown (not click) so the textarea doesn't blur
              // before we can capture the selection. Blur tears down
              // the picker; we'd lose the insert.
              e.preventDefault();
              onSelect(cand);
            }}
            onMouseEnter={() => onHover(idx)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 6,
              cursor: "pointer",
              background: isHighlighted ? "#2C2C2F" : "transparent",
              transition: "background 80ms",
            }}
          >
            <UserAvatar
              user={{
                id: cand.id,
                display_name: cand.displayName,
                avatar_url: cand.avatarUrl,
                email: cand.email,
              }}
              size={24}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.92)",
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {displayName}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.45)",
                  marginTop: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                @{cand.token}
              </div>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color:
                  cand.roleBadge === "Client"
                    ? "#22D3EE"
                    : "rgba(255,255,255,0.55)",
                background:
                  cand.roleBadge === "Client"
                    ? "rgba(34,211,238,0.10)"
                    : "rgba(255,255,255,0.06)",
                padding: "2px 6px",
                borderRadius: 4,
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              {cand.roleBadge}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * NF-2.1: pure helper. Detects an active @-token at the cursor
 * position. Returns null when the cursor is NOT inside a mention
 * (no preceding @, or whitespace between @ and cursor).
 *
 * Rules:
 *   * @ must be at index 0 OR preceded by whitespace
 *   * No whitespace between the @ and the cursor
 *   * The partial after @ may be empty (just-typed @) — that's a
 *     valid active token with empty filter (picker shows everything)
 *
 * Returns { startIndex, partial } where startIndex is the index of
 * the @ itself in `text` and partial is everything between @ and cursor.
 */
export function detectActiveMentionToken(
  text: string,
  cursor: number,
): { startIndex: number; partial: string } | null {
  // Walk backward from cursor to find the @ or hit whitespace/start.
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      // @ must be at start OR preceded by whitespace.
      if (i === 0 || /\s/.test(text[i - 1] ?? "")) {
        return { startIndex: i, partial: text.slice(i + 1, cursor) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/**
 * NF-2.1: build the filtered + sorted candidate list for the picker.
 *
 * Filter rule: a member matches if either of their normalized
 * identifiers STARTS WITH the (lowercased) partial. Empty partial
 * shows everyone in the audience.
 *
 * Excludes the viewer (no self-mention from the picker).
 * Excludes members whose canonical token cannot be derived.
 *
 * Sort: alphabetical by displayName-or-email, case-insensitive.
 * Capped at top 8.
 */
export function buildMentionCandidates(
  members: ChromeMember[],
  partial: string,
  viewerId: string,
  pickToken: (profile: {
    display_name: string | null;
    email: string | null;
  }) => string | null,
  normalizedIdsFor: (profile: {
    display_name: string | null;
    email: string | null;
  }) => string[],
): MentionCandidate[] {
  const normalizedPartial = partial.toLowerCase();
  const out: MentionCandidate[] = [];

  for (const m of members) {
    if (m.user.id === viewerId) continue;

    const token = pickToken({
      display_name: m.user.display_name,
      email: m.user.email,
    });
    if (!token) continue;

    if (normalizedPartial.length > 0) {
      const ids = normalizedIdsFor({
        display_name: m.user.display_name,
        email: m.user.email,
      });
      if (!ids.some((id) => id.startsWith(normalizedPartial))) continue;
    }

    out.push({
      id: m.user.id,
      token,
      displayName: m.user.display_name,
      email: m.user.email,
      avatarUrl: m.user.avatar_url,
      roleBadge: m.role === "client" ? "Client" : "Member",
    });
  }

  out.sort((a, b) => {
    const aLabel = (a.displayName ?? a.email ?? "").toLowerCase();
    const bLabel = (b.displayName ?? b.email ?? "").toLowerCase();
    return aLabel.localeCompare(bLabel);
  });

  return out.slice(0, 8);
}
