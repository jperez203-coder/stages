"use client";

import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  count?: number;
  dot?: boolean;
};

export function ToolBtn({ icon, label, active, onClick, count, dot }: Props) {
  return (
    <button
      title={label}
      onClick={onClick}
      className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors relative"
      style={{
        background: active ? "#2C2C2F" : "transparent",
        color: active ? "#E4E4E7" : "#71717A",
        border: active ? "1px solid #36363A" : "1px solid transparent",
        cursor: "pointer",
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
          e.currentTarget.style.color = "#71717A";
        }
      }}
    >
      {icon}
      {dot && (
        <span
          className="absolute top-1 right-1 w-2 h-2 rounded-full pulse-dot"
          style={{ background: "#F43F5E" }}
        />
      )}
      {!dot && count !== undefined && count > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-semibold flex items-center justify-center"
          style={{ background: "#36363A", color: "#A1A1AA", border: "1px solid #1A1A1C" }}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}
