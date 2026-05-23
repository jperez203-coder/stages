"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ChatLayout } from "@/components/chat/v2/ChatLayout";
import { ChatSidebar } from "@/components/chat/v2/ChatSidebar";
import { MessageThread } from "@/components/chat/v2/MessageThread";
import type {
  ChatChannel,
  ChatMessage,
  ChatMessageAuthor,
  PipelineChatData,
} from "@/lib/chat-data";
import type { ChromeMember } from "@/lib/canvas-chrome-data";

/**
 * Client entry for the chat surface. Phase 4b slices 1 + 2b + 3 + 4a.
 *
 * Slice-4a additions:
 *   * Per-channel storage. `messagesByChannel: Record<channelId, ChatMessage[]>`
 *     replaces the flat `messages` array — optimistic sends + realtime
 *     arrivals write to the bucket for their `channel_id`. Switching
 *     channels is now a pure render swap; both channels' state stays
 *     live and accurate.
 *   * Multi-channel realtime. One `supabase.channel()` subscription per
 *     channel (typically 2 — #general + client). All subscriptions
 *     stay live for the lifetime of the ChatBody mount; switching the
 *     active channel does NOT tear them down. Cleanup on unmount loops
 *     over EVERY subscription explicitly — no leaks.
 *   * `onSelectChannel` no-op fence removed. Clicking either channel
 *     row now switches `activeChannelId`.
 *   * `allowInternalToggle` computed from `activeChannel?.is_client &&
 *     viewerIsAgencySide` and passed to MessageThread for the
 *     internal-note toggle in the composer.
 *
 * Owns:
 *   * `activeChannelId` — which channel the user is viewing.
 *   * `messagesByChannel` — per-channel message arrays, mutated by
 *     send-path optimistic-then-reconcile (slice 2b/3) and realtime
 *     INSERT handler (slice 3).
 *   * Layer 3 client-side `is_internal` render filter (CLAUDE.md §4,
 *     layer 3). Operates on the ACTIVE channel's messages; runs for
 *     every viewer regardless of which channel is active.
 *   * `sendMessage(text, isInternal)` — optimistic-then-reconcile with
 *     race-safe three-branch logic.
 *   * Realtime subscriptions (one per channel) + handler.
 *   * Author cache — seeded at mount from `data.generalMessages`,
 *     `data.clientMessages`, and `members`. Lazy-fetch fallback for
 *     authors who joined the pipeline mid-session.
 *
 * Does NOT own (4a is agency-side only):
 *   * Client portal route / chrome / viewer (slice 4b).
 *   * Page-guard fix (slice 4b — agency-side route still guards on
 *     workspace_memberships).
 *   * Computing viewerIsAgencySide — stays a hardcoded `true` prop
 *     from page.tsx for 4a; becomes runtime-computed in 4b.
 */

// Shape of the raw row payload from a postgres_changes INSERT event on
// public.channel_messages. Mirrors the column list we SELECT in
// chat-data.ts, minus the joined profile (realtime payloads only carry
// the table's own columns).
type ChannelMessageRow = {
  id: string;
  channel_id: string;
  author_id: string;
  text: string;
  is_internal: boolean;
  created_at: string;
};

type MessagesByChannel = Record<string, ChatMessage[]>;

type Props = {
  data: PipelineChatData;
  /** The logged-in viewer's profile. Used for:
   *  - The composer footer's "Posting as <email>" line (viewer.email).
   *  - The author field on optimistic message rows.
   *  - RLS WITH CHECK on insert (viewer.id must equal auth.uid()). */
  viewer: ChatMessageAuthor;
  /** Pipeline member roster from chrome — used to seed the author
   *  cache at mount. */
  members: ChromeMember[];
  /** Slice 4a: still hardcoded `true` at the call site because the
   *  agency-side /chat route auth-gates on workspace_memberships. Slice
   *  4b will introduce a separate portal route where this becomes a
   *  runtime-computed boolean (true for agency, false for clients). */
  viewerIsAgencySide: boolean;
};

