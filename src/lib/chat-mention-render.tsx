import type { ReactNode } from "react";

/**
 * NF-2: display-time @mention rendering for chat messages.
 *
 * Inputs:
 *   * text — the literal message body the user typed
 *   * mentionUserIds — channel_messages.mentions[] (uuid[]), the set of
 *     user_ids the NF-1 send_channel_message RPC resolved at insert time
 *   * profilesById — display_name / email lookup for those user_ids,
 *     batched + cached at the ChatBody level (see useMentionedProfileMap)
 *
 * Algorithm:
 *   1. Build a Set of normalized identifiers from the mentioned profiles.
 *      Normalization mirrors the RPC: lowercase, spaces stripped from
 *      display_name, email-local-part (before "@"). Both forms join the
 *      same Set so either @aliyah or @aliyahlee styles the same row.
 *   2. Split the text on `(@\S+)` keeping the delimiters as separate
 *      tokens. For each `@<token>` piece, lower-strip-leading-`@` and
 *      check the Set. Match → styled <span>; no match → plain string.
 *   3. Non-@ pieces and unmatched @-tokens render as plain strings.
 *
 * Why match against the resolved-mention Set rather than profile string
 * lookups directly: typos and unresolved tokens stay plain text (per
 * NF-1 spec), AND a `@` followed by something that happens to equal an
 * UNMENTIONED user's name doesn't accidentally style. The mentions[]
 * array is the source of truth for "this token meant somebody."
 *
 * KNOWN LIMITATION — flagged for future, not fixed in NF-2:
 *   The normalization here duplicates the RPC's token-resolution rule.
 *   If we ever change the RPC (e.g., to accept "@first.last" forms), the
 *   render helper drifts. A shared utility module would eliminate the
 *   drift. Worth a follow-up commit — out of scope here per NF-2's
 *   "propose but don't refactor" rule.
 */

export type MentionedProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
};

// Cyan #22D3EE on dark-blue-grey #263D5F per Jordan's spec. Pill-like
// padding, subtle rounding. Inline span; no click behavior in NF-2.
const MENTION_STYLE: React.CSSProperties = {
  color: "#22D3EE",
  background: "#263D5F",
  padding: "0 4px",
  borderRadius: 4,
  fontWeight: 500,
};

function normalizeToken(raw: string): string {
  return raw.toLowerCase();
}

function buildIdentifierSet(profiles: MentionedProfile[]): Set<string> {
  const set = new Set<string>();
  for (const p of profiles) {
    if (p.email) {
      const local = p.email.split("@")[0]?.toLowerCase();
      if (local) set.add(local);
    }
    if (p.display_name) {
      const spaceless = p.display_name.replace(/\s+/g, "").toLowerCase();
      if (spaceless) set.add(spaceless);
    }
  }
  return set;
}

/**
 * Returns an array of React nodes interleaving plain strings + styled
 * mention spans. Pass through to JSX directly.
 */
export function renderMessageWithMentions(
  text: string,
  mentionUserIds: string[],
  profilesById: Map<string, MentionedProfile>,
): ReactNode[] {
  if (!mentionUserIds || mentionUserIds.length === 0) {
    return [text];
  }

  const mentionedProfiles: MentionedProfile[] = [];
  for (const uid of mentionUserIds) {
    const p = profilesById.get(uid);
    if (p) mentionedProfiles.push(p);
  }

  // If we couldn't resolve any profiles (lookup not yet populated, or
  // every mentioned user_id has no profile row), fall back to plain text.
  // Restyling will happen on the next render once the cache fills.
  if (mentionedProfiles.length === 0) {
    return [text];
  }

  const identifierSet = buildIdentifierSet(mentionedProfiles);

  // Split on (@\S+) — the capture group is retained as a separate item
  // in the result array, so we walk every odd-index entry as a potential
  // mention token.
  const parts = text.split(/(@\S+)/g);
  const out: ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part.startsWith("@")) {
      const tokenBody = normalizeToken(part.slice(1));
      // Trailing punctuation (commas, periods, etc.) can ride along on
      // \S+ — the RPC's resolution is strict (token must equal an
      // identifier exactly), so we mirror that strictness here. A user
      // who types "@aliyah," gets unstyled text; "@aliyah ," gets the
      // pill. This matches what the RPC stored — no semantic mismatch.
      if (identifierSet.has(tokenBody)) {
        out.push(
          <span key={`m-${i}`} style={MENTION_STYLE}>
            {part}
          </span>,
        );
        continue;
      }
    }

    out.push(part);
  }

  return out;
}

/**
 * Collect the union of mention user_ids across a list of messages.
 * Used at the ChatBody level to drive the profile-batch-fetch effect.
 */
export function collectMentionUserIds(
  messages: Array<{ mentions?: string[] | null }>,
): string[] {
  const set = new Set<string>();
  for (const m of messages) {
    if (m.mentions) {
      for (const uid of m.mentions) set.add(uid);
    }
  }
  return Array.from(set);
}
