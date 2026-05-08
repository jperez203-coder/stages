"use client";

import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number | null;
  badgeColor?: string;
};

export function SidebarTabBtn({
  icon, label, active, onClick, badge, badgeColor = "#CE6A6C",
}: Props) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors"
      style={{
        background: active ? "#108CE9" : "transparent",
        color: active ? "#FFFFFF" : "#B2B2B2",
        border: "none",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: active ? 700 : 600,
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "#2C2C2F";
          e.currentTarget.style.color = "#E4E4E7";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "#B2B2B2";
        }
      }}
    >
      <span style={{ color: active ? "#FFFFFF" : "#979393" }}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge != null && badge > 0 && (
        <span
          className="rounded-full text-[11px] font-bold flex items-center justify-center"
          style={{
            background: badgeColor,
            color: "white",
            minWidth: "20px",
            height: "18px",
            padding: "0 6px",
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
