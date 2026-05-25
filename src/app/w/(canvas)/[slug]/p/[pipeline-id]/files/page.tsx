import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineChromeShell } from "@/components/chrome/PipelineChromeShell";
import { fetchCanvasChromeData } from "@/lib/canvas-chrome-data";
import { fetchPipelineFiles } from "@/lib/pipeline-files-data";
import { FilesBody } from "./FilesBody";

/**
 * /w/[slug]/p/[pipeline-id]/files — agency-side pipeline files surface.
 * Phase 4b-3-b.
 *
 * Server wrapper mirrors /chat and /clients exactly:
 *   1. Auth gate (anon → /auth/signin)
 *   2. Workspace membership check (must be a workspace member)
 *   3. Pipeline ↔ workspace match precheck
 *   4. Parallel fetch: chrome data + caller profile + initial files
 *   5. Render <PipelineChromeShell><FilesBody/></PipelineChromeShell>
 *
 * `hideEditButton` is set: like /chat, the files surface isn't where
 * pipeline edits happen, so the "Edit pipeline" toggle in the chrome
 * header would be disorienting on this page.
 *
 * The portal-side files tab (4b-3-c) is a separate route at
 * /portal/[pipeline-id]/files. Both consume the same fetch helper
 * (fetchPipelineFiles) — RLS handles the agency vs. client filter at
 * the DB layer, so each surface just renders what comes back.
 */

export const dynamic = "force-dynamic";

export default async function PipelineFilesPage({
  params,
}: {
  params: Promise<{ slug: string; "pipeline-id": string }>;
}) {
  const resolved = await params;
  const { slug } = resolved;
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // ── Auth gate ──────────────────────────────────────────────────────────
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/w/${encodeURIComponent(
        slug,
      )}/p/${encodeURIComponent(pipelineId)}/files`,
    );
  }

  // ── Workspace membership check ─────────────────────────────────────────
  const wsMembershipResult = await supabase
    .from("workspace_memberships")
    .select(`role, workspace:workspaces!inner(id, name, slug)`)
    .eq("user_id", user.id)
    .eq("workspace.slug", slug)
    .maybeSingle();

  type WsRow = { id: string; name: string; slug: string };
  const wsRaw = wsMembershipResult.data?.workspace as unknown;
  const ws: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  if (!wsMembershipResult.data || !ws) {
    redirect("/");
  }

  // ── Pipeline + workspace match pre-check ──────────────────────────────
  const pipelineMatchRes = await supabase
    .from("pipelines")
    .select("id, workspace_id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipelineMatchRes.data || pipelineMatchRes.data.workspace_id !== ws.id) {
    redirect(`/w/${slug}`);
  }

  // ── Parallel: chrome + caller profile + initial files ────────────────
  const [chrome, callerProfileRes, initialFiles] = await Promise.all([
    fetchCanvasChromeData(
      supabase,
      pipelineId,
      user.id,
      wsMembershipResult.data.role,
    ),
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),
    fetchPipelineFiles(supabase, pipelineId),
  ]);

  if (!chrome) {
    redirect(`/w/${slug}`);
  }

  return (
    <PipelineChromeShell
      workspaceSlug={ws.slug}
      chrome={chrome}
      // Files doesn't fetch task counts — pass 0/0 for the subline,
      // same as /chat and /clients. Future enhancement filed against
      // /clients already: pass null and have the shell omit the segment.
      completedTasks={0}
      totalTasks={0}
      user={{
        email: user.email ?? "",
        displayName: callerProfileRes.data?.display_name ?? null,
        avatarUrl: callerProfileRes.data?.avatar_url ?? null,
      }}
      // Edit mode is canvas-only (5e). Hide the toggle on the files
      // surface — nothing here for edit-mode to change.
      hideEditButton
    >
      <FilesBody
        pipelineId={pipelineId}
        initialFiles={initialFiles}
        viewerId={user.id}
        canEditPipeline={chrome.canEditPipeline}
      />
    </PipelineChromeShell>
  );
}
