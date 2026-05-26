import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchPipelineFiles } from "@/lib/pipeline-files-data";
import { PortalFilesBody } from "@/components/portal/v2/PortalFilesBody";

/**
 * /portal/[pipeline-id]/files — client portal Files tab. Phase 4b-3-c.
 *
 * Layout already auth-gated this request via can_see_pipeline. We
 * re-fetch the user (cheap, request-cached) for the viewerId prop,
 * then call `fetchPipelineFiles` — the SAME helper the agency-side
 * route uses. RLS handles the agency-vs-client split at the DB layer
 * (pipeline_links_select: `is_pipeline_agency_member OR (is_pipeline_
 * client AND client_visible = true)`), so for a client viewer this
 * returns only client_visible=true rows automatically — no extra
 * filtering needed in this file or in PortalFilesBody.
 *
 * Uploader profile reads on each card are covered by the existing
 * profiles_select branches 5 (users_share_pipeline) and 6 (caller_
 * pipeline_in_workspace_owned_by) from migrations 20260527120000 /
 * 20260529120000. Unreadable profiles fall back to the "Pending
 * member" placeholder.
 *
 * No edit affordances render: PortalFilesBody passes canEdit={false}
 * to every FileCard. Defense-in-depth — see PortalFilesBody header
 * comment for the three layers (render, prop gate, RLS).
 */

export const dynamic = "force-dynamic";

export default async function PortalFilesPage({
  params,
}: {
  params: Promise<{ "pipeline-id": string }>;
}) {
  const resolved = await params;
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // Defensive re-check (layout already gated). Cached at the request
  // level so this is effectively free.
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/portal/${encodeURIComponent(pipelineId)}/files`,
    );
  }

  // Parallel: files (RLS auto-filters to client_visible=true) +
  // caller's own profile. The caller-profile fetch lets
  // PortalFilesBody enrich `added_by_profile` on freshly-inserted
  // rows (client uploads + add-link) immediately, so the card shows
  // "Casey Client (You)" rather than "Pending member (You)" until the
  // next page reload. See PortalFilesBody header comment for the
  // optimistic-reconcile rationale.
  //
  // profiles_select branch 1 (`id = auth.uid()`) is what makes this
  // SELECT return a row for a pure client; no RLS change needed.
  const [initialFiles, viewerProfileRes] = await Promise.all([
    fetchPipelineFiles(supabase, pipelineId),
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, email")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  // Fallback shape — if the profile row is missing/unreadable for any
  // reason, we still pass a minimal viewerProfile keyed by user.id so
  // the optimistic-reconcile branch in PortalFilesBody can match by id;
  // display_name/email/avatar gracefully degrade to FileCard's existing
  // "Pending member" handling, same as today.
  const viewerProfile = {
    id: user.id,
    display_name: viewerProfileRes.data?.display_name ?? null,
    avatar_url: viewerProfileRes.data?.avatar_url ?? null,
    email: viewerProfileRes.data?.email ?? user.email ?? null,
  };

  return (
    <PortalFilesBody
      initialFiles={initialFiles}
      viewerId={user.id}
      viewerProfile={viewerProfile}
      pipelineId={pipelineId}
    />
  );
}
