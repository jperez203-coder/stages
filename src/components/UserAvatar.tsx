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
// size; cross-palette identity isn't a goal). The four-color palette below
// is the Phase 4a brand subset per the spec.
const COLORS = ["#DF1E5A", "#E273C1", "#21B159", "#36C5EF"];

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
  /** Pixel diameter. Font size is 0.4× this. */
  size: number;
};

export function UserAvatar({ user, size }: Props) {
  // Deterministic color from user.id so the same person gets the same
  // color across renders, sessions, devices. id is a uuid string;
  // charCodeAt over the whole string gives enough entropy to spread
  // evenly across the 4-color palette.
  let hash = 0;
  for (let i = 0; i < user.id.length; i++) {
    hash = user.id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = COLORS[Math.abs(hash) % COLORS.length];

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

  const fontSize = Math.round(size * 0.4);
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
          borderRadius: cornerRadius,
          objectFit: "cover",
          flexShrink: 0,
          display: "block",
        }}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center font-medium flex-shrink-0"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background: color,
        color: "white",
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
