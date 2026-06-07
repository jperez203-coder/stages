import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Consent-gate utility for AI features.
 *
 * Every future AI feature MUST gate access through one or both of the
 * read-side helpers (checkAgentEnabled, checkImprovementSignals) before
 * touching user content.
 *
 * ─ META-COMMITMENT (locked in docs/DATA-COLLECTION.md § 4) ──────────────
 *
 *   "Stages AI acts on your behalf within tools you connect. Every action
 *    requires your permission. We never train on your data."
 *
 * ─ 4-LEVEL CONSENT FRAMEWORK (docs/DATA-COLLECTION.md § 4.2.B) ──────────
 *
 *   Level 1 — workspace AI enablement       → checkAgentEnabled (this file)
 *   Level 2 — per-integration consent        (Slice 0.2, not yet shipped)
 *   Level 3 — per-action consent             (Slice 0.3, not yet shipped)
 *   Level 4 — improvement signals            → checkImprovementSignals (this file)
 *
 * ─ PER-ROW LAYER NOT COVERED HERE ──────────────────────────────────────
 *
 * `channel_messages` flagged `is_internal = true` MUST NEVER enter AI
 * prompts even when checkAgentEnabled returns true. The internal-message
 * layer is a per-row consent signal that supersedes the workspace-level
 * toggle. Every AI feature builder enforces this at query time when
 * assembling AI context windows.
 *
 * See CLAUDE.md "Internal-message privacy is enforced in three layers"
 * + docs/DATA-COLLECTION.md § 1.4 + § 4.5.
 */

/**
 * Level 1 — Workspace AI enablement check.
 *
 * Returns true only if a workspace owner has explicitly enabled AI agent
 * features for this workspace.
 *
 * **Fails CLOSED** on any read error (missing row, RLS denial, network
 * blip): returns `false`. Privacy-by-default at runtime, not just at the
 * schema default — if the gate can't confirm consent, treat as not given.
 *
 * Necessary but not sufficient: when Levels 2 + 3 ship, they layer on top.
 */
export async function checkAgentEnabled(
  workspaceId: string,
  supa: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supa
    .from("workspaces")
    .select("ai_consent")
    .eq("id", workspaceId)
    .single();
  if (error || !data) return false;
  const consent = data.ai_consent as { agent_enabled?: boolean } | null;
  return consent?.agent_enabled === true;
}

/**
 * Level 4 — Improvement signals opt-in check.
 *
 * Returns true only if the user has explicitly opted in to letting
 * anonymized usage signals (which features used, which suggestions
 * accepted) improve Stages' AI features for everyone.
 *
 * **Fails CLOSED** on any read error: returns `false`.
 *
 * AI training / evaluation pipelines MUST call this before including any
 * of the user's behavioral signals in a dataset.
 */
export async function checkImprovementSignals(
  userId: string,
  supa: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supa
    .from("profiles")
    .select("ai_consent")
    .eq("id", userId)
    .single();
  if (error || !data) return false;
  const consent = data.ai_consent as { improvement_signals?: boolean } | null;
  return consent?.improvement_signals === true;
}

/**
 * Capture an actor's display name for audit-row writes, with a fallback
 * chain that always returns a non-null string:
 *
 *   1. profiles.display_name (the canonical current name)
 *   2. auth.users.raw_user_meta_data->>'full_name' (signup form path)
 *   3. auth.users.raw_user_meta_data->>'name'      (Google OAuth path)
 *   4. Literal 'Unknown user'
 *
 * **Why this exists.** `ai_consent_audit.actor_name` is NOT NULL. The
 * audit row must write even when the underlying profile is partially
 * cleared — e.g. when the forthcoming RTBF deletion handler (CRITICAL
 * pre-launch WISHLIST item) triggers a consent change as a side-effect
 * mid-deletion. Always call this BEFORE the destructive operation.
 *
 * Requires a service-role admin client to read `auth.users.raw_user_meta_data`
 * (the profiles read alone works in the common case, but the fallback chain
 * to raw_user_meta_data requires admin). The caller owns the admin handle
 * so this module never imports `getSupabaseAdmin` directly — keeps the
 * trust-boundary widening explicit at every call site.
 */
export async function captureActorName(
  userId: string,
  admin: SupabaseClient,
): Promise<string> {
  // Step 1: profiles.display_name (most common path).
  const profileRes = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const displayName = profileRes.data?.display_name?.trim();
  if (displayName) return displayName;

  // Step 2-3: auth.users.raw_user_meta_data — Google OAuth + signup form.
  // admin.auth.admin.getUserById bypasses RLS and returns the full user.
  const userRes = await admin.auth.admin.getUserById(userId);
  const meta = userRes.data?.user?.user_metadata as
    | { full_name?: string; name?: string }
    | undefined;
  const fromMeta = meta?.full_name?.trim() || meta?.name?.trim();
  if (fromMeta) return fromMeta;

  // Step 4: literal fallback. NEVER null, NEVER throws.
  return "Unknown user";
}
