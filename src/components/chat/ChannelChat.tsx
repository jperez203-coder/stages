"use client";

import { useEffect, useRef } from "react";
import { Hash, MessageCircle, Users } from "lucide-react";
import { MessageRow } from "./MessageRow";
import { ChannelComposer } from "./ChannelComposer";
import { MembersAvatarStack } from "./MembersAvatarStack";
import type { Channel, Client } from "@/types/stages";

type Props = {
  channel: Channel;
  client: Client;
  session: { email: string; role: string };
  onSend: (text: string, mentions: string[], internal: boolean) => void;
  onShowMembers: () => void;
  onShowCreateChannel?: () => void;
};

export function ChannelChat({
  channel, client, session, onSend, onShowMembers, onShowCreateChannel,
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messages = channel.messages || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, channel.id]);

  const headerTitle = channel.isClient
    ? `${client.name.toLowerCase().replace(/\s+/g, "-")} (${client.company || "client"})`
    : channel.name;
  const headerSubtitle = channel.isClient
    ? `Client channel · ${messages.length} message${messages.length === 1 ? "" : "s"}`
    : `Team thread · ${messages.length} message${messages.length === 1 ? "" : "s"}`;

  return (
    <div className="flex-1 flex flex-col min-w-0">
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
              background: channel.isClient ? "#108CE91A" : "#2C2C2F",
              border: `1px solid ${channel.isClient ? "#108CE966" : "#36363A"}`,
              color: channel.isClient ? "#7EC2F4" : "#979393",
              borderRadius: "8px",
            }}
          >
            {channel.isClient ? (
              <Users size={16} strokeWidth={2.5} />
            ) : (
              <Hash size={16} strokeWidth={2.5} />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold truncate">{headerTitle}</div>
            <div className="text-[12px]" style={{ color: "#979393" }}>
              {headerSubtitle}
            </div>
          </div>
        </div>
        <MembersAvatarStack
          emails={channel.memberEmails || []}
          onClick={onShowMembers}
          title={`${(channel.memberEmails || []).length} members in this channel — click to manage`}
        />
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 dotted-grid">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div
              className="flex items-center justify-center mb-4"
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "16px",
                background: channel.isClient ? "#108CE91A" : "#2C2C2F",
                border: `1px solid ${channel.isClient ? "#108CE944" : "#36363A"}`,
              }}
            >
              {channel.isClient ? (
                <Users size={24} style={{ color: "#7EC2F4" }} strokeWidth={1.5} />
              ) : (
                <MessageCircle size={24} style={{ color: "#979393" }} strokeWidth={1.5} />
              )}
            </div>
            <div className="text-[15px] font-semibold mb-1">
              {channel.isClient
                ? `This is the start of #${channel.name}`
                : `Welcome to #${channel.name}`}
            </div>
            <div className="text-[12px] max-w-xs" style={{ color: "#979393" }}>
              {channel.isClient
                ? "Messages here are visible to your team and the client."
                : "Internal team channel — messages are not shared with the client."}
            </div>
          </div>
        ) : (
          <div className="space-y-1 max-w-3xl mx-auto">
            {messages.map((msg, idx) => {
              const prev = messages[idx - 1];
              const sameAuthor =
                prev && prev.author === msg.author && msg.ts - prev.ts < 5 * 60 * 1000;
              return (
                <MessageRow key={msg.id} msg={msg} sameAuthor={!!sameAuthor} session={session} />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <ChannelComposer
        channel={channel}
        session={session}
        onSend={onSend}
        onShowCreateChannel={onShowCreateChannel}
      />
    </div>
  );
}
