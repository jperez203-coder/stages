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
  PipelineChatSlice1Data,
} from "@/lib/chat-data";
import type { ChromeMember } from "@/lib/canvas-chrome-data";

/**
 * Client entry for the chat surface. Phase 4b slices 1 + 2b + 3.
 *
 * Owns:
 *   * `activeChannelId` — locked to #general in slices 1-3. Clicking
 *     the client channel row from the sidebar is a no-op until slice 4
 *     wires per-channel fetch + switching.
 *   * `messages` state — initialized from the server fetch, mutated
 *     locally by (a) the send path (slice 2b's optimistic-then-reconcile)
 *     and (b) the realtime subscription (slice 3's postgres_changes
 *     handler). Slice 4 will rework storage into a per-channel map.
 *   * Layer 3 client-side `is_internal` render filter (CLAUDE.md
 *     security model §4, layer 3). Predicate is hardcoded to "agency
 *     viewer = true" in slices 1-3 because the route's server wrapper
 *     already enforced workspace_memberships. When the portal-side
 *     chat ships, the predicate becomes `viewerIsAgencySide` passed
 *     from the server, and nothing else in this component changes.
 *   * `sendMessage(text, isInternal)` — slice 2b. Optimistic-then-
 *     reconcile insert into channel_messages via the browser client.
 *     Race-safe three-branch reconcile (slice 3 hardening) so the
 *     realtime echo of own send doesn't produce a duplicate.
 *   * Realtime subscription — slice 3. supabase.channel keyed on
 *     activeChannelId; cleanly tears down + resubscribes when the
 *     channel changes (slice 4 will exercise that path).
 *   * Author cache — slice 3. Map<user_id, ChatMessageAuthor> seeded
 *     at mount from data.generalMessages + members; supports instant
 *     author resolution on realtime-arrived rows + async fallback
 *     fetch for authors who joined the pipeline mid-session.
 *
 * Does NOT own:
 *   * Channel switching (slice 4).
 *   * Internal-note toggle UI (slice 4).
 *   * Edit / delete messages.
 *   * Typing indicators, presence, read state.
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

type Props = {
  data: PipelineChatSlice1Data;
  /** The logged-in viewer's profile. Used for:
   *  - The composer footer's "Posting as <email>" line (viewer.email).
   *  - The author field on optimistic message rows (slice 2b).
   *  - RLS WITH CHECK on insert (viewer.id must equal auth.uid()). */
  viewer: ChatMessageAuthor;
  /** Pipeline member roster from chrome — used to seed the author
   *  cache at mount so realtime-arrived messages render with the
   *  correct name + avatar without a profile fetch round-trip. */
  members: ChromeMember[];
  /** Slice 1: hardcoded true at the call site because the server
   *  wrapper auth-gates on workspace_memberships, so anyone reaching
   *  this component is agency-side. Wired as a prop so slice 4 /
   *  portal can flip it to per-viewer later without restructuring
   *  this file. */
  viewerIsAgencySide: boolean;
};

