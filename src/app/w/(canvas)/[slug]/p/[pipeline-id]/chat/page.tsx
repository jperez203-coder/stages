import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchPipelineChatData } from "@/lib/chat-data";
import { fetchCanvasRouteBundle } from "@/lib/canvas-route-cache";
import { ChatBody } from "./ChatBody";

/**
 * /w/[slug]/p/[pipeline-id]/chat — per-pipeline chat surface.
 *
 * Phase 4b perf Win #2 (2026-05-26): gate + chrome moved to layout.tsx.
 * This page now just:
 *   1. Defense-in-depth gate via cached `fetchCanvasRouteBundle`
 *      (returns layout's cached bundle, no DB round-trip).
 *   2. Tab-specific fetch: chat data only.
 *   3. Returns <ChatBody />. Chrome (header + LeftRail) comes from
 *      the shared layout.
 *
 * Auth + redirect rules unchanged — see canvas-route-cache.ts header
 * for the three redirect cases. LeftRail's chat-icon active state
 * is still driven by pathname inside LeftRail.tsx (unchanged).
 */

export const dynamic = "force-dynamic";

export default async function PipelineChatPage({
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
  const chatData = await fetchPipelineChatData(supabase, pipelineId);

  return (
    <ChatBody
      data={chatData}
      // Slice 2b: viewer object replaces the prior viewerEmail prop.
      // ChatBody needs id + display_name + avatar_url + email to
      // construct optimistic message rows (the author field on a
      // freshly-sent message is the viewer themselves), in addition
      // to email for the composer's "Posting as…" footer line.
      viewer={{
        id: bundle.user.id,
        email: bundle.user.email,
        display_name: bundle.callerProfile.display_name,
        avatar_url: bundle.callerProfile.avatar_url,
      }}
      // Slice 3: pass the pipeline's member roster (already in
      // chrome) to ChatBody for author-cache seeding. Realtime
      // INSERT events carry just author_id (no joined profile);
      // ChatBody resolves it via this cache for instant render
      // without a per-event profile fetch. Async fallback fetch
      // covers the rare case of an author who joined the pipeline
      // mid-session and isn't in this snapshot.
      members={bundle.chrome.members}
      // Slice 1: route auth (layout + this page) gates on
      // workspace_memberships, so anyone reaching this page is
      // agency-side. The portal-side chat (Phase 4c) passes `false`
      // and the Layer 3 filter in ChatBody hides internal messages
      // render-side as the third defense layer behind RLS + server
      // write enforcement.
      viewerIsAgencySide
    />
  );
}
