"use client";

import { UserPlus } from "lucide-react";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";

/**
 * PI-7: local COLORS palette + colorFor() retired; this surface now
 * uses the centralized helper. One palette source-of-truth across all
 * avatar render sites.
 *
 * CAVEAT — cross-surface drift on this surface only:
 * The chat thread layer hands us `emails: string[]`, not user_ids. The
 * helper's input contract is "always user_id" because user_id is stable
 * across email changes. Feeding email in still produces a deterministic
 * color, but a user appearing here (hashed by email) will land in a
 * different slot than the same user appearing on surfaces hashed by
 * user_id (UserAvatar, HeaderProfileMenu, MembersBody, ClientsBody,
 * settings/team). Closing the drift requires threading user_ids through
 * the chat-thread API to this component — a separate refactor.
 */

type Props = {
  emails: string[];
  maxVisible?: number;
  onClick?: () => void;
  title?: string;
};

export function MembersAvatarStack({ emails, maxVisible = 3, onClick, title }: Props) {
  const visible = emails.slice(0, maxVisible);
  const overflow = emails.length - visible.length;

  return (
    <div
      onClick={onClick}
      className="inline-flex items-center gap-1.5 transition-colors flex-shrink-0"
      style={{
        background: "#121212",
        border: "1px solid #36363A",
        borderRadius: "8px",
        padding: "0 10px 0 5px",
        height: "36px",
        cursor: onClick ? "pointer" : "default",
      }}
      title={title || "Click to manage members"}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.background = "#1A1A1C";
      }}
      onMouseLeave={(e) => {
        if (onClick) e.currentTarget.style.background = "#121212";
      }}
    >
      <div className="flex -space-x-1.5">
        {visible.map((email) => {
          const { text, bg } = getAvatarColorFromUserId(email);
          const initial = (email || "?").charAt(0).toUpperCase();
          return (
            <div
              key={email}
              className="rounded-md flex items-center justify-center font-semibold flex-shrink-0"
              style={{
                width: 24,
                height: 24,
                background: bg,
                color: text,
                border: "2px solid #121212",
                fontSize: 10,
              }}
              title={email}
            >
              {initial}
            </div>
          );
        })}
      </div>
      {overflow > 0 ? (
        <span className="text-[12px] font-semibold" style={{ color: "#E4E4E7" }}>
          +{overflow}
        </span>
      ) : (
        <UserPlus size={12} strokeWidth={2.5} style={{ color: "#979393" }} />
      )}
    </div>
  );
}
