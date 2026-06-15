/**
 * Centralized avatar color helper. PI-followup-1; revised PI-followup-5
 * to return a paired (text, bg) tuple instead of a single hex.
 * TN-1 grew the palette from 8 → 10 slots and pinned an explicit bg
 * on the green slot (Jordan's reference mockup uses green; the
 * alpha-tinted bg we shipped before drifted from the spec).
 *
 * Why the bg-pair shape: Jordan's design spec for several slots
 * specifies bespoke dark-muted backgrounds that don't equal the alpha-
 * tint of the foreground. The pre-PI-followup-5 `color + "33"` derive-
 * the-bg pattern only worked when bg was a faithful alpha; bespoke
 * pairs need to live in the palette directly.
 *
 * Source of truth for "what colors are this user's avatar":
 *   1. ONE palette (10 paired text/bg entries, dark-theme-friendly).
 *   2. ONE hash function (character-sum-then-modulo over the user_id).
 *   3. Hash input is ALWAYS user_id (auth.users.id / profiles.id).
 *      Some pre-PI-followup-1 surfaces hashed email; user_id is stable
 *      across email changes, email isn't, and using one input
 *      everywhere is the only way the cross-surface invariant ("Taylor
 *      is always teal") actually holds. One known exception:
 *      MembersAvatarStack still feeds email through this helper because
 *      the chat layer doesn't thread user_ids in — drift caveat
 *      documented at that site.
 *
 * Pure function — no React, no Supabase, no DOM. Safe to call in any
 * render path, including server components.
 */

export type AvatarColorPair = { text: string; bg: string };

/**
 * Palette layout:
 *   Slot 0 — green: Jordan-spec text #15B981 on bespoke bg #192526 (TN-1)
 *   Slot 1 — amber: Jordan-spec text #FBBF24 on bespoke bg #3D2C0E (PI-7)
 *   Slot 6 — pink:  Jordan-spec text #ED4899 on bespoke bg #351E2E (PI-followup-5)
 * Every other slot keeps its bg as `text + "33"` — the canvas-bg alpha
 * tint that originally fronted the palette. Adding new slots: keep
 * bespoke-pair entries only when Jordan supplies the exact codes;
 * default to alpha-tint otherwise.
 *
 * Slots 8 + 9 added in TN-1 to lift the palette to 10 distinct
 * identities (teal complements green-emerald without colliding;
 * indigo complements blue-#3A97D8 without colliding).
 */
const AVATAR_PALETTE: ReadonlyArray<AvatarColorPair> = [
  { text: "#15B981", bg: "#192526" }, // green (Jordan TN-1: bespoke bg #192526)
  { text: "#FBBF24", bg: "#3D2C0E" }, // amber (PI-7: bespoke bg)
  { text: "#3A97D8", bg: "#3A97D8" + "33" }, // blue
  { text: "#F59E0C", bg: "#F59E0C" + "33" }, // amber-orange (Tailwind amber-500)
  { text: "#8B5CF6", bg: "#8B5CF6" + "33" }, // purple
  { text: "#06B6D4", bg: "#06B6D4" + "33" }, // cyan
  { text: "#ED4899", bg: "#351E2E" }, // pink (PI-followup-5: bespoke bg)
  { text: "#FB923C", bg: "#FB923C" + "33" }, // orange
  { text: "#14B8A6", bg: "#14B8A6" + "33" }, // teal (TN-1)
  { text: "#6366F1", bg: "#6366F1" + "33" }, // indigo (TN-1)
];

/**
 * Returns a stable `{ text, bg }` pair for a given user id. Same userId
 * always returns the same pair; different userIds spread evenly (within
 * palette-size limits) across the palette via a simple character-sum hash.
 *
 * Callers should use `text` as the letter / icon color and `bg` as the
 * tile background, without any further tint math. The old "single-hex
 * + caller-side alpha tint" contract was retired in PI-followup-5; the
 * helper now commits to both halves of the pair.
 */
export function getAvatarColorFromUserId(userId: string): AvatarColorPair {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export { AVATAR_PALETTE };
