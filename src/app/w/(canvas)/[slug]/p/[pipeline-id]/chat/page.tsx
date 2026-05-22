import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineChromeShell } from "@/components/chrome/PipelineChromeShell";
import { fetchCanvasChromeData } from "@/lib/canvas-chrome-data";
import { fetchPipelineChatSlice1Data } from "@/lib/chat-data";
import { ChatBody } from "./ChatBody";

/**
 * /w/[slug]/p/[pipeline-id]/chat — per-pipeline chat surface.
 * Phase 4b slice 1 (read-only, #general only).
 *
 * Server wrapper mirrors `/clients/page.tsx` exactly:
 *   1. Auth gate (anon → /auth/signin)
 *   2. Workspace membership check (must be a workspace member)
 *   3. Pipeline ↔ workspace match precheck
 *   4. Parallel fetch: chrome data + caller profile + chat slice-1 data
 *   5. Render <PipelineChromeShell><ChatBody /></PipelineChromeShell>
 *
 * `hideEditButton` is set: like /clients, the chat surface isn't where
 * pipeline edits happen, so the "Edit pipeline" toggle would be
 * disorienting on this page. Edit mode is canvas-only (5e decision).
 *
 * The route lives in the (canvas) route group, so PipelineChromeShell
 * (header + LeftRail) wraps the chat body automatically. The LeftRail's
 * chat icon goes active when pathname ends `/chat` — wired in LeftRail.tsx.
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

  // ── Auth gate ──────────────────────────────────────────────────────────
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/w/${encodeURIComponent(
        slug,
      )}/p/${encodeURIComponent(pipelineId)}/chat`,
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

  // ── Parallel: chrome + caller profile + chat data ─────────────────────
  const [chrome, callerProfileRes, chatData] = await Promise.all([
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
    fetchPipelineChatSlice1Data(supabase, pipelineId),
  ]);

  if (!chrome) {
    redirect(`/w/${slug}`);
  }

  return (
    <PipelineChromeShell
      workspaceSlug={ws.slug}
      chrome={chrome}
      // Chat doesn't fetch task counts — pass 0/0 for the subline,
      // same as /clients. Future enhancement (filed against /clients
      // already): pass null and have the shell omit the segment.
      completedTasks={0}
      totalTasks={0}
      user={{
        email: user.email ?? "",
        displayName: callerProfileRes.data?.display_name ?? null,
        avatarUrl: callerProfileRes.data?.avatar_url ?? null,
      }}
      // Edit mode is canvas-only (5e). Hide the toggle here.
      hideEditButton
    >
      <ChatBody
        data={chatData}
        // Slice 2b: viewer object replaces the prior viewerEmail prop.
        // ChatBody needs id + display_name + avatar_url + email to
        // construct optimistic message rows (the author field on a
        // freshly-sent message is the viewer themselves), in addition
        // to email for the composer's "Posting as…" footer line.
        viewer={{
          id: user.id,
          email: user.email ?? null,
          display_name: callerProfileRes.data?.display_name ?? null,
          avatar_url: callerProfileRes.data?.avatar_url ?? null,
        }}
        // Slice 1: route auth already gates on workspace_memberships,
        // so anyone reaching this page is agency-side. The portal-side
        // chat (Phase 4c) will pass `false` and the Layer 3 filter in
        // ChatBody will hide internal messages render-side as the
        // third defense layer behind RLS + server write enforcement.
        viewerIsAgencySide
      />
    </PipelineChromeShell>
  );
}
