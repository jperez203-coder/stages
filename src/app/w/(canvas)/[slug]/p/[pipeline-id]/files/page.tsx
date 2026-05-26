import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchPipelineFiles } from "@/lib/pipeline-files-data";
import { fetchCanvasRouteBundle } from "@/lib/canvas-route-cache";
import { FilesBody } from "./FilesBody";

/**
 * /w/[slug]/p/[pipeline-id]/files — agency-side pipeline files surface.
 *
 * Phase 4b perf Win #2 (2026-05-26): gate + chrome moved to layout.tsx.
 * This page now just:
 *   1. Defense-in-depth gate via cached `fetchCanvasRouteBundle`
 *      (returns layout's cached bundle, no DB round-trip).
 *   2. Tab-specific fetch: pipeline_links rows.
 *   3. Returns <FilesBody />. Chrome (header + LeftRail) comes from
 *      the shared layout.
 *
 * Auth + redirect rules unchanged — see canvas-route-cache.ts header
 * for the three redirect cases.
 *
 * Portal-side files (4b-3-c) is a separate route at
 * /portal/[pipeline-id]/files — both consume the same fetchPipelineFiles
 * helper; RLS handles the agency vs. client filter at the DB layer.
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

  // Defense-in-depth gate (cached — layout already ran).
  const bundle = await fetchCanvasRouteBundle(slug, pipelineId);

  // Tab-specific data.
  const initialFiles = await fetchPipelineFiles(supabase, pipelineId);

  return (
    <FilesBody
      pipelineId={pipelineId}
      initialFiles={initialFiles}
      viewerId={bundle.user.id}
      canEditPipeline={bundle.chrome.canEditPipeline}
    />
  );
}
