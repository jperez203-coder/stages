/**
 * Single source of truth for turning a user-ish record into a
 * human-readable name. Consolidates four near-identical resolver
 * helpers that had drifted across the app (FileCard's resolveUploaderName,
 * MessageThread's resolveAuthorName, MembersPopover's resolveMemberDisplay,
 * TaskDetailPanel's resolveDisplayName).
 *
 * Resolution chain (most lenient → falls through):
 *   1. display_name, if it has a non-empty trimmed value → return it
 *   2. email local-part (everything before the first "@") → return it
 *   3. options.whenMissing, or "Unknown user" if not provided
 *
 * Callers that need to draw a meaningful distinction between "no record
 * at all" (e.g. a deleted user) and "record present but unnamed" (e.g. a
 * pending member) should branch on the null/undefined case THEMSELVES
 * before calling this — pass a non-null user here and use `whenMissing`
 * only for the present-but-unnamed case. See MessageThread's
 * "Deleted user" vs "Pending member" handling for the canonical example.
 *
 * Pure function — no imports, no React, safe to call anywhere.
 */
export function resolveDisplayName(
  user:
    | { display_name?: string | null; email?: string | null }
    | null
    | undefined,
  options?: { whenMissing?: string },
): string {
  const name = user?.display_name?.trim();
  if (name) return name;

  const email = user?.email?.trim();
  if (email) {
    // Local-part — everything before the first "@". For a well-formed
    // address ("casey@acme.com" → "casey") this matches every prior
    // helper exactly. Malformed inputs ("@x", "nobody") are not
    // produced for real users (auth.users.email is always a valid
    // address), so the split's edge behavior is moot in practice.
    return email.split("@")[0];
  }

  return options?.whenMissing ?? "Unknown user";
}

/**
 * Single source of truth for the SINGLE-CHARACTER avatar initial. Matches
 * the chain UserAvatar.tsx uses internally — display_name first, email
 * second, "?" last — so initials derived here look identical to the
 * central UserAvatar everywhere.
 *
 * Resolution chain (most lenient → falls through):
 *   1. display_name's first trimmed char → uppercased
 *   2. email's first trimmed char → uppercased
 *   3. literal "?"
 *
 * IMPORTANT — precedence is `display_name → email`, NOT the other way
 * around. The bug this util prevents (2026-05-29 sweep): three inline
 * avatar components had `email.charAt(0)` hardcoded, so a user named
 * "Test Founder" with email "jordan+test@…" showed "J" instead of "T".
 * Any new avatar component MUST call this util (or accept user.display_name
 * as a prop and use this chain inline) — do not reintroduce email-first.
 *
 * Pure function — no imports, no React, safe to call anywhere.
 */
export function resolveInitial(
  user:
    | { display_name?: string | null; email?: string | null }
    | null
    | undefined,
): string {
  const name = user?.display_name?.trim();
  if (name) return name[0]!.toUpperCase();
  const email = user?.email?.trim();
  if (email) return email[0]!.toUpperCase();
  return "?";
}
