import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchPipelineChatData } from "@/lib/chat-data";
import { fetchCanvasChromeData } from "@/lib/canvas-chrome-data";
import { PortalChatBody } from "@/components/portal/v2/PortalChatBody";

/**
 * /portal/[pipeline-id]/chat — client portal Chat tab.
 * Phase 4b-1.
 *
 * Layout already auth-gated this request via can_see_pipeline. We just
 * re-fetch the user (cheap, cached at the request level) for the
 * sendMessage RLS check (author_id = auth.uid()), then fetch:
 *   * chat data (channels + messages, RLS-filtered to what the caller
 *     can see — for clients this is the client channel + non-internal
 *     messages only)
 *   * caller profile (id, display_name, avatar_url, email)
 *   * pipeline member roster via fetchCanvasChromeData (reused —
 *     ignore the agency-specific fields like canEditPipeline)
 *   * workspace name for the channel header label
 *
 * Renders <PortalChatBody> which wraps the existing <ChatBody> with
 * renderSidebar=false + channelHeaderLabel=agencyName +
 * viewerIsAgencySide=false (the locked literal — see PortalChatBody).
 *
 * For a client viewer:
 *   * data.channels contains only the client channel (channels_select
 *     RLS filters #general out — they have no channel_membership for it)
 *   * data.generalMessages is empty
 *   * data.clientMessages contains non-internal messages only
 *     (channel_messages_select RLS filters is_internal=true rows)
 *   * Realtime subscription receives non-internal events only
 *     (RLS-on-realtime filters at the broadcast layer)
 *   * Layer 3 render filter in ChatBody hides any remaining internal
 *     message (belt-and-suspenders against future RLS regression)
 */

export const dynamic = "force-dynamic";

export default async function PortalChatPage({
  params,
}: {
  params: Promise<{ "pipeline-id": string }>;
}) {
  const resolved = await params;
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // Defensive re-check (layout already gated). Mostly here so the user
  // object is available for downstream fetches; the auth.getUser call
  // is cached at the request level so this is essentially free.
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/portal/${encodeURIComponent(pipelineId)}/chat`,
    );
  }

  // ── Parallel: chat data + caller profile + member roster + workspace
  // name. fetchCanvasChromeData is reused (workspaceRole="" — we don't
  // care about canEditPipeline on the portal; it's a no-op flag here).
  const [chatData, callerProfileRes, chromeData, pipelineMetaRes] =
    await Promise.all([
      fetchPipelineChatData(supabase, pipelineId),
      supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email")
        .eq("id", user.id)
        .maybeSingle(),
      fetchCanvasChromeData(supabase, pipelineId, user.id, ""),
      // Workspace name for the channel header label. Depends on
      // migration 20260527120000 for client viewers; pre-migration
      // this returns null for clients and PortalChatBody passes null
      // through to ChatBody which falls back to the default channel
      // header.
      supabase
        .from("pipelines")
        .select(`workspace:workspaces!inner(name)`)
        .eq("id", pipelineId)
        .maybeSingle(),
    ]);

  // PostgREST nested-join normalization (object vs array).
  type WsName = { name: string };
  const wsRaw = pipelineMetaRes.data?.workspace as unknown;
  const agencyName: string | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsName | undefined)?.name ?? null)
    : ((wsRaw as WsName | null)?.name ?? null);

  return (
    <PortalChatBody
      data={chatData}
      viewer={{
        id: user.id,
        email: user.email ?? null,
        display_name: callerProfileRes.data?.display_name ?? null,
        avatar_url: callerProfileRes.data?.avatar_url ?? null,
      }}
      members={chromeData?.members ?? []}
      agencyName={agencyName}
    />
  );
}
