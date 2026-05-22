"use client";

import { useMemo, useState } from "react";
import { ChatLayout } from "@/components/chat/v2/ChatLayout";
import { ChatSidebar } from "@/components/chat/v2/ChatSidebar";
import { MessageThread } from "@/components/chat/v2/MessageThread";
import type {
  ChatChannel,
  ChatMessage,
  PipelineChatSlice1Data,
} from "@/lib/chat-data";

/**
 * Client entry for the chat surface. Phase 4b slice 1.
 *
 * Owns:
 *   * `activeChannelId` — locked to #general in slice 1. Clicking the
 *     client channel row from the sidebar is a no-op until slice 4
 *     wires per-channel fetch + switching.
 *   * The Layer 3 client-side `is_internal` render filter (CLAUDE.md
 *     security model §4, layer 3). Predicate is hardcoded to "agency
 *     viewer = true" in slice 1 because the route's server wrapper
 *     already enforced workspace_memberships. When the portal-side
 *     chat ships, the predicate becomes `viewerIsAgencySide` passed
 *     from the server, and nothing else in this component changes.
 *
 * Does NOT own:
 *   * Sending (slice 2). Composer is rendered disabled inside
 *     MessageThread.
 *   * Realtime updates (slice 3). The messages prop is whatever the
 *     server fetched at page-load time.
 *   * Channel switching (slice 4).
 */

type Props = {
  data: PipelineChatSlice1Data;
  /** Logged-in viewer's email — displayed in the composer footer
   *  ("Posting as <email>"). */
  viewerEmail: string;
  /** Slice 1: hardcoded true at the call site because the server
   *  wrapper auth-gates on workspace_memberships, so anyone reaching
   *  this component is agency-side. Wired as a prop so slice 4 / portal
   *  can flip it to per-viewer later without restructuring this file. */
  viewerIsAgencySide: boolean;
};

export function ChatBody({ data, viewerEmail, viewerIsAgencySide }: Props) {
  // Active channel — locked to #general in slice 1. We still track it as
  // state so slice 4 can drive switching here without restructuring.
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    data.generalChannel?.id ?? null,
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
    if (viewerIsAgencySide) return data.generalMessages;
    return data.generalMessages.filter((m) => !m.is_internal);
  }, [data.generalMessages, viewerIsAgencySide]);

  // Slice 1: only #general renders. Clicking the client channel row
  // is a no-op handler (we set state, but since this slice doesn't
  // re-fetch messages on change, we keep activeChannelId pinned to the
  // general channel to avoid showing an empty thread). Slice 4 lifts
  // this — at which point the sidebar onSelectChannel goes through.
  const onSelectChannel = (channelId: string) => {
    if (channelId === data.generalChannel?.id) {
      setActiveChannelId(channelId);
    }
    // Client channel click intentionally inert in slice 1.
  };

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
            viewerEmail={viewerEmail}
          />
        ) : (
          // Defensive — should never trigger in slice 1 since every
          // pipeline created via create_pipeline_with_channels has a
          // general channel.
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
