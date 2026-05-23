import type { createSupabaseServerClient } from "./supabase-server";

/**
 * Server-side data fetch for the per-pipeline chat surface.
 *
 * History:
 *   Phase 4b slice 1 — read-only #general only.
 *   Phase 4b slice 4a (this iteration) — fetch BOTH channels' messages
 *   at mount so channel switching is a pure render swap (no client-side
 *   round-trip on switch). Two channels max per pipeline + small message
 *   counts make the extra fetch trivial.
 *
 * **Two-query author-profile join (locked pattern):** the same forever-rule
 * documented in `canvas-chrome-data.ts` applies — `channel_messages.author_id`
 * references `auth.users`, NOT `profiles`. PostgREST's nested
 * `author:profiles!inner(...)` returns 0 rows because the schema has no
 * direct FK between the two. We fetch messages, collect distinct
 * author_ids across both channels, then batch-fetch profiles in one
 * query and join in memory.
 *
 * **Sidebar gate for the client channel** (still applies in 4a):
 * the client channel row is only shown when a `pipeline_memberships`
 * row with `role='client'` exists for this pipeline. The channel
 * itself stays in the DB regardless (seeded at pipeline creation by
 * `create_pipeline_with_channels`) — we just hide the sidebar row
 * until there's someone to talk to. Pending invites are surfaced on
 * `/clients`, not here. Both channel ids + messages are still returned
 * so the body has them ready when the gate flips on.
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

export type PipelineChatData = {
  /** All channels for the pipeline (typically 2 — general + client). */
  channels: ChatChannel[];
  /** The `is_client = false` channel. Null defensively if missing
   *  (shouldn't happen — `create_pipeline_with_channels` always seeds it). */
  generalChannel: ChatChannel | null;
  /** The `is_client = true` channel. Sidebar shows it only when
   *  `pipelineHasClient` is true. */
  clientChannel: ChatChannel | null;
  /** True when at least one `pipeline_memberships.role = 'client'` row
   *  exists for this pipeline. Sidebar gate for the client channel. */
  pipelineHasClient: boolean;
  /** Messages for #general, ascending by created_at. */
  generalMessages: ChatMessage[];
  /** Messages for the client channel, ascending by created_at. Empty
   *  array when clientChannel is null. Slice 4a: fetched at mount so
   *  switching is instant. */
  clientMessages: ChatMessage[];
};

/**
 * Fetch chat data for one pipeline.
 *
 * Caller provides `pipelineId` (from the route). Auth is already gated by
 * the calling page; this helper does no auth check of its own and runs
 * under the caller's RLS context (their JWT).
 */
export async function fetchPipelineChatData(
  supabase: SupabaseServerClient,
  pipelineId: string,
): Promise<PipelineChatData> {
  // ── Step 1: channels + client-existence check, in parallel ──────────────
  const [channelsRes, clientCountRes] = await Promise.all([
    supabase
      .from("channels")
      .select("id, name, is_client")
      .eq("pipeline_id", pipelineId)
      .order("is_client", { ascending: true })
      .order("created_at", { ascending: true }),

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

  // ── Step 2: messages for BOTH channels in parallel ──────────────────────
  // No-op stubs when a channel is missing — defensive, shouldn't happen
  // for any pipeline created via create_pipeline_with_channels.
  //
  // PostgREST nested-join forever-rule (see file header): we do NOT
  // attempt `author:profiles!inner(...)` here. Profiles join happens
  // separately in step 3 with a batched .in("id", authorIds) query.
  type RawMessageRow = {
    id: string;
    channel_id: string;
    author_id: string | null;
    text: string;
    is_internal: boolean;
    created_at: string;
  };

  const [generalMessagesRes, clientMessagesRes] = await Promise.all([
    generalChannel
      ? supabase
          .from("channel_messages")
          .select(
            "id, channel_id, author_id, text, is_internal, created_at",
          )
          .eq("channel_id", generalChannel.id)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as RawMessageRow[], error: null }),
    clientChannel
      ? supabase
          .from("channel_messages")
          .select(
            "id, channel_id, author_id, text, is_internal, created_at",
          )
          .eq("channel_id", clientChannel.id)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as RawMessageRow[], error: null }),
  ]);

  const generalRaw = (generalMessagesRes.data ?? []) as RawMessageRow[];
  const clientRaw = (clientMessagesRes.data ?? []) as RawMessageRow[];

  // ── Step 3: batched profiles for the UNION of author_ids ────────────────
  // Same pattern as canvas-chrome-data. One profiles query covers both
  // channels' authors — no duplicate work for users who posted in both.
  // The profiles_select RLS fix from 20260524120000 lets workspace
  // owners/admins read pipeline-only members' profiles too.
  const authorIds = Array.from(
    new Set(
      [...generalRaw, ...clientRaw]
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

  const toChatMessage = (m: RawMessageRow): ChatMessage => ({
    id: m.id,
    channel_id: m.channel_id,
    text: m.text,
    is_internal: m.is_internal,
    created_at: m.created_at,
    author: m.author_id ? (profileById.get(m.author_id) ?? null) : null,
  });

  return {
    channels,
    generalChannel,
    clientChannel,
    pipelineHasClient,
    generalMessages: generalRaw.map(toChatMessage),
    clientMessages: clientRaw.map(toChatMessage),
  };
}