export function ChatBody({
  data,
  viewer,
  members,
  viewerIsAgencySide,
}: Props) {
  // Active channel — defaults to #general. Slice 4a removes the no-op
  // fence in onSelectChannel so either channel row can become active.
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    data.generalChannel?.id ?? null,
  );

  // Per-channel message storage. Lazy initializer seeds both channels'
  // arrays from the server fetch; runs once at mount.
  const [messagesByChannel, setMessagesByChannel] = useState<MessagesByChannel>(
    () => {
      const init: MessagesByChannel = {};
      if (data.generalChannel) {
        init[data.generalChannel.id] = data.generalMessages;
      }
      if (data.clientChannel) {
        init[data.clientChannel.id] = data.clientMessages;
      }
      return init;
    },
  );

  // ── Author cache ────────────────────────────────────────────────────
  // Seeded once at mount from:
  //   * existing message authors across BOTH channels (slice 4a adds
  //     clientMessages alongside generalMessages)
  //   * every pipeline member in `members`
  // Realtime cache misses (a user added mid-session) trigger lazy fetch
  // via resolveAuthorAndPatch.
  const authorCacheRef = useRef<Map<string, ChatMessageAuthor> | null>(null);
  if (authorCacheRef.current === null) {
    const cache = new Map<string, ChatMessageAuthor>();
    for (const m of data.generalMessages) {
      if (m.author) cache.set(m.author.id, m.author);
    }
    for (const m of data.clientMessages) {
      if (m.author) cache.set(m.author.id, m.author);
    }
    for (const member of members) {
      cache.set(member.user.id, {
        id: member.user.id,
        display_name: member.user.display_name,
        avatar_url: member.user.avatar_url,
        email: member.user.email,
      });
    }
    authorCacheRef.current = cache;
  }

  const activeChannel: ChatChannel | null = useMemo(() => {
    if (!activeChannelId) return null;
    return data.channels.find((c) => c.id === activeChannelId) ?? null;
  }, [data.channels, activeChannelId]);

  // ── Layer 3 render filter (DO NOT REMOVE) ───────────────────────────
  // Defense in depth per CLAUDE.md §4. Operates on the ACTIVE channel's
  // messages. Agency-side viewers see everything; non-agency viewers
  // (future: clients via slice 4b) see only is_internal=false.
  //
  // RLS Layer 1 already filters is_internal at the broadcast point
  // (Supabase Realtime evaluates channel_messages_select against the
  // subscriber's JWT). THIS FILTER REMAINS as the belt-and-suspenders
  // pass: if a future Supabase regression or misconfig were to let an
  // internal row leak through realtime, this is the last line of
  // defense before render. CLAUDE.md §4 requires all three layers
  // stay in place.
  const visibleMessages: ChatMessage[] = useMemo(() => {
    const channelMessages = activeChannelId
      ? (messagesByChannel[activeChannelId] ?? [])
      : [];
    if (viewerIsAgencySide) return channelMessages;
    return channelMessages.filter((m) => !m.is_internal);
  }, [messagesByChannel, activeChannelId, viewerIsAgencySide]);

  // ── Async profile fetch for realtime cache misses ────────────────────
  // Slice 4a takes channelId explicitly so the patch targets the right
  // bucket (previously a flat array; now we need to know which channel's
  // entry to update).
  const resolveAuthorAndPatch = useCallback(
    async (messageId: string, authorId: string, channelId: string) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email")
        .eq("id", authorId)
        .maybeSingle();
      if (!profile) return;
      const resolved: ChatMessageAuthor = {
        id: profile.id as string,
        display_name: (profile.display_name as string | null) ?? null,
        avatar_url: (profile.avatar_url as string | null) ?? null,
        email: (profile.email as string | null) ?? null,
      };
      authorCacheRef.current?.set(authorId, resolved);
      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: (prev[channelId] ?? []).map((m) =>
          m.id === messageId ? { ...m, author: resolved } : m,
        ),
      }));
    },
    [],
  );

  // ── Realtime INSERT handler — dedup + content match, per-channel ─────
  // Writes to messagesByChannel[row.channel_id] — agnostic to which
  // channel is active. Both subscriptions feed the same handler; the
  // handler routes to the right bucket by row.channel_id.
  //
  // Dedup logic unchanged from slice 3 (Layer A id-dedup + Layer B
  // content match for own messages), just operating on a per-channel
  // array. KNOWN EDGE CASE accepted: duplicate-text-rapid-fire +
  // out-of-order realtime can produce a one-frame ordering twitch
  // within the same channel; no data loss.
  const handleRealtimeInsert = useCallback(
    (row: ChannelMessageRow) => {
      const cache = authorCacheRef.current!;
      const cached = cache.get(row.author_id) ?? null;

      const incoming: ChatMessage = {
        id: row.id,
        channel_id: row.channel_id,
        text: row.text,
        is_internal: row.is_internal,
        created_at: row.created_at,
        author: cached,
      };

      setMessagesByChannel((prev) => {
        const channelMessages = prev[row.channel_id] ?? [];

        // Layer A — id dedup
        if (channelMessages.some((m) => m.id === incoming.id)) return prev;

        // Layer B — content match for our own messages
        if (row.author_id === viewer.id) {
          const optimisticIdx = channelMessages.findIndex(
            (m) =>
              m.author?.id === viewer.id &&
              m.text === incoming.text &&
              m.is_internal === incoming.is_internal,
          );
          if (optimisticIdx >= 0) {
            return {
              ...prev,
              [row.channel_id]: channelMessages.map((m, i) =>
                i === optimisticIdx ? incoming : m,
              ),
            };
          }
        }

        return {
          ...prev,
          [row.channel_id]: [...channelMessages, incoming],
        };
      });

      if (!cached) {
        void resolveAuthorAndPatch(row.id, row.author_id, row.channel_id);
      }
    },
    [viewer.id, resolveAuthorAndPatch],
  );

  // ── Realtime subscriptions — ONE PER CHANNEL, all live concurrently ──
  // Slice 4a Option B: subscribe to every channel in data.channels at
  // mount; both stay live for the component's lifetime. Switching the
  // active channel does NOT tear down or recreate subscriptions — it's
  // a pure render swap. This means:
  //
  //   * No missed messages on a channel the user isn't currently viewing.
  //   * Switching back to a previously-inactive channel shows real-time
  //     state, not a stale snapshot from page mount.
  //
  // Cleanup is DELIBERATE about looping over every subscription on
  // unmount — no leaked websockets. The `subscriptions` array is
  // captured in the cleanup closure; we removeChannel each one.
  //
  // Deps: `data.channels` (the array reference from the server prop)
  // and `handleRealtimeInsert` (a stable useCallback). Neither
  // changes in normal flow, so the effect runs once at mount and
  // cleans up once at unmount.
  useEffect(() => {
    if (data.channels.length === 0) return;

    const subscriptions = data.channels.map((c) =>
      supabase
        .channel(`chat:${c.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "channel_messages",
            filter: `channel_id=eq.${c.id}`,
          },
          (payload) => {
            handleRealtimeInsert(payload.new as ChannelMessageRow);
          },
        )
        .subscribe(),
    );

    return () => {
      // Tear down every subscription — never leak. Loop is explicit
      // (no Promise.all needed; removeChannel returns a promise but
      // the cleanup runs synchronously and we don't need to await).
      for (const sub of subscriptions) {
        void supabase.removeChannel(sub);
      }
    };
  }, [data.channels, handleRealtimeInsert]);

  // Slice 4a: no-op fence removed. Clicking either channel row sets
  // activeChannelId; per-channel storage already has both channels'
  // messages loaded; render swaps to the new channel's bucket.
  const onSelectChannel = (channelId: string) => {
    setActiveChannelId(channelId);
  };

  // ── Send path ────────────────────────────────────────────────────────
  // Race-safe three-branch reconcile, operating on the channel's bucket.
  // The channel_id is captured at call time from activeChannelId — if
  // the user switches channels mid-send, the optimistic + reconcile
  // lands in the bucket where the message was composed, not the
  // bucket the user is currently viewing.
  //
  // is_internal is a real param. The composer's call site decides the
  // value: false for #general (always — no internal flag in agency
  // channels), false or true for the client channel (toggle-driven
  // when allowInternalToggle is true).
  const sendMessage = useCallback(
    async (text: string, isInternal: boolean): Promise<boolean> => {
      const channelId = activeChannelId;
      if (!channelId) return false;

      const trimmed = text.trim();
      if (!trimmed) return false;

      const tempId = crypto.randomUUID();
      const optimisticMessage: ChatMessage = {
        id: tempId,
        channel_id: channelId,
        text: trimmed,
        is_internal: isInternal,
        created_at: new Date().toISOString(),
        author: viewer,
      };

      setMessagesByChannel((prev) => ({
        ...prev,
        [channelId]: [...(prev[channelId] ?? []), optimisticMessage],
      }));

      const { data: inserted, error } = await supabase
        .from("channel_messages")
        .insert({
          channel_id: channelId,
          author_id: viewer.id,
          text: trimmed,
          is_internal: isInternal,
        })
        .select("id, channel_id, author_id, text, is_internal, created_at")
        .single();

      if (error || !inserted) {
        console.error("[chat] send failed:", error);
        setMessagesByChannel((prev) => ({
          ...prev,
          [channelId]: (prev[channelId] ?? []).filter(
            (m) => m.id !== tempId,
          ),
        }));
        return false;
      }

      const reconciled: ChatMessage = {
        id: inserted.id as string,
        channel_id: inserted.channel_id as string,
        text: inserted.text as string,
        is_internal: inserted.is_internal as boolean,
        created_at: inserted.created_at as string,
        author: viewer,
      };

      setMessagesByChannel((prev) => {
        const channelMessages = prev[channelId] ?? [];
        const hasServerId = channelMessages.some(
          (m) => m.id === reconciled.id,
        );
        if (hasServerId) {
          // Branch 1 — realtime won the race; drop now-stale optimistic.
          return {
            ...prev,
            [channelId]: channelMessages.filter((m) => m.id !== tempId),
          };
        }
        const hasTempId = channelMessages.some((m) => m.id === tempId);
        if (hasTempId) {
          // Branch 2 — standard reconcile; promote optimistic in place.
          return {
            ...prev,
            [channelId]: channelMessages.map((m) =>
              m.id === tempId ? reconciled : m,
            ),
          };
        }
        // Branch 3 — tempId consumed by content-match realtime racing,
        // but the server row never landed via realtime either.
        // Defensive append.
        return {
          ...prev,
          [channelId]: [...channelMessages, reconciled],
        };
      });
      return true;
    },
    [activeChannelId, viewer],
  );

  // Slice 4a: the internal-note toggle in the composer is gated on
  // (a) the active channel being the client channel — internal-vs-
  // visible distinction is meaningless in #general where clients have
  // no subscription anyway, AND (b) the viewer being agency-side —
  // clients should never see the toggle (gated correctly now even
  // though clients can't reach this route in 4a).
  const allowInternalToggle =
    activeChannel?.is_client === true && viewerIsAgencySide;

  return (
    <ChatLayout
      sidebar={
        <ChatSidebar
          channels={data.channels}
          generalChannel={data.generalChannel}
          clientChannel={data.clientChannel}
          showClientChannel={
            data.pipelineHasClient && data.clientChannel !== null
          }
          activeChannelId={activeChannelId}
          onSelectChannel={onSelectChannel}
        />
      }
      thread={
        activeChannel ? (
          <MessageThread
            channel={activeChannel}
            messages={visibleMessages}
            viewerEmail={viewer.email ?? ""}
            onSend={sendMessage}
            allowInternalToggle={allowInternalToggle}
            // Slice 4a follow-up: needed to gate the per-message
            // "Internal" badge in the client channel. MessageThread
            // AND-s this with channel.is_client to compute whether
            // to render the badge on internal rows. Stays in lockstep
            // with allowInternalToggle's gating (currently the same
            // formula; kept as separate prop for semantic clarity).
            viewerIsAgencySide={viewerIsAgencySide}
          />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.5)",
              fontSize: 14,
            }}
          >
            No channel selected.
          </div>
        )
      }
    />
  );
}
