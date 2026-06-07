"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { captureActorName } from "@/lib/ai-consent";

/**
 * Server actions for /w/[slug]/settings/privacy toggles.
 *
 * Two actions — one per consent layer:
 *   - setWorkspaceAgentEnabled  → Level 1 (workspace.ai_consent.agent_enabled)
 *   - setUserImprovementSignals → Level 4 (profiles.ai_consent.improvement_signals)
 *
 * Each follows the same 6-step audit-write flow (locked in
 * docs/DATA-COLLECTION.md § 4.3.D):
 *
 *   1. Authenticate the caller (supa.auth.getUser).
 *   2. Validate permission (owner role for Level 1; own-row for Level 4).
 *   3. Read CURRENT ai_consent for the old_value audit snapshot.
 *   4. captureActorName BEFORE the UPDATE — defensive against future RTBF
 *      flows that may trigger consent changes mid-deletion when the
 *      underlying profile is partially cleared.
 *   5. UPDATE the JSONB column with `|| $1::jsonb` merge — preserves
 *      future keys so Slice 0.2 can add per-integration scopes without
 *      a migration.
 *   6. INSERT ai_consent_audit row via the service-role admin client
 *      (RLS-enabled-with-no-policies, service-role only — matches
 *      seat_sync_log pattern).
 *
 * If step 6 fails (transient DB error), we log server-side but still
 * return `ok: true` to the caller. The user's intent (state change)
 * succeeded; an audit gap is an operational concern, not a correctness
 * failure. Reverting the toggle on audit failure would produce worse UX
 * — the user would think their privacy choice didn't take.
 *
 * ─ TRUST BOUNDARY NOTE ──────────────────────────────────────────────────
 *
 * This file is an authorized caller of `getSupabaseAdmin()`. The audit
 * table `ai_consent_audit` is service-role-only (RLS enabled, zero policies)
 * by Slice 0.1 design lock — same pattern as `seat_sync_log` and
 * `stripe_events`. Audit writes here are the only privilege used; toggle
 * UPDATEs and reads go through the user-scoped server client.
 *
 * If you're widening this file's admin use, treat it as a design review.
 */

