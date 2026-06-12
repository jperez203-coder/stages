/**
 * Centralized avatar color helper. PI-followup-1.
 *
 * Replaces the per-component AVATAR_COLORS arrays + ad-hoc hash math
 * that had drifted across ClientsBody, MembersBody, settings/team
 * page, HeaderProfileMenu, UserAvatar, and the chat MembersAvatarStack.
 *
 * Source of truth for "what color is this user's avatar":
 *   1. ONE palette (8 colors, dark-theme-friendly, white text contrast).
 *   2. ONE hash function (character-sum-then-modulo over the user_id).
 *   3. Hash input is ALWAYS user_id (auth.users.id / profiles.id). The
 *      pre-PI-followup-1 codebase had some surfaces hashing email; user_id
 *      is stable across email changes, email isn't, and using one input
 *      everywhere is the only way the cross-surface invariant
 *      ("Taylor is always teal") actually holds.
 *
 * Pure function — no React, no Supabase, no DOM. Safe to call in any
 * render path, including server components.
 */

const AVATAR_PALETTE: ReadonlyArray<string> = [
  "#15B981", // green
  "#ED4899", // pink-500
  "#3A97D8", // blue
  "#F59E0C", // amber
  "#8B5CF6", // purple
  "#06B6D4", // cyan
  "#F472B6", // pink-400 (PI-followup-3: replaced #F43F5E rose; off-brand red)
  "#FB923C", // orange
];

/**
 * Returns a stable hex color for a given user id. Same userId always
 * returns the same color; different userIds spread evenly (within
 * palette-size limits) across the palette via a simple character-sum
 * hash.
 *
 * Callers typically use the returned hex as BOTH the letter color and
 * the source of a tinted background (`color + "33"` for the alpha 33
 * tint, or `color + "22"` for the lighter variant). The exact tint is
 * a per-component visual choice; this helper only commits to the seed
 * color.
 */
export function getAvatarColorFromUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export { AVATAR_PALETTE };
