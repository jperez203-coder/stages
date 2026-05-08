"use client";

import { Hash, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { timeAgo } from "@/lib/format";
import type { Message } from "@/types/stages";

type ThreadItem = Message & { channelId: string; channelName: string; isClient: boolean };

type Props = {
  items: ThreadItem[];
  onOpenChannel: (channelId: string) => void;
};

export function ThreadsView({ items, onOpenChannel }: Props) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-[18px] font-semibold mb-1">Threads</h2>
        <p className="text-[13px] mb-5" style={{ color: "#979393" }}>
          Messages where you were @mentioned.
        </p>
        {items.length === 0 ? (
          <div
            className="text-center py-12 rounded-lg"
            style={{ background: "#2C2C2F", border: "1px dashed #36363A", color: "#979393" }}
          >
            No mentions yet — when someone @s you, they&apos;ll appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((m) => (
              <div
                key={m.id}
                onClick={() => onOpenChannel(m.channelId)}
                className="rounded-lg p-3 cursor-pointer transition-colors flex gap-3"
                style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A4A50")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#36363A")}
              >
                <Avatar email={m.author} size={7} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[13px] font-bold">{m.author.split("@")[0]}</span>
                    <span className="text-[11px]" style={{ color: "#979393" }}>
                      mentioned you in
                    </span>
                    <span
                      className="text-[12px] inline-flex items-center gap-1"
                      style={{ color: "#7EC2F4" }}
                    >
                      {m.isClient ? <Users size={11} /> : <Hash size={11} />}
                      {m.channelName}
                    </span>
                    <span className="text-[11px] ml-auto" style={{ color: "#979393" }}>
                      {timeAgo(m.ts)}
                    </span>
                  </div>
                  <div
                    className="text-[13px] mt-1 leading-relaxed line-clamp-3"
                    style={{ color: "#E4E4E7" }}
                  >
                    {m.text}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
