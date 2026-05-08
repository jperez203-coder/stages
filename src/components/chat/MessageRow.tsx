"use client";

import { Lock } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { Message } from "@/types/stages";

type Props = {
  msg: Message;
  sameAuthor: boolean;
  session: { email: string };
};

export function MessageRow({ msg, sameAuthor, session }: Props) {
  const isMentioned = (msg.mentions || []).includes(session.email);
  const isInternal = !!msg.internal;

  const renderText = (text: string) => {
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const mentionedEmail = part.slice(1);
        const isMe =
          mentionedEmail === session.email ||
          mentionedEmail === session.email.split("@")[0];
        return (
          <span
            key={i}
            className="inline-block"
            style={{
              background: isMe ? "#E3F8FF" : "#108CE91A",
              color: isMe ? "#1264A3" : "#7EC2F4",
              border: isMe ? "none" : "1px solid #108CE944",
              borderRadius: "4px",
              padding: "1px 6px",
              fontWeight: 600,
              fontSize: "14px",
            }}
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  let bgColor = "transparent";
  let borderColor = "transparent";
  if (isInternal) {
    bgColor = "rgba(245,158,11,0.08)";
    borderColor = "#F59E0B";
  } else if (isMentioned) {
    bgColor = "rgba(16,140,233,0.06)";
    borderColor = "#108CE9";
  }

  return (
    <div
      className={`flex gap-3 ${sameAuthor ? "pl-[52px] py-0.5" : "py-2"} px-2 rounded-md group transition-colors`}
      style={{
        background: bgColor,
        borderLeft: `2px solid ${borderColor}`,
        marginLeft: borderColor !== "transparent" ? "-2px" : "0",
      }}
    >
      {!sameAuthor && <Avatar email={msg.author} size={10} shape="square" />}
      <div className="flex-1 min-w-0">
        {!sameAuthor && (
          <div className="flex items-baseline gap-2 mb-1 flex-wrap">
            <span className="text-[15px] font-bold" style={{ color: "#FFFFFF" }}>
              {msg.author.split("@")[0]}
            </span>
            <span className="text-[12px]" style={{ color: "#979393" }}>
              {new Date(msg.ts).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {isInternal && (
              <span
                className="inline-flex items-center gap-1 rounded-full"
                style={{
                  background: "#F59E0B22",
                  color: "#FBBF24",
                  border: "1px solid #F59E0B66",
                  padding: "1px 7px",
                  fontSize: "10px",
                  fontWeight: 600,
                }}
                title="Internal note — only your team can see this"
              >
                <Lock size={9} strokeWidth={2.5} /> Internal
              </span>
            )}
          </div>
        )}
        <div
          className="text-[15px] leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: "#E4E4E7" }}
        >
          {renderText(msg.text)}
        </div>
      </div>
    </div>
  );
}