export function ChatBody({
  data,
  viewer,
  members,
  viewerIsAgencySide,
}: Props) {
  // Active channel — locked to #general in slices 1-3. State stays so
  // slice 4 can drive switching here without restructuring.
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    data.generalChannel?.id ?? null,
  );

  // Local messages state. Initialized from the server fetch; mutated
  // by sendMessage's optimistic-then-reconcile (slice 2b) and the
  // realtime INSERT handler (slice 3).
  const [messages, setMessages] = useState<ChatMessage[]>(
    data.generalMessages,
  );

  // ── Author cache ────────────────────────────────────────────────────
  // Map<user_id, ChatMessageAuthor>. Seeded once on mount from:
  //   * existing message authors in data.generalMessages
  //   * every pipeline member in `members`
  // Realtime INSERT events carry only author_id; this cache resolves
  // it to {display_name, avatar_url, email} for instant render. Cache
  // misses (a user who joined the pipeline mid-session, after this
  // component mounted) trigger a lazy fetch via resolveAuthorAndPatch.
  //
  // useRef + lazy init: the if-check runs every render (cheap), the
  // Map build runs only once (when ref.current is null). React dev
  // strict-mode double-renders are fine — the second render sees the
  // ref already populated and skips the build.
  const authorCacheRef = useRef<Map<string, ChatMessageAuthor> | null>(null);
  if (authorCacheRef.current === null) {
    const cache = new Map<string, ChatMessageAuthor>();
    for (const m of data.generalMessages) {
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
  // Defense in depth per CLAUDE.md §4. Agency-side viewers see
  // everything; non-agency viewers (future: clients) see only
  // is_internal=false messages.
  //
  // This filter runs on ALL messages in state — including those that
  // arrived via the realtime subscription. RLS Layer 1 already filters
  // is_internal at the broadcast point (Supabase Realtime evaluates
  // channel_messages_select against the subscriber's JWT before
  // sending), so a client subscriber should never receive an internal
  // row in the first place. THIS FILTER REMAINS as the belt-and-
  // suspenders pass: if a future Supabase regression or misconfig were
  // to let an internal row leak through realtime, this is the last
  // line of defense before render.
  //
  // CLAUDE.md security model §4 explicitly requires all three layers
  // stay in place. Do not "simplify" this away thinking RLS makes it
  // redundant — it is layered, not redundant.
  const visibleMessages: ChatMessage[] = useMemo(() => {
    if (viewerIsAgencySide) return messages;
    return messages.filter((m) => !m.is_internal);
  }, [messages, viewerIsAgencySide]);

  // ── Async profile fetch for realtime cache misses ────────────────────
  // Fires when a realtime INSERT arrives whose author_id isn't in the
  // mount-time cache. Patches the message in state once the fetch
  // resolves. The message renders immediately with author=null first
  // (avatar shows "?" placeholder, name resolves to "Pending member"
  // via resolveAuthorName); the patch swaps in the real values.
  //
  // RLS on the profiles SELECT is the existing profiles_select policy
  // (with the 2026-05-22 workspace-owner widening). If the caller
  // can't see the profile (cross-workspace, etc.), the fetch returns
  // null and the message stays as "Pending member" — defensible.
  const resolveAuthorAndPatch = useCallback(
    async (messageId: string, authorId: string) => {
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
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, author: resolved } : m)),
      );
    },
    [],
  );

  // ── Realtime INSERT handler — dedup + content match ──────────────────
  // Two-layer dedup against optimistic sends + general redundant events:
  //
  //   Layer A (id-dedup):
  //     A message with the incoming server id already in state means
  //     either (i) the reconcile path already promoted the optimistic
  //     row, or (ii) we received a redundant broadcast. Skip.
  //
  //   Layer B (content match for own messages):
  //     If the incoming row is FROM us, check for an optimistic row
  //     in state with matching content (text + is_internal). If found,
  //     replace it in place — handles the rare "realtime fires before
  //     reconcile" race without producing a brief visible duplicate.
  //
  // KNOWN EDGE CASE (accepted): if the user sends the exact same text
  // twice in rapid succession AND the realtime echoes arrive in the
  // OPPOSITE order from the inserts resolving, Layer B's findIndex
  // can match the "wrong" optimistic on one event. Final state is
  // still correct (both server rows present, defensive append in
  // reconcile catches it); intermediate state could briefly show
  // ordering glitches. No data loss. Accepted per slice 3 spec.
  // Hardening (content-keyed pending map) is deferred.
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

      setMessages((prev) => {
        // Layer A — id dedup
        if (prev.some((m) => m.id === incoming.id)) return prev;

        // Layer B — content match for our own messages
        if (row.author_id === viewer.id) {
          const optimisticIdx = prev.findIndex(
            (m) =>
              m.author?.id === viewer.id &&
              m.text === incoming.text &&
              m.is_internal === incoming.is_internal,
          );
          if (optimisticIdx >= 0) {
            return prev.map((m, i) => (i === optimisticIdx ? incoming : m));
          }
        }

        return [...prev, incoming];
      });

      // Cache miss → resolve author asynchronously and patch the row.
      if (!cached) {
        void resolveAuthorAndPatch(row.id, row.author_id);
      }
    },
    [viewer.id, resolveAuthorAndPatch],
  );

  // ── Realtime subscription ──────────────────────────────────────────
  // Scoped to activeChannelId. Cleanup tears down the subscription on
  // unmount AND on activeChannelId change — slice 4 will exercise the
  // change path when channel switching ships; the teardown + resubscribe
  // is already set up here.
  //
  // The filter `channel_id=eq.${activeChannelId}` is a server-side
  // filter applied by the realtime server BEFORE broadcasting. RLS
  // still runs on top (this filter is additive, not a replacement).
  useEffect(() => {
    if (!activeChannelId) return;

    const channel = supabase
      .channel(`chat:${activeChannelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
          filter: `channel_id=eq.${activeChannelId}`,
        },
        (payload) => {
          handleRealtimeInsert(payload.new as ChannelMessageRow);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [activeChannelId, handleRealtimeInsert]);

  // Slice 1: only #general renders. Clicking the client channel row
  // is a no-op handler (state setter only fires for the general
  // channel id). Slice 4 lifts this.
  const onSelectChannel = (channelId: string) => {
    if (channelId === data.generalChannel?.id) {
      setActiveChannelId(channelId);
    }
    // Client channel click intentionally inert in slices 1-3.
  };

  // ── Send path (slice 2b + slice 3 race-safe reconcile) ──────────────
  // Optimistic-then-reconcile pattern. The reconcile is now a
  // three-branch decision to handle the realtime-fires-first race:
  //
  //   1. server id ALREADY in state → realtime won the race and
  //      promoted the optimistic. Just drop the now-stale tempId.
  //   2. tempId still in state → standard reconcile, replace in place.
  //   3. tempId missing AND server id missing → content-match raced
  //      and consumed the optimistic. Defensive append so we don't
  //      lose the message.
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

      const reconciled: ChatMessage = {
        id: inserted.id as string,
        channel_id: inserted.channel_id as string,
        text: inserted.text as string,
        is_internal: inserted.is_internal as boolean,
        created_at: inserted.created_at as string,
        author: viewer,
      };

      setMessages((prev) => {
        const hasServerId = prev.some((m) => m.id === reconciled.id);
        if (hasServerId) {
          // Branch 1 — realtime won the race; drop now-stale optimistic.
          return prev.filter((m) => m.id !== tempId);
        }
        const hasTempId = prev.some((m) => m.id === tempId);
        if (hasTempId) {
          // Branch 2 — standard reconcile; promote optimistic in place.
          return prev.map((m) => (m.id === tempId ? reconciled : m));
        }
        // Branch 3 — tempId consumed by content-match realtime racing,
        // but the server row never landed. Defensive append.
        return [...prev, reconciled];
      });
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
