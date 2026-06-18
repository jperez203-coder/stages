import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchPipelineChatData } from "@/lib/chat-data";
import { fetchCanvasChromeData } from "@/lib/canvas-chrome-data";
import type { ChromeMember } from "@/lib/canvas-chrome-data";
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

  // ── NF-2.5: augment members with the @mention audience for the client
  // channel via the get_channel_mention_audience RPC.
  //
  // Why: fetchCanvasChromeData reads pipeline_memberships, which
  // pipeline_memberships_select restricts for clients to just their
  // own row. The base `members` array therefore contains only the
  // client themselves — and the picker filter drops the viewer, so
  // 0 candidates render. The cyan-mention cache misses any agency
  // user who hasn't posted in the channel (the cache's other seed
  // path). Both consumers stem from `members`.
  //
  // The RPC is SECURITY DEFINER, so it returns role + profile for
  // every channel_memberships user regardless of the client's RLS
  // visibility into pipeline_memberships. Authz on the RPC side
  // gates by channel-member arm + agency-of-parent-pipeline arm,
  // matching channel access posture.
  //
  // Only call for the client channel (the channel the client can
  // actually post in). Defensive: silently fall back to the chrome
  // members alone if the RPC errors or returns null.
  const baseMembers: ChromeMember[] = chromeData?.members ?? [];
  let portalMembers: ChromeMember[] = baseMembers;

  if (chatData.clientChannel) {
    const audienceRes = await supabase.rpc("get_channel_mention_audience", {
      p_channel_id: chatData.clientChannel.id,
    });

    if (audienceRes.error) {
      // Same PostgrestError-log discipline as the rest of the NF arc —
      // bare console.error(err) serializes to `{}`. Fail open: the chat
      // still renders, just without the augmented audience.
      console.error(
        "[portal/chat] get_channel_mention_audience failed:",
        audienceRes.error.message,
        "code:",
        audienceRes.error.code,
        "details:",
        audienceRes.error.details,
        "hint:",
        audienceRes.error.hint,
      );
    } else if (Array.isArray(audienceRes.data)) {
      type AudienceRow = {
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
        email: string | null;
        role: string;
      };
      const seen = new Set<string>();
      const merged: ChromeMember[] = [];
      // Keep the chrome-derived self entry first so the existing sort
      // assumption (agency before clients, then joined_at) isn't
      // disturbed for any future consumer of `members`.
      for (const m of baseMembers) {
        if (seen.has(m.user.id)) continue;
        seen.add(m.user.id);
        merged.push(m);
      }
      for (const row of audienceRes.data as AudienceRow[]) {
        if (seen.has(row.user_id)) continue;
        seen.add(row.user_id);
        merged.push({
          role: row.role,
          user: {
            id: row.user_id,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            email: row.email,
          },
        });
      }
      portalMembers = merged;
    }
  }

  return (
    <PortalChatBody
      data={chatData}
      viewer={{
        id: user.id,
        email: user.email ?? null,
        display_name: callerProfileRes.data?.display_name ?? null,
        avatar_url: callerProfileRes.data?.avatar_url ?? null,
      }}
      members={portalMembers}
      agencyName={agencyName}
    />
  );
}
