"use client";

import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ChatLayout } from "@/components/chat/v2/ChatLayout";
import { ChatSidebar } from "@/components/chat/v2/ChatSidebar";
import { MessageThread } from "@/components/chat/v2/MessageThread";
import type {
  ChatChannel,
  ChatMessage,
  ChatMessageAuthor,
  PipelineChatSlice1Data,
} from "@/lib/chat-data";

/**
 * Client entry for the chat surface. Phase 4b slices 1 + 2b.
 *
 * Owns:
 *   * `activeChannelId` — locked to #general in slices 1-3. Clicking
 *     the client channel row from the sidebar is a no-op until slice 4
 *     wires per-channel fetch + switching.
 *   * `messages` state — initialized from the server fetch, mutated
 *     locally by the send path (slice 2b's optimistic-then-reconcile).
 *     Slice 3 will add a realtime subscription that appends inbound
 *     messages from other authors to this same state. Slice 4 will
 *     rework storage into a per-channel map.
 *   * Layer 3 client-side `is_internal` render filter (CLAUDE.md
 *     security model §4, layer 3). Predicate is hardcoded to "agency
 *     viewer = true" in slices 1-3 because the route's server wrapper
 *     already enforced workspace_memberships. When the portal-side
 *     chat ships, the predicate becomes `viewerIsAgencySide` passed
 *     from the server, and nothing else in this component changes.
 *   * `sendMessage(text, isInternal)` — slice 2b. Optimistic-then-
 *     reconcile insert into channel_messages via the browser client.
 *     RLS (channel_messages_insert) gates on is_channel_member +
 *     author_id = auth.uid() + is_internal scope — all satisfied by
 *     the seed-gap trigger from slice 2a + the explicit viewer.id
 *     pass + the structured isInternal param.
 *
 * Does NOT own:
 *   * Realtime updates from OTHER authors (slice 3).
 *   * Channel switching (slice 4).
 *   * Internal-note toggle UI (slice 4).
 */

type Props = {
  data: PipelineChatSlice1Data;
  /** The logged-in viewer's profile. Used for:
   *  - The composer footer's "Posting as <email>" line (viewer.email).
   *  - The author field on optimistic message rows (slice 2b).
   *  - RLS WITH CHECK on insert (viewer.id must equal auth.uid()). */
  viewer: ChatMessageAuthor;
  /** Slice 1: hardcoded true at the call site because the server
   *  wrapper auth-gates on workspace_memberships, so anyone reaching
   *  this component is agency-side. Wired as a prop so slice 4 /
   *  portal can flip it to per-viewer later without restructuring
   *  this file. */
  viewerIsAgencySide: boolean;
};

export function ChatBody({ data, viewer, viewerIsAgencySide }: Props) {
  // Active channel — locked to #general in slices 1-3. State stays so
  // slice 4 can drive switching here without restructuring.
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    data.generalChannel?.id ?? null,
  );

  // Local messages state. Initialized from the server fetch; mutated
  // by sendMessage's optimistic-then-reconcile. Slice 3 will add a
  // realtime subscription that pushes other authors' messages here.
  const [messages, setMessages] = useState<ChatMessage[]>(
    data.generalMessages,
  );

  const activeChannel: ChatChannel | null = useMemo(() => {
    if (!activeChannelId) return null;
    return data.channels.find((c) => c.id === activeChannelId) ?? null;
  }, [data.channels, activeChannelId]);

  // Layer 3 render filter. Agency-side viewers see everything;
  // non-agency viewers (future: clients) see only `is_internal=false`
  // messages. RLS Layer 1 already filtered server-side; this is the
  // belt-and-suspenders pass that protects against UI render races.
  //
  // CLAUDE.md security model §4: all three layers must remain in place.
  // Do not "simplify" this away — it's intentional defense in depth.
  const visibleMessages: ChatMessage[] = useMemo(() => {
    if (viewerIsAgencySide) return messages;
    return messages.filter((m) => !m.is_internal);
  }, [messages, viewerIsAgencySide]);

  // Slice 1: only #general renders. Clicking the client channel row
  // is a no-op handler (state setter only fires for the general
  // channel id). Slice 4 lifts this.
  const onSelectChannel = (channelId: string) => {
    if (channelId === data.generalChannel?.id) {
      setActiveChannelId(channelId);
    }
    // Client channel click intentionally inert in slice 1-3.
  };

  // ── Send path (slice 2b) ────────────────────────────────────────────
  // Optimistic-then-reconcile pattern. Five steps:
  //   1. Generate a tempId (crypto.randomUUID) for the optimistic row.
  //   2. Append optimistic ChatMessage to local state, author = viewer.
  //   3. Fire the insert via the browser supabase client.
  //   4. On success — swap the optimistic row for the server row by
  //      matching id === tempId. Preserves position in the list.
  //   5. On failure — drop the optimistic row by tempId, return false
  //      so the composer can restore the text and surface an inline
  //      error.
  //
  // RLS (channel_messages_insert) requires:
  //   * is_channel_member(channel_id)  ← slice 2a's trigger seeds this
  //   * author_id = auth.uid()         ← passing viewer.id which we
  //                                       built from supabase.auth.getUser()
  //                                       in the server wrapper
  //   * is_internal scope              ← slice 2b only sends false
  //                                       (normal posts in #general)
  //
  // is_internal is a real param flowing through this call site (it's
  // declared as a function arg, not a hardcoded literal here). The
  // current call site in the composer passes `false`. Slice 4 will
  // replace that single literal with a state-driven boolean from the
  // internal-note toggle UI; nothing else in this chain changes.
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

      setMessages((prev) => [...prev, optimisticMessage]);

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
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        return false;
      }

      // Reconcile: replace the optimistic row by tempId. author is
      // reused from viewer — we know the author IS the current viewer
      // (RLS WITH CHECK guarantees inserted.author_id === auth.uid()).
      const reconciled: ChatMessage = {
        id: inserted.id as string,
        channel_id: inserted.channel_id as string,
        text: inserted.text as string,
        is_internal: inserted.is_internal as boolean,
        created_at: inserted.created_at as string,
        author: viewer,
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? reconciled : m)),
      );
      return true;
    },
    [activeChannelId, viewer],
  );

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
          />
        ) : (
          // Defensive — should never trigger since every pipeline
          // created via create_pipeline_with_channels has a general
          // channel.
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
