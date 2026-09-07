"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Flag, Ban } from "lucide-react";
import type { TaskRow } from "@/components/tasks/types";

/**
 * Priority picker popover for the Task tab's Priority cell (Figma V2).
 * Same portal + viewport-anchored positioning pattern as
 * DueDatePopover — see that file for the rationale.
 */

type Priority = NonNullable<TaskRow["priority"]>;

const OPTIONS: { key: Priority; label: string; color: string }[] = [
  { key: "urgent", label: "Urgent", color: "#F43F5E" },
  { key: "high", label: "High", color: "#F59E0B" },
  { key: "normal", label: "Normal", color: "#108CE9" },
  { key: "low", label: "Low", color: "#71717A" },
];

type Props = {
  anchor: HTMLElement | null;
  value: TaskRow["priority"];
  onSelect: (priority: TaskRow["priority"]) => void;
  onClose: () => void;
};

const POPOVER_WIDTH = 180;
const POPOVER_HEIGHT = 220;
const GAP = 6;
const VIEWPORT_PAD = 16;

export function PriorityPopover({ anchor, value, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    const compute = () => {
      const a = anchor.getBoundingClientRect();
      const bottomIfBelow = a.bottom + GAP + POPOVER_HEIGHT;
      const flipUp = bottomIfBelow > window.innerHeight - VIEWPORT_PAD;
      const top = flipUp ? Math.max(VIEWPORT_PAD, a.top - GAP - POPOVER_HEIGHT) : a.bottom + GAP;
      const left = Math.min(a.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD);
      setPosition({ top, left: Math.max(VIEWPORT_PAD, left) });
    };
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchor]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (anchor && anchor.contains(e.target as Node)) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  if (!position || typeof document === "undefined") return null;

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
    color: "#E4E4E7",
    fontSize: 13,
    textAlign: "left",
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Set priority"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fade-in"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 60,
        width: POPOVER_WIDTH,
        background: "#18181B",
        border: "1px solid #2D2E30",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        padding: "8px 6px",
      }}
    >
      <div className="text-[12px] mb-1" style={{ color: "#71717A", padding: "2px 8px" }}>
        Priority
      </div>

      {OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onSelect(opt.key)}
          style={{
            ...rowStyle,
            background: value === opt.key ? "#26262A" : "transparent",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
          onMouseLeave={(e) => (e.currentTarget.style.background = value === opt.key ? "#26262A" : "transparent")}
        >
          <Flag size={13} color={opt.color} fill={opt.color} />
          {opt.label}
        </button>
      ))}

      <button
        type="button"
        onClick={() => onSelect(null)}
        style={rowStyle}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <Ban size={13} color="#71717A" />
        Clear
      </button>
    </div>,
    document.body,
  );
}
