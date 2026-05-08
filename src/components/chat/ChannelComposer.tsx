"use client";

import { useRef, useState } from "react";
import { ExternalLink, Lock, Send } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import type { Channel } from "@/types/stages";

type Props = {
  channel: Channel;
  session: { email: string; role: string };
  onSend: (text: string, mentions: string[], internal: boolean) => void;
  onShowCreateChannel?: () => void;
};

export function ChannelComposer({ channel, session, onSend, onShowCreateChannel }: Props) {
  const [text, setText] = useState("");
  const [mentionState, setMentionState] = useState<{ query: string; startIdx: number } | null>(null);
  const [isInternal, setIsInternal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const availableMentions = (channel.memberEmails || []).filter((e) => e !== session.email);
  const filteredMentions = mentionState
    ? availableMentions.filter((e) =>
        e.toLowerCase().includes(mentionState.query.toLowerCase()),
      )
    : [];

  // Internal-note toggle: only on client channels, only for agency-side users.
  const isClientUser = session.role === "client";
  const showInternalToggle = channel.isClient && !isClientUser;

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    const cursor = e.target.selectionStart;
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/@(\S*)$/);
    if (match) {
      setMentionState({ query: match[1], startIdx: cursor - match[0].length });
    } else {
      setMentionState(null);
    }
  };

  const insertMention = (email: string) => {
    if (!mentionState) return;
    const before = text.slice(0, mentionState.startIdx);
    const after = text.slice(mentionState.startIdx + mentionState.query.length + 1);
    const next = `${before}@${email} ${after}`;
    setText(next);
    setMentionState(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const submit = () => {
    if (!text.trim()) return;
    const mentions = Array.from(text.matchAll(/@(\S+)/g))
      .map((m) => m[1])
      .filter((m) => availableMentions.includes(m));
    onSend(text, mentions, isInternal);
    setText("");
    setMentionState(null);
    // Reset to public after each send so nobody accidentally posts internal twice.
    setIsInternal(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionState && filteredMentions.length > 0) {
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredMentions[0]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = isInternal
    ? "Internal note — only your team will see this…"
    : channel.isClient
      ? `Message #${channel.name} (visible to client)…`
      : `Message #${channel.name}…`;

  const composerBg = isInternal ? "#3A2B14" : "#1A1A1C";
  const composerBorder = isInternal ? "#F59E0B66" : "#36363A";

  return (
    <div style={{ padding: "10px 16px", background: "transparent" }}>
      <div className="max-w-3xl mx-auto">
        {channel.isClient && !isClientUser && !isInternal && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg text-[12px]"
            style={{
              background: "#108CE91A",
              border: "1px solid #108CE944",
              color: "#7EC2F4",
            }}
          >
            <span className="flex-1 font-medium">
              Your client will see this message. For team only conversations use or create a channel.
            </span>
            {onShowCreateChannel && (
              <button
                onClick={onShowCreateChannel}
                className="flex items-center justify-center transition-colors flex-shrink-0"
                style={{
                  background: "transparent",
                  color: "#7EC2F4",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px",
                  borderRadius: "4px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#108CE933";
                  e.currentTarget.style.color = "#FFFFFF";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#7EC2F4";
                }}
                title="Create a team channel"
              >
                <ExternalLink size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
        )}
        {isInternal && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-lg text-[12px]"
            style={{
              background: "#F59E0B1A",
              border: "1px solid #F59E0B66",
              color: "#FBBF24",
            }}
          >
            <Lock size={12} strokeWidth={2.5} />
            <span className="flex-1 font-medium">Internal note — your client will not see this.</span>
          </div>
        )}

        <div
          className="relative transition-colors"
          style={{
            background: composerBg,
            border: `1px solid ${composerBorder}`,
            borderRadius: "10px",
            padding: showInternalToggle ? "8px 10px 38px 10px" : "8px 10px 32px 10px",
            minHeight: "76px",
          }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={2}
            className="w-full resize-none"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#E4E4E7",
              fontSize: "15px",
              lineHeight: 1.55,
              minHeight: "40px",
              fontFamily: "inherit",
            }}
          />

          {mentionState && filteredMentions.length > 0 && (
            <div
              className="absolute fade-in"
              style={{
                bottom: "100%",
                left: 0,
                marginBottom: "8px",
                background: "#1A1A1C",
                border: "1px solid #36363A",
                borderRadius: "10px",
                boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                width: "260px",
                padding: "4px",
                zIndex: 10,
              }}
            >
              <div
                className="text-[11px] uppercase tracking-wider px-2 py-1.5"
                style={{ color: "#979393" }}
              >
                People in this channel
              </div>
              {filteredMentions.slice(0, 6).map((email, idx) => (
                <button
                  key={email}
                  onClick={() => insertMention(email)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors text-left"
                  style={{
                    background: idx === 0 ? "#2C2C2F" : "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#2C2C2F")}
                  onMouseLeave={(e) => {
                    if (idx !== 0) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Avatar email={email} size={5} />
                  <span className="text-[13px]" style={{ color: "#E4E4E7" }}>
                    {email}
                  </span>
                </button>
              ))}
            </div>
          )}

          {showInternalToggle && (
            <button
              onClick={() => setIsInternal(!isInternal)}
              className="absolute flex items-center gap-1 transition-colors"
              style={{
                left: "8px",
                bottom: "8px",
                background: isInternal ? "#F59E0B22" : "transparent",
                color: isInternal ? "#FBBF24" : "#979393",
                border: `1px solid ${isInternal ? "#F59E0B66" : "#36363A"}`,
                padding: "3px 8px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "6px",
                cursor: "pointer",
              }}
              title={
                isInternal
                  ? "Switch back to client-visible message"
                  : "Switch to internal note (client will not see)"
              }
              onMouseEnter={(e) => {
                if (!isInternal) {
                  e.currentTarget.style.background = "#2C2C2F";
                  e.currentTarget.style.color = "#E4E4E7";
                }
              }}
              onMouseLeave={(e) => {
                if (!isInternal) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#979393";
                }
              }}
            >
              <Lock size={11} />
              <span>{isInternal ? "Internal note" : "Reply"}</span>
            </button>
          )}

          <button
            onClick={submit}
            disabled={!text.trim()}
            className="absolute flex items-center justify-center transition-colors"
            style={{
              right: "8px",
              bottom: "8px",
              width: "26px",
              height: "26px",
              background: text.trim() ? (isInternal ? "#F59E0B" : "#108CE9") : "#2C2C2F",
              color: text.trim() ? "#FFFFFF" : "#71717A",
              border: "none",
              borderRadius: "6px",
              cursor: text.trim() ? "pointer" : "default",
            }}
            onMouseEnter={(e) => {
              if (text.trim()) e.currentTarget.style.background = isInternal ? "#D88806" : "#0E7DD1";
            }}
            onMouseLeave={(e) => {
              if (text.trim()) e.currentTarget.style.background = isInternal ? "#F59E0B" : "#108CE9";
            }}
            title={isInternal ? "Send internal note (Enter)" : "Send (Enter)"}
          >
            <Send size={12} strokeWidth={2.5} />
          </button>
        </div>
        <div className="text-[12px] mt-2 px-1" style={{ color: "#979393" }}>
          Posting as <span style={{ color: "#E4E4E7" }}>{session.email}</span> · Press Enter to send
        </div>
      </div>
    </div>
  );
}
