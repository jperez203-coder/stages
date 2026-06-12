import Image from "next/image";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";

/**
 * Shared avatar component. PI-followup-1: color derivation centralized
 * via getAvatarColorFromUserId — same user gets the same color on
 * every surface that uses the helper (header profile menu, member
 * popover, pipeline People tab, settings/team list). Pre-PI-followup-1
 * each surface had its own palette + hash, so a user could land in
 * different slots across surfaces; that drift is now closed.
 *
 * Background style: flat alpha-tinted fill (color + "33") behind the
 * vivid letter. Replaced the prior paired (hand-tuned dark fill /
 * vivid letter) palette so all avatars across the app render the
 * same shape regardless of where they appear.
 *
 * Ring around photo avatars: never present. The previously-supported
 * `bordered` variant was dropped in the 2026-05-22 polish pass.
 */

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
  // PI-followup-1/5: paired text/bg derived via the shared helper.
  // user.id is the input — same person, same colors, on every surface.
  // PI-followup-5 moved bg into the palette (was caller-derived as
  // `color + "33"`) so a bespoke slot bg could diverge from the alpha
  // tint without breaking the contract.
  const { text: text, bg: bg } = getAvatarColorFromUserId(user.id);

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
        // PI-followup-5: bg comes from the palette pair directly
        // (was caller-derived alpha tint). Letter in the vivid text
        // color. No ring; flat treatment across every surface.
        background: bg,
        color: text,
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
