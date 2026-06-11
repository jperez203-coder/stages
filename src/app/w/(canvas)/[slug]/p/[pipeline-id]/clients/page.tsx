import { redirect } from "next/navigation";
import { fetchCanvasRouteBundle } from "@/lib/canvas-route-cache";
import { ClientsBody } from "./ClientsBody";

/**
 * /w/[slug]/p/[pipeline-id]/clients — agency-side client invite UI.
 *
 * Phase 4b perf Win #2 (2026-05-26): gate + chrome moved to layout.tsx.
 * This page now just:
 *   1. Defense-in-depth gate via cached `fetchCanvasRouteBundle`
 *      (returns layout's cached bundle, no DB round-trip).
 *   2. WT-5: redirect to the pipeline's canvas root when the parent
 *      workspace's type='personal' — personal workspaces have no
 *      client-portal surface, so this tab has nothing to render.
 *      The LeftRail "+ Invite client" affordance is hidden on personal
 *      workspaces too, so direct URL is the only way to hit this page.
 *   3. Returns <ClientsBody />. Chrome (header + LeftRail) comes from
 *      the shared layout.
 *
 * No tab-specific server fetch — ClientsBody fetches its own data
 * client-side. The bundle call is purely the defense-in-depth gate.
 *
 * Auth + redirect rules unchanged — see canvas-route-cache.ts header
 * for the three redirect cases.
 */

export const dynamic = "force-dynamic";

export default async function PipelineClientsPage({
  params,
}: {
  params: Promise<{ slug: string; "pipeline-id": string }>;
}) {
  const resolved = await params;
  const { slug } = resolved;
  const pipelineId = resolved["pipeline-id"];

  // Defense-in-depth gate (cached — layout already ran). Bundle's
  // returned data isn't needed here (ClientsBody self-fetches) EXCEPT
  // for the WT-5 personal-workspace branch below.
  const bundle = await fetchCanvasRouteBundle(slug, pipelineId);

  if (bundle.ws.type === "personal") {
    redirect(`/w/${encodeURIComponent(slug)}/p/${encodeURIComponent(pipelineId)}`);
  }

  return <ClientsBody />;
}
