import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PortalShell } from "@/components/portal/v2/PortalShell";

/**
 * /portal/[pipeline-id]/layout.tsx — client portal layout.
 * Phase 4b-1.
 *
 * Wraps every nested route (page.tsx, chat/, canvas/, files/) with:
 *   1. The auth gate (anyone who can_see_pipeline — pipeline_memberships
 *      row of any role, OR workspace owner as a fallback).
 *   2. The PortalShell chrome (top bar, view-as-client banner, tabs).
 *
 * The auth gate uses a two-step lookup (no RPC):
 *   * Step 1: pipeline_memberships row for the caller on this pipeline.
 *     If present (ANY role: owner/admin/member/client), they're in.
 *   * Step 2 (only if step 1 missed): workspace owner check. Fetches
 *     the pipeline's workspace_id, then checks workspace_memberships
 *     for the caller with role='owner'. Lets workspace owners reach
 *     the portal even without an explicit pipeline_memberships row.
 *
 * `viewerIsActuallyAgencySide` is computed here from the gate's
 * result and threaded to PortalShell for the "View as client" banner.
 * It is NOT threaded to any chat component — see PortalChatBody for
 * the locked `viewerIsAgencySide=false` decision.
 *
 * NOTE: workspaces table SELECT for clients depends on migration
 * 20260527120000 (this slice's migration). Pre-migration, the
 * `pipeline:workspaces!inner(...)` join below returns null for the
 * workspace fields when the caller is a client. PortalShell handles
 * the null case gracefully — the "by [Agency]" subtitle just hides.
 */

export const dynamic = "force-dynamic";

// Next.js 16: LayoutProps for a dynamic route has `params: Promise<unknown>`
// (layouts wrap multiple sub-routes so the params type is the loose
// intersection). Pages can declare narrow params types; layouts cannot
// without violating contravariance against the generated LayoutConfig.
// We accept Promise<unknown> here and cast on resolution — Next.js
// guarantees the runtime shape matches the route segment.
export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as { "pipeline-id": string };
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // ── Auth gate (anonymous → /auth/signin) ──────────────────────────────
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/portal/${encodeURIComponent(pipelineId)}`,
    );
  }

  // ── Access check: step 1 — pipeline_memberships row of ANY role ───────
  const pipelineMembershipRes = await supabase
    .from("pipeline_memberships")
    .select("role")
    .eq("pipeline_id", pipelineId)
    .eq("user_id", user.id)
    .maybeSingle();

  // ── Access check: step 2 — fallback to workspace owner ────────────────
  // Only run when step 1 missed. Workspace owners can preview any of
  // their workspace's pipelines via the portal even without an explicit
  // pipeline_memberships row (intent: the eventual "view as client"
  // affordance from the LeftRail).
  let workspaceOwnerForPipeline = false;
  if (!pipelineMembershipRes.data) {
    const pipelineRes = await supabase
      .from("pipelines")
      .select("workspace_id")
      .eq("id", pipelineId)
      .maybeSingle();
    if (pipelineRes.data) {
      const wsOwnerRes = await supabase
        .from("workspace_memberships")
        .select("role")
        .eq("workspace_id", pipelineRes.data.workspace_id)
        .eq("user_id", user.id)
        .eq("role", "owner")
        .maybeSingle();
      if (wsOwnerRes.data) {
        workspaceOwnerForPipeline = true;
      }
    }
  }

  if (!pipelineMembershipRes.data && !workspaceOwnerForPipeline) {
    redirect("/");
  }

  // ── viewerIsActuallyAgencySide — for the banner only ─────────────────
  // True when the viewer has actual agency-side standing on this
  // pipeline (workspace_owner OR pipeline_memberships role in
  // owner/admin/member). Drives the "Viewing as client" banner in
  // PortalShell. Does NOT cross over to PortalChatBody — the chat
  // surface always renders client-mode regardless of this value.
  const pipelineRole = pipelineMembershipRes.data?.role ?? null;
  const viewerIsActuallyAgencySide =
    workspaceOwnerForPipeline ||
    pipelineRole === "owner" ||
    pipelineRole === "admin" ||
    pipelineRole === "member";

  // ── Fetch pipeline + workspace metadata for chrome ───────────────────
  // workspaces.name access depends on this slice's migration
  // (20260527120000). Pre-migration, client viewers will get null for
  // the workspace fields and PortalShell hides the "by [Agency]"
  // subtitle. Post-migration, it renders correctly.
  const pipelineMetaRes = await supabase
    .from("pipelines")
    .select(
      `id, name, emoji, company, workspace:workspaces!inner(id, name, slug)`,
    )
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipelineMetaRes.data) {
    // Pipeline disappeared between access check and metadata fetch,
    // OR (more commonly pre-migration) the workspaces inner-join
    // filtered the result out for a client viewer. Defensive redirect.
    redirect("/");
  }

  // PostgREST returns nested joins as either a single object or an
  // array depending on the relationship cardinality inference.
  // Normalize to a single value or null.
  type WsRow = { id: string; name: string; slug: string };
  const wsRaw = pipelineMetaRes.data.workspace as unknown;
  const workspace: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  // ── Caller's profile (for the HeaderProfileMenu in the top bar) ──────
  const callerProfileRes = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <PortalShell
      pipelineId={pipelineId}
      pipelineName={pipelineMetaRes.data.name}
      pipelineEmoji={pipelineMetaRes.data.emoji ?? "📋"}
      pipelineCompany={pipelineMetaRes.data.company ?? null}
      workspaceName={workspace?.name ?? null}
      workspaceSlug={workspace?.slug ?? null}
      viewer={{
        email: user.email ?? "",
        displayName: callerProfileRes.data?.display_name ?? null,
        avatarUrl: callerProfileRes.data?.avatar_url ?? null,
      }}
      viewerIsActuallyAgencySide={viewerIsActuallyAgencySide}
    >
      {children}
    </PortalShell>
  );
}
