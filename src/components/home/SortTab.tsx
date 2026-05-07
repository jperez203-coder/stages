"use client";

import { ChevronDown } from "lucide-react";

type Props = {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
};

export function SortTab({ label, active, direction, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors text-[13px]"
      style={{
        background: active ? "#2C2C2F" : "transparent",
        color: active ? "#E4E4E7" : "#979393",
        border: active ? "1px solid #36363A" : "1px solid transparent",
        cursor: "pointer",
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "#E4E4E7"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "#979393"; }}
    >
      {label}
      {active && (
        <ChevronDown
          size={12}
          style={{
            transform: direction === "asc" ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      )}
    </button>
  );
}
