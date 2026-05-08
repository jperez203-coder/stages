"use client";

import { Hash, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { timeAgo } from "@/lib/format";
import type { Channel, Message } from "@/types/stages";

type Props = {
  items: { channel: Channel; messages: Message[] }[];
  onOpenChannel: (channelId: string) => void;
};

export function UnreadView({ items, onOpenChannel }: Props) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-[18px] font-semibold mb-1">Unread</h2>
        <p className="text-[13px] mb-5" style={{ color: "#979393" }}>
          Recent messages from your channels.
        </p>
        {items.length === 0 ? (
          <div
            className="text-center py-12 rounded-lg"
            style={{ background: "#2C2C2F", border: "1px dashed #36363A", color: "#979393" }}
          >
            All caught up — nothing new to read.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(({ channel, messages }) => (
              <div
                key={channel.id}
                className="rounded-lg overflow-hidden cursor-pointer transition-colors"
                style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
                onClick={() => onOpenChannel(channel.id)}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A4A50")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#36363A")}
              >
                <div
                  className="flex items-center gap-2 px-4 py-2.5"
                  style={{ background: "#1A1A1C", borderBottom: "1px solid #36363A" }}
                >
                  {channel.isClient ? (
                    <Users size={13} style={{ color: "#7EC2F4" }} />
                  ) : (
                    <Hash size={13} style={{ color: "#979393" }} />
                  )}
                  <span className="text-[13px] font-semibold">{channel.name}</span>
                  <span className="text-[11px] ml-auto" style={{ color: "#979393" }}>
                    {messages.length} new
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  {messages.map((m) => (
                    <div key={m.id} className="flex gap-2">
                      <Avatar email={m.author} size={6} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold">
                          {m.author.split("@")[0]}{" "}
                          <span className="font-normal" style={{ color: "#979393" }}>
                            · {timeAgo(m.ts)}
                          </span>
                        </div>
                        <div className="text-[13px] line-clamp-2" style={{ color: "#E4E4E7" }}>
                          {m.text}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