type ActionResult = { ok: true } | { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────
// Level 1 — workspace.ai_consent.agent_enabled
// ─────────────────────────────────────────────────────────────────────────

/**
 * Toggle a workspace's AI agent enablement. Owner-only.
 *
 * 'admin' role is intentionally NOT sufficient — workspace-level AI
 * enablement is an organizational decision, not an operational one.
 */
export async function setWorkspaceAgentEnabled(
  workspaceSlug: string,
  enabled: boolean,
): Promise<ActionResult> {
  const supa = await createSupabaseServerClient();

  // ── 1. Authenticate ───────────────────────────────────────────────────
  const { data: userResult } = await supa.auth.getUser();
  const user = userResult?.user;
  if (!user) return { ok: false, error: "Not signed in." };

  // ── 2. Resolve workspace + owner permission via joined membership query.
  //    Pattern mirrors src/app/w/(workspace)/[slug]/settings/billing/page.tsx.
  const wsMemRes = await supa
    .from("workspace_memberships")
    .select("role, workspace:workspaces!inner(id, ai_consent)")
    .eq("user_id", user.id)
    .eq("workspace.slug", workspaceSlug)
    .maybeSingle();

  type WsRow = { id: string; ai_consent: Record<string, unknown> };
  const wsRaw = wsMemRes.data?.workspace as unknown;
  const ws: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  if (!wsMemRes.data || !ws) {
    // Workspace either doesn't exist or caller isn't a member. Same
    // non-disclosure posture as the billing page — return the same
    // error in both cases so the route can't be used to probe for
    // workspace existence.
    return { ok: false, error: "Workspace not found." };
  }
  if (wsMemRes.data.role !== "owner") {
    return { ok: false, error: "Only workspace owners can change this setting." };
  }

  const workspaceId = ws.id;
  const oldConsent = ws.ai_consent;
  const oldValue = oldConsent?.agent_enabled ?? false;

  // No-op short-circuit. Don't write an audit row for unchanged state.
  if (oldValue === enabled) return { ok: true };

  // ── 3-4. Capture actor name BEFORE the UPDATE, using the admin client.
  //    Defensive against future RTBF flows; see captureActorName JSDoc.
  const admin = getSupabaseAdmin();
  const actorName = await captureActorName(user.id, admin);

  // ── 5. UPDATE workspace.ai_consent via JSONB merge.
  //    `|| $1::jsonb` preserves any future keys (Slice 0.2 will add
  //    per-integration scopes here without a migration).
  const updateRes = await supa
    .from("workspaces")
    .update({ ai_consent: { ...oldConsent, agent_enabled: enabled } })
    .eq("id", workspaceId);

  if (updateRes.error) {
    console.error(
      "[settings/privacy] workspace ai_consent update failed:",
      updateRes.error.message,
      "code:", updateRes.error.code,
    );
    return { ok: false, error: "Couldn't save — please try again." };
  }

  // ── 6. Audit-row INSERT via service-role admin client.
  //    Failure here is logged but does NOT roll back the user's
  //    intended state change. Returning ok:true is the locked trade-off
  //    per § 4.3.D.
  const auditRes = await admin.from("ai_consent_audit").insert({
    scope_type: "workspace",
    scope_id: workspaceId,
    actor_id: user.id,
    actor_name: actorName,
    changed_field: "agent_enabled",
    old_value: { agent_enabled: oldValue },
    new_value: { agent_enabled: enabled },
  });

  if (auditRes.error) {
    console.error(
      "[settings/privacy] ai_consent_audit insert failed (workspace):",
      auditRes.error.message,
      "code:", auditRes.error.code,
      "workspace_id:", workspaceId,
    );
  }

  revalidatePath(`/w/${workspaceSlug}/settings/privacy`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Level 4 — profiles.ai_consent.improvement_signals
// ─────────────────────────────────────────────────────────────────────────

/**
 * Toggle the calling user's improvement-signals opt-in.
 *
 * Own-profile-only. The UPDATE statement gates on id = auth.uid(); RLS
 * enforces the same. No extra membership check needed.
 */
export async function setUserImprovementSignals(
  workspaceSlug: string,
  enabled: boolean,
): Promise<ActionResult> {
  const supa = await createSupabaseServerClient();

  // ── 1. Authenticate ───────────────────────────────────────────────────
  const { data: userResult } = await supa.auth.getUser();
  const user = userResult?.user;
  if (!user) return { ok: false, error: "Not signed in." };

  // ── 2. Read current profile.ai_consent for old_value snapshot.
  //    Own-row read via user-scoped supa (RLS allows).
  const profileRes = await supa
    .from("profiles")
    .select("ai_consent")
    .eq("id", user.id)
    .maybeSingle();

  if (profileRes.error || !profileRes.data) {
    console.error(
      "[settings/privacy] profile read failed:",
      profileRes.error?.message,
      "code:", profileRes.error?.code,
    );
    return { ok: false, error: "Couldn't load your settings — please try again." };
  }

  const oldConsent = (profileRes.data.ai_consent ?? {}) as Record<string, unknown>;
  const oldValue = oldConsent.improvement_signals === true;

  // No-op short-circuit.
  if (oldValue === enabled) return { ok: true };

  // ── 3. Capture actor name BEFORE the UPDATE.
  const admin = getSupabaseAdmin();
  const actorName = await captureActorName(user.id, admin);

  // ── 4. UPDATE profiles.ai_consent via JSONB merge.
  //    eq("id", user.id) is the application-layer guarantee; RLS WITH
  //    CHECK enforces the same on the DB side.
  const updateRes = await supa
    .from("profiles")
    .update({ ai_consent: { ...oldConsent, improvement_signals: enabled } })
    .eq("id", user.id);

  if (updateRes.error) {
    console.error(
      "[settings/privacy] profile ai_consent update failed:",
      updateRes.error.message,
      "code:", updateRes.error.code,
    );
    return { ok: false, error: "Couldn't save — please try again." };
  }

  // ── 5. Audit-row INSERT via service-role admin client.
  const auditRes = await admin.from("ai_consent_audit").insert({
    scope_type: "user",
    scope_id: user.id,
    actor_id: user.id,
    actor_name: actorName,
    changed_field: "improvement_signals",
    old_value: { improvement_signals: oldValue },
    new_value: { improvement_signals: enabled },
  });

  if (auditRes.error) {
    console.error(
      "[settings/privacy] ai_consent_audit insert failed (user):",
      auditRes.error.message,
      "code:", auditRes.error.code,
      "user_id:", user.id,
    );
  }

  revalidatePath(`/w/${workspaceSlug}/settings/privacy`);
  return { ok: true };
}
