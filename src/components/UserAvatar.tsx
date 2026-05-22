import Image from "next/image";

/**
 * Shared avatar component introduced in Phase 4a step 2 (dashboard).
 * Dashboard-only scope for now — the existing ~10 inline / Avatar.tsx usages
 * elsewhere in the codebase stay untouched. A follow-up commit will migrate
 * those call sites. Until then, two avatar implementations coexist:
 *
 *   * `src/components/Avatar.tsx` — legacy, email-keyed, used by
 *     ClientCard, ClientPortal, chat components, etc.
 *   * `src/components/UserAvatar.tsx` (this file) — user-object-keyed,
 *     used by dashboard My Tasks rows, Activity rows, and pipeline member
 *     clusters.
 *
 * Color algorithm matches HeaderProfileMenu's exactly (same hash math,
 * same brand-palette modulo) so a given user gets the same color across
 * every surface — dashboard, profile menu, future migrated call sites.
 * The palette here is the small dashboard-specific subset; HeaderProfileMenu
 * uses the wider 7-color palette. Different surfaces, intentionally
 * different palettes — but the hash math is identical so consistency
 * within a surface holds.
 */

// Hash → palette. Same hash math as HeaderProfileMenu.tsx so the modulo
// produces stable color per user across surfaces (within the same palette
// size; cross-palette identity isn't a goal).
//
// 2026-05-22 polish: switched from a 4-color single-tone palette
// (saturated fill + white letter) to a paired palette where each slot
// has a DARK muted fill + a VIVID letter color. Matches the figma
// reference for the header member cluster (#192526/#15B981,
// #351E2E/#ED4899, #293C4D/#3A97D8). The vivid letter color is the
// "user's brand color" identity-wise; the muted fill is the tile bg
// behind it. Photo avatars always render flat (no colored ring) —
// the previously-supported `bordered` variant was dropped in the
// 2026-05-22 polish pass alongside the HeaderProfileMenu stroke
// removal; ring-around-photo is no longer used on any surface.
//
// 4 pairs (bumped from 3 on 2026-05-22 polish — added amber for
// better differentiation in larger member rosters). The letter
// colors here MUST stay in sync with HeaderProfileMenu.tsx's COLORS
// array, in this exact order, so the modulo-N slot semantics line up
// across surfaces. Note: cross-surface color stability for the SAME
// user requires that both surfaces also hash the same input — they
// don't today (UserAvatar hashes user.id, HeaderProfileMenu hashes
// email), so a user may land in different slots on the two surfaces.
// Flagged but not fixed in this polish.
const AVATAR_PALETTE: ReadonlyArray<{ fill: string; letter: string }> = [
  { fill: "#192526", letter: "#15B981" }, // green
  { fill: "#351E2E", letter: "#ED4899" }, // pink
  { fill: "#293C4D", letter: "#3A97D8" }, // blue
  { fill: "#2B221E", letter: "#F59E0C" }, // amber
];

export type AvatarUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  /**
   * Optional — used ONLY for the single-character initial fallback when
   * display_name is null/empty. Never rendered in alt, aria-label, or any
   * tooltip. This guard exists because clients are most likely to have
   * null display_name (invited, haven't set one), and leaking an email
   * across the agency/client boundary via a tooltip would be a real
   * privacy bug. Keep email-derivation strictly inside this component.
   */
  email?: string | null;
};

type Props = {
  user: AvatarUser;
  /** Pixel diameter. Font size is 0.5× this. */
  size: number;
};

export function UserAvatar({ user, size }: Props) {
  // Deterministic color from user.id so the same person gets the same
  // color across renders, sessions, devices. id is a uuid string;
  // charCodeAt over the whole string gives enough entropy to spread
  // evenly across the 3-pair palette. The assignment LOOKS random to
  // an observer (no obvious letter→color relationship) but is stable
  // per-user — Casey always gets her hash slot, Taylor always gets
  // hers, etc. Locked behavior 2026-05-22 (rolled back a brief
  // letter-based experiment because the spec is "random per user with
  // no photo," not "color follows letter").
  let hash = 0;
  for (let i = 0; i < user.id.length; i++) {
    hash = user.id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];

  // Initial fallback chain: avatar_url (handled below) → display_name → email → "?"
  // Email is used only for the initial char; never exposed to alt/aria.
  // A uuid's hex first-char (the previous fallback) renders as meaningless
  // "4" or "f" — replaced here with the email initial so invited clients
  // show as e.g. "J" for jane@…, not "4" for their row's uuid prefix.
  const initial = (
    user.display_name?.trim()?.[0] ??
    user.email?.trim()?.[0] ??
    "?"
  ).toUpperCase();

  // Initial scale bumped 0.4 → 0.5 of avatar diameter so CSS-rendered
  // letters match the visual size of photo-rendered avatars from
  // Google's default-avatar service (whose glyph fills more of the
  // tile than our previous 40% scale). Polish 2026-05-22.
  const fontSize = Math.round(size * 0.5);
  // Proportional rounded-square corner — matches the header avatar's
  // 10px-on-40px aesthetic (25% of size, clamped at 4px minimum). At
  // common dashboard sizes: 24→6, 32→8, 40→10. Replaces the previous
  // "50%" circle treatment per the 2026-05-20 polish round.
  const cornerRadius = `${Math.max(4, Math.round(size * 0.25))}px`;
  // Aria-label intentionally omits email (privacy). Falls through to a
  // generic literal when display_name is missing — better than leaking
  // identity via the avatar's accessible name.
  const ariaName = user.display_name ?? "User avatar";

  if (user.avatar_url) {
    return (
      <Image
        src={user.avatar_url}
        alt={user.display_name ?? ""}
        width={size}
        height={size}
        unoptimized
        style={{
          width: `${size}px`,
          height: `${size}px`,
          boxSizing: "border-box",
          borderRadius: cornerRadius,
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
          // No stroke around photo avatars anywhere — Jordan polish
          // 2026-05-22. The previously-supported `bordered` variant
          // (2px colored ring used by MembersPopover) was removed
          // alongside the prop; photo avatars render flat across all
          // surfaces.
          border: "none",
        }}
      />
    );
  }

  return (
    <div
      // font-bold (700) so CSS-rendered initials match the visual
      // weight of photo-rendered avatars from Google's default-avatar
      // service (whose baked-in glyph reads bolder than font-medium).
      // Polish 2026-05-22.
      className="flex items-center justify-center font-bold flex-shrink-0"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        // Paired palette: muted dark fill behind a vivid letter — the
        // letter color is the user's identity color. Matches the figma
        // member-cluster reference and the chunky chip aesthetic.
        background: palette.fill,
        color: palette.letter,
        borderRadius: cornerRadius,
        fontSize: `${fontSize}px`,
        lineHeight: 1,
        userSelect: "none",
      }}
      aria-label={ariaName}
    >
      {initial}
    </div>
  );
}
