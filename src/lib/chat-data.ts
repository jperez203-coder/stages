import type { createSupabaseServerClient } from "./supabase-server";

/**
 * Server-side data fetch for the per-pipeline chat surface (slice 1 of 4).
 * Phase 4b — first per-pipeline chat slice.
 *
 * Slice 1 is READ-ONLY for `#general` only. The sidebar lists both
 * channels when applicable, but messages are only fetched for the
 * `is_client = false` channel. Channel-switching ships in slice 4.
 *
 * **Two-query author-profile join (locked pattern):** the same forever-rule
 * documented in `canvas-chrome-data.ts` applies — `channel_messages.author_id`
 * references `auth.users`, NOT `profiles`. PostgREST's nested
 * `author:profiles!inner(...)` returns 0 rows because the schema has no
 * direct FK between the two. We fetch messages, collect distinct
 * author_ids, then batch-fetch profiles separately and join in memory.
 *
 * **Sidebar gate for the client channel:** per Jordan 2026-05-22, the
 * client channel row in the sidebar is only shown when a client has
 * actually accepted an invite — i.e. when a `pipeline_memberships` row
 * with `role = 'client'` exists for this pipeline. The channel itself
 * stays in the DB regardless (seeded at pipeline creation by
 * `create_pipeline_with_channels`) — we just hide the sidebar row
 * until there's someone to talk to. Pending invites are surfaced on
 * `/clients`, not here. The fetch returns `pipelineHasClient: boolean`
 * for the body to gate on; both channel ids are still returned so
 * slice 4's switching has them ready.
 */

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type ChatChannel = {
  id: string;
  name: string;
  is_client: boolean;
};

export type ChatMessageAuthor = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

export type ChatMessage = {
  id: string;
  channel_id: string;
  text: string;
  is_internal: boolean;
  created_at: string;
  /** Null when the author's auth.users row was deleted (FK set null). */
  author: ChatMessageAuthor | null;
};

export type PipelineChatSlice1Data = {
  /** All channels for the pipeline (typically 2 — general + client). */
  channels: ChatChannel[];
  /** The `is_client = false` channel for slice 1. Null defensively if missing
   *  (shouldn't happen — `create_pipeline_with_channels` always seeds it). */
  generalChannel: ChatChannel | null;
  /** The `is_client = true` channel. Sidebar shows it only when
   *  `pipelineHasClient` is true. Slice 4 wires switching to it. */
  clientChannel: ChatChannel | null;
  /** True when at least one `pipeline_memberships.role = 'client'` row
   *  exists for this pipeline. Sidebar gate for the client channel. */
  pipelineHasClient: boolean;
  /** Messages for #general, ascending by created_at. Server-side RLS
   *  (channel_messages_select Layer 1) already filters internal messages
   *  for non-agency viewers; the body component applies the Layer 3
   *  client-render filter as belt-and-suspenders before mapping to rows. */
  generalMessages: ChatMessage[];
};

/**
 * Fetch slice-1 chat data for one pipeline.
 *
 * Caller provides `pipelineId` (from the route). Auth is already gated by
 * the calling page; this helper does no auth check of its own and runs
 * under the caller's RLS context (their JWT).
 */
export async function fetchPipelineChatSlice1Data(
  supabase: SupabaseServerClient,
  pipelineId: string,
): Promise<PipelineChatSlice1Data> {
  // ── Step 1: channels + client-existence check, in parallel ──────────────
  // We fetch the channel list and the "is there a client?" count together
  // since neither depends on the other.
  const [channelsRes, clientCountRes] = await Promise.all([
    supabase
      .from("channels")
      .select("id, name, is_client")
      .eq("pipeline_id", pipelineId)
      .order("is_client", { ascending: true })
      .order("created_at", { ascending: true }),

    // Lightweight count — `head: true` avoids returning rows; we only
    // need to know "≥ 1 row" exists. Single indexed lookup.
    supabase
      .from("pipeline_memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("pipeline_id", pipelineId)
      .eq("role", "client"),
  ]);

  const channels: ChatChannel[] = (channelsRes.data ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    is_client: c.is_client as boolean,
  }));

  const generalChannel = channels.find((c) => !c.is_client) ?? null;
  const clientChannel = channels.find((c) => c.is_client) ?? null;
  const pipelineHasClient = (clientCountRes.count ?? 0) > 0;

  // ── Step 2: messages for #general only (slice 1 scope) ──────────────────
  // No messages fetch if there's no general channel (defensive — every
  // pipeline created via `create_pipeline_with_channels` has one).
  let messagesData: Array<{
    id: string;
    channel_id: string;
    author_id: string | null;
    text: string;
    is_internal: boolean;
    created_at: string;
  }> = [];

  if (generalChannel) {
    const messagesRes = await supabase
      .from("channel_messages")
      .select("id, channel_id, author_id, text, is_internal, created_at")
      .eq("channel_id", generalChannel.id)
      .order("created_at", { ascending: true });

    messagesData = (messagesRes.data ?? []) as typeof messagesData;
  }

  // ── Step 3: batched author profiles ─────────────────────────────────────
  // Same pattern as fetchCanvasChromeData. The profiles_select RLS fix
  // from migration 20260524120000 already lets workspace owners/admins
  // read profiles of any pipeline-member in their workspace's pipelines —
  // including pipeline-only members who posted messages — so message
  // authors render with their real display_name, not "Pending member".
  const authorIds = Array.from(
    new Set(
      messagesData
        .map((m) => m.author_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const profilesRes = authorIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email")
        .in("id", authorIds)
    : { data: [], error: null };

  const profileById = new Map<string, ChatMessageAuthor>();
  for (const p of (profilesRes.data ?? []) as ChatMessageAuthor[]) {
    profileById.set(p.id, p);
  }

  const generalMessages: ChatMessage[] = messagesData.map((m) => ({
    id: m.id,
    channel_id: m.channel_id,
    text: m.text,
    is_internal: m.is_internal,
    created_at: m.created_at,
    author: m.author_id ? (profileById.get(m.author_id) ?? null) : null,
  }));

  return {
    channels,
    generalChannel,
    clientChannel,
    pipelineHasClient,
    generalMessages,
  };
}
