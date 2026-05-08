"use client";

import { UserPlus } from "lucide-react";

const COLORS = ["#3BA5EE", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#F43F5E"];

function colorFor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

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
          const color = colorFor(email);
          const initial = (email || "?").charAt(0).toUpperCase();
          return (
            <div
              key={email}
              className="rounded-md flex items-center justify-center font-semibold flex-shrink-0"
              style={{
                width: 24,
                height: 24,
                background: color + "33",
                color,
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
