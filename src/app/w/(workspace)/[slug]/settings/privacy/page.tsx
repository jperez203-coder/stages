import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { WorkspaceSettingsTabs } from "@/components/settings/WorkspaceSettingsTabs";
import { PrivacyForm } from "./PrivacyForm";

/**
 * Workspace privacy settings at /w/[slug]/settings/privacy.
 *
 * Server-rendered. Reads:
 *   - workspace_memberships.role (member vs owner gate)
 *   - workspaces.ai_consent (Level 1 — agent_enabled toggle state)
 *   - profiles.ai_consent (Level 4 — improvement_signals toggle state)
 *
 * Renders four sections (in order):
 *   1. Workspace AI — interactive toggle for owners; read-only status for
 *      non-owners. Mirrors the role split in
 *      settings/billing/page.tsx::RestrictedCard.
 *   2. Your AI preferences — improvement signals toggle for the signed-in
 *      user. Always interactive.
 *   3. Connected integrations — placeholder. Slice 0.2 fills this in.
 *   4. AI action history — placeholder. Slice 0.3 / 0.4 fill this in.
 *
 * Not billing-guarded. Privacy controls (especially opt-out of AI training)
 * must remain accessible regardless of subscription state — GDPR opt-out
 * is not a "write" in the billing sense, and locking users out of privacy
 * settings would be the wrong policy. See docs/DATA-COLLECTION.md § 4.3 +
 * Phase 3a design lock A.
 *
 * Two render states:
 *   1. Not signed in → /auth/signin redirect (handled by auth check).
 *   2. Not a workspace member → bounce to /w/[slug] (deliberate
 *      non-disclosure of workspace existence, matches billing page).
 *   3. Signed-in member → render the form with the role + initial state
 *      flowing to PrivacyForm.
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function PrivacySettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const supa = await createSupabaseServerClient();

  // ── Auth ────────────────────────────────────────────────────────────────
  const { data: userResult } = await supa.auth.getUser();
  const user = userResult?.user;
  if (!user) {
    redirect(`/auth/signin?next=/w/${encodeURIComponent(slug)}/settings/privacy`);
  }
  const userId = user.id;

  // ── Resolve workspace + membership ──────────────────────────────────────
  // Joined query mirrors settings/billing/page.tsx. Returns null when the
  // user is not a workspace member of this slug — bounce out per the
  // non-disclosure posture.
  const wsMemRes = await supa
    .from("workspace_memberships")
    .select(
      "role, workspace:workspaces!inner(id, name, slug, ai_consent)",
    )
    .eq("user_id", userId)
    .eq("workspace.slug", slug)
    .maybeSingle();

  type WsRow = {
    id: string;
    name: string;
    slug: string;
    ai_consent: { agent_enabled?: boolean } | null;
  };
  const wsRaw = wsMemRes.data?.workspace as unknown;
  const ws: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  if (!wsMemRes.data || !ws) {
    redirect(`/w/${encodeURIComponent(slug)}`);
  }

  const role = wsMemRes.data.role;
  const isOwner = role === "owner";

  // ── Read profile.ai_consent for the user's improvement_signals state ──
  // Own-row read; RLS allows.
  const profileRes = await supa
    .from("profiles")
    .select("ai_consent")
    .eq("id", userId)
    .maybeSingle();

  type ProfileConsent = { improvement_signals?: boolean } | null;
  const profileConsent = (profileRes.data?.ai_consent ?? null) as ProfileConsent;

  const initialAgentEnabled = ws.ai_consent?.agent_enabled === true;
  const initialImprovementSignals = profileConsent?.improvement_signals === true;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <WorkspaceSettingsTabs activeTab="privacy" slug={slug}>
      <PrivacyForm
        workspaceSlug={slug}
        isOwner={isOwner}
        initialAgentEnabled={initialAgentEnabled}
        initialImprovementSignals={initialImprovementSignals}
      />
      <ComingSoonCard
        title="Connected integrations"
        body="Integration controls will appear here as you connect external services to Stages. Each integration will have its own permission scope you control."
      />
      <ComingSoonCard
        title="AI action history"
        body="When you invoke AI actions, you'll be asked for permission as needed. A log of every action will appear here for compliance review."
      />
    </WorkspaceSettingsTabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Placeholder cards for Slices 0.2 / 0.3 / 0.4.
//
// Visual: identical card chrome to the interactive sections, "Coming soon"
// pill instead of "Owner only". Zinc tones rather than the purple of the
// owner-only pill — different semantics (deferred slot vs gated control).
// ─────────────────────────────────────────────────────────────────────────

function ComingSoonCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel-card p-6 mb-4 opacity-70">
      <div className="flex items-start justify-between gap-4 mb-2">
        <div className="text-[14px] font-semibold text-zinc-100">{title}</div>
        <span
          className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-semibold tracking-wide uppercase text-zinc-400"
          style={{
            background: "rgba(63, 63, 70, 0.5)",
            border: "1px solid rgba(82, 82, 91, 0.6)",
          }}
        >
          Coming soon
        </span>
      </div>
      <p className="text-[13px] text-zinc-500 leading-snug">{body}</p>
    </div>
  );
}

