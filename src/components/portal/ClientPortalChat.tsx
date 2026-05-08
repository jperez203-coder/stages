"use client";

import { useState } from "react";
import { Hash, MessageCircle, Users } from "lucide-react";
import { ChannelRow } from "@/components/chat/ChannelRow";
import { MessageRow } from "@/components/chat/MessageRow";
import { ChannelComposer } from "@/components/chat/ChannelComposer";
import { MembersAvatarStack } from "@/components/chat/MembersAvatarStack";
import type { Channel, ClientSession } from "@/types/stages";

type Props = {
  channels: Channel[];
  clientSession: ClientSession;
  onSendChannelMessage: (channelId: string, text: string, mentions: string[]) => void;
};

export function ClientPortalChat({
  channels,
  clientSession,
  onSendChannelMessage,
}: Props) {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(channels[0]?.id || null);
  const activeChannel = channels.find((ch) => ch.id === activeChannelId) || channels[0];
  // Reuse MessageRow / ChannelComposer with a client-flavored session shape.
  const fakeSession = { email: clientSession.email, role: "client" };

  if (!activeChannel) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "calc(100vh - 64px)" }}
      >
        <div className="text-center text-[13px]" style={{ color: "#979393" }}>
          You haven&apos;t been added to any chat channels yet.
        </div>
      </div>
    );
  }

  // CRITICAL: filter internal messages — clients must never see them. Defense
  // in depth: the storage layer also blocks clients from posting internals,
  // and agency-only `internal: true` messages are hidden here at render time.
  const visible = (activeChannel.messages || []).filter((m) => !m.internal);

  return (
    <div className="flex" style={{ height: "calc(100vh - 64px)", background: "#212124" }}>
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{
          width: "220px",
          background: "#1A1A1C",
          borderRight: "1px solid #36363A",
        }}
      >
        <div className="px-4 pt-5 pb-3">
          <div className="text-[20px] font-bold" style={{ color: "#FFFFFF" }}>
            Chat
          </div>
        </div>
        <div className="px-2 mb-1">
          <div
            className="text-[12px] font-semibold uppercase tracking-wider px-2"
            style={{ color: "#979393" }}
          >
            Your channels
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-3">
          <div className="space-y-0.5">
            {channels.map((ch) => {
              const msgs = ch.messages || [];
              const unread = msgs.filter((m) => m.author !== clientSession.email && !m.internal).length;
              return (
                <ChannelRow
                  key={ch.id}
                  channel={ch}
                  isActive={activeChannelId === ch.id}
                  unread={unread}
                  mentions={0}
                  onClick={() => setActiveChannelId(ch.id)}
                />
              );
            })}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div
          className="flex items-center justify-between"
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid #36363A",
            background: "#212124",
            minHeight: "60px",
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: "36px",
                height: "36px",
                background: activeChannel.isClient ? "#108CE91A" : "#2C2C2F",
                border: `1px solid ${activeChannel.isClient ? "#108CE966" : "#36363A"}`,
                color: activeChannel.isClient ? "#7EC2F4" : "#979393",
                borderRadius: "8px",
              }}
            >
              {activeChannel.isClient ? (
                <Users size={16} strokeWidth={2.5} />
              ) : (
                <Hash size={16} strokeWidth={2.5} />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold truncate">{activeChannel.name}</div>
              <div className="text-[12px]" style={{ color: "#979393" }}>
                {(activeChannel.memberEmails || []).length} member
                {(activeChannel.memberEmails || []).length === 1 ? "" : "s"} ·{" "}
                {visible.length} message{visible.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <MembersAvatarStack
            emails={activeChannel.memberEmails || []}
            title={`${(activeChannel.memberEmails || []).length} members in this channel`}
          />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 dotted-grid">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div
                className="flex items-center justify-center mb-4"
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "16px",
                  background: "#108CE91A",
                  border: "1px solid #108CE944",
                }}
              >
                <MessageCircle
                  size={24}
                  style={{ color: "#7EC2F4" }}
                  strokeWidth={1.5}
                />
              </div>
              <div className="text-[15px] font-semibold mb-1">
                This is the start of #{activeChannel.name}
              </div>
              <div className="text-[12px] max-w-xs" style={{ color: "#979393" }}>
                Send a message to start the conversation.
              </div>
            </div>
          ) : (
            <div className="space-y-1 max-w-3xl mx-auto">
              {visible.map((msg, idx) => {
                const prev = visible[idx - 1];
                const sameAuthor =
                  prev && prev.author === msg.author && msg.ts - prev.ts < 5 * 60 * 1000;
                return (
                  <MessageRow
                    key={msg.id}
                    msg={msg}
                    sameAuthor={!!sameAuthor}
                    session={fakeSession}
                  />
                );
              })}
            </div>
          )}
        </div>

        <ChannelComposer
          channel={activeChannel}
          session={fakeSession}
          onSend={(text, mentions) => onSendChannelMessage(activeChannel.id, text, mentions)}
        />
      </main>
    </div>
  );
}
