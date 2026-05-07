"use client";

import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { pickColor } from "@/lib/constants";

type Props = {
  title: string;
  description: string;
  icon?: ReactNode;
  emoji?: string;
  stages: string[];
  selected: boolean;
  onClick: () => void;
  onDelete?: () => void;
};

export function TemplateCard({
  title, description, icon, emoji, stages, selected, onClick, onDelete,
}: Props) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className="text-left p-4 rounded-lg transition-all w-full"
        style={{
          background: selected ? "#36363A" : "#2C2C2F",
          border: `1px solid ${selected ? "#108CE9" : "#36363A"}`,
          boxShadow: selected ? "0 0 0 3px rgba(16,140,233,0.15)" : "none",
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          {emoji ? <span className="text-xl">{emoji}</span> : icon}
          <div className="text-[14px] font-semibold">{title}</div>
        </div>
        <div className="text-[12px] text-zinc-500 leading-relaxed mb-3 min-h-[32px]">{description}</div>
        <div className="flex items-center gap-1 flex-wrap">
          {stages.slice(0, 4).map((s, i) => (
            <span
              key={i}
              className="text-[10px] px-2 py-0.5 rounded-full"
              style={{
                background: pickColor(i) + "22",
                color: pickColor(i),
                border: `1px solid ${pickColor(i)}33`,
              }}
            >
              {s}
            </span>
          ))}
          {stages.length > 4 && (
            <span className="text-[10px] text-zinc-500">+{stages.length - 4} more</span>
          )}
        </div>
      </button>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded"
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid #36363A",
            color: "#979393",
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#F87171")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#979393")}
          title="Delete template"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
