"use client";

import { Hash, Users } from "lucide-react";
import type { Channel } from "@/types/stages";

type Props = {
  channel: Channel;
  isActive: boolean;
  unread: number;
  mentions: number;
  onClick: () => void;
};

export function ChannelRow({ channel, isActive, unread, mentions, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
      style={{
        background: isActive ? "#108CE9" : "transparent",
        color: isActive ? "#FFFFFF" : unread > 0 ? "#FFFFFF" : "#979393",
        border: "none",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: isActive ? 600 : unread > 0 ? 600 : 500,
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "#2C2C2F";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      {channel.isClient ? (
        <Users
          size={14}
          strokeWidth={2.5}
          style={{ color: isActive ? "#FFFFFF" : "#979393", flexShrink: 0 }}
        />
      ) : (
        <Hash
          size={14}
          strokeWidth={2.5}
          style={{ color: isActive ? "#FFFFFF" : "#979393", flexShrink: 0 }}
        />
      )}
      <span className="flex-1 text-left truncate">{channel.name}</span>
      {mentions > 0 && !isActive && (
        <span
          className="rounded-full text-[11px] font-bold flex items-center justify-center"
          style={{
            background: "#CE6A6C",
            color: "white",
            minWidth: "20px",
            height: "18px",
            padding: "0 6px",
          }}
          title={`${mentions} mention${mentions > 1 ? "s" : ""}`}
        >
          @{mentions}
        </span>
      )}
    </button>
  );
}
