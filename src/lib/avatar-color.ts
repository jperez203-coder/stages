/**
 * Centralized avatar color helper. PI-followup-1; revised PI-followup-5
 * to return a paired (text, bg) tuple instead of a single hex.
 *
 * Why the shape change: Jordan's design spec for the pink slot specified
 * an explicit dark-muted-pink background (#351E2E) that doesn't equal
 * the alpha-tint of the foreground (#ED4899 over the canvas bg). The
 * old `color + "33"` derive-the-bg pattern only worked when bg was a
 * faithful alpha of fg; one bespoke pairing breaks that invariant.
 *
 * Source of truth for "what colors are this user's avatar":
 *   1. ONE palette (8 paired text/bg entries, dark-theme-friendly).
 *   2. ONE hash function (character-sum-then-modulo over the user_id).
 *   3. Hash input is ALWAYS user_id (auth.users.id / profiles.id). Some
 *      pre-PI-followup-1 surfaces hashed email; user_id is stable across
 *      email changes, email isn't, and using one input everywhere is
 *      the only way the cross-surface invariant ("Taylor is always
 *      teal") actually holds.
 *
 * Pure function — no React, no Supabase, no DOM. Safe to call in any
 * render path, including server components.
 */

export type AvatarColorPair = { text: string; bg: string };

/**
 * Slots 1 and 6 use bespoke text/bg pairs from Jordan's design spec
 * (PI-7 + PI-followup-5). Every other slot keeps its bg derived as
 * `text + "33"`, preserving the pre-paired visual treatment.
 *
 * Slot 1 swapped from pink → amber in PI-7 so the palette has a single
 * pink identity (slot 6), not two collision-prone pinks.
 */
const AVATAR_PALETTE: ReadonlyArray<AvatarColorPair> = [
  { text: "#15B981", bg: "#15B981" + "33" }, // green
  { text: "#FBBF24", bg: "#3D2C0E" }, // amber (PI-7: replaced #ED4899 pink-500; collision with slot 6)
  { text: "#3A97D8", bg: "#3A97D8" + "33" }, // blue
  { text: "#F59E0C", bg: "#F59E0C" + "33" }, // amber-orange (Tailwind amber-500)
  { text: "#8B5CF6", bg: "#8B5CF6" + "33" }, // purple
  { text: "#06B6D4", bg: "#06B6D4" + "33" }, // cyan
  { text: "#ED4899", bg: "#351E2E" }, // pink-500 on bespoke dark muted pink (Jordan PI-followup-5)
  { text: "#FB923C", bg: "#FB923C" + "33" }, // orange
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
