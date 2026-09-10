"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleDashed, Circle, Check } from "lucide-react";

/**
 * Status picker popover for the Task tab's Status cell (Figma V2).
 * Grouped Not started / Active / Closed sections, each with one status —
 * matches Figma's Notion-style status menu. "Complete" isn't part of the
 * `tasks.status` enum (which only has not_started/in_progress) — it maps
 * to the separate `tasks.done` boolean, same column the server-side query
 * already filters on (`.eq("done", false)`), so picking Complete here
 * removes the task from this not-done list, same as TaskListView's
 * documented "done tasks aren't part of this view" convention.
 *
 * Same portal + viewport-anchored positioning pattern as
 * DueDatePopover/PriorityPopover.
 */

export type StatusSelection = "not_started" | "in_progress" | "complete";

type Props = {
  anchor: HTMLElement | null;
  value: StatusSelection;
  onSelect: (selection: StatusSelection) => void;
  onClose: () => void;
};

const POPOVER_WIDTH = 190;
const POPOVER_HEIGHT = 260;
const GAP = 6;
const VIEWPORT_PAD = 16;

export function StatusPopover({ anchor, value, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) return;
    // POPOVER_HEIGHT is a rough upper-bound guess used only until the
    // popover has actually mounted once — its real content (3 short
    // sections) renders noticeably shorter, so the flip-up math below
    // re-measures the real height on the next pass and corrects `top`
    // rather than leaving a big unwanted gap above the trigger.
    const compute = () => {
      const a = anchor.getBoundingClientRect();
      const height = ref.current?.getBoundingClientRect().height ?? POPOVER_HEIGHT;
      const bottomIfBelow = a.bottom + GAP + height;
      const flipUp = bottomIfBelow > window.innerHeight - VIEWPORT_PAD;
      const top = flipUp ? Math.max(VIEWPORT_PAD, a.top - GAP - height) : a.bottom + GAP;
      const left = Math.min(a.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD);
      setPosition((prev) => {
        const next = { top, left: Math.max(VIEWPORT_PAD, left) };
        if (prev && prev.top === next.top && prev.left === next.left) return prev;
        return next;
      });
    };
    compute();
    // Re-measure once the popover has actually mounted (first pass above
    // runs before it exists, so it uses the POPOVER_HEIGHT guess) — this
    // second pass sees the real rendered height and corrects the flip-up
    // position if the guess was off.
    const raf = requestAnimationFrame(compute);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
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

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Set status"
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
      <Section
        heading="Not started"
        rows={[
          {
            key: "not_started",
            icon: <CircleDashed size={14} color="#71717A" />,
            label: "TO DO",
          },
        ]}
        value={value}
        onSelect={onSelect}
      />
      <Section
        heading="Active"
        rows={[
          {
            key: "in_progress",
            icon: <Circle size={14} color="#108CE9" fill="#108CE9" />,
            label: "IN PROGRESS",
          },
        ]}
        value={value}
        onSelect={onSelect}
      />
      <Section
        heading="Closed"
        rows={[
          {
            key: "complete",
            icon: <Circle size={14} color="#15B981" fill="#15B981" />,
            label: "COMPLETE",
          },
        ]}
        value={value}
        onSelect={onSelect}
        last
      />
    </div>,
    document.body,
  );
}

function Section({
  heading,
  rows,
  value,
  onSelect,
  last = false,
}: {
  heading: string;
  rows: { key: StatusSelection; icon: React.ReactNode; label: string }[];
  value: StatusSelection;
  onSelect: (selection: StatusSelection) => void;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "6px 8px",
        borderBottom: last ? "none" : "1px solid #2D2E30",
      }}
    >
      <div className="mb-1">
        <span className="text-[12px]" style={{ color: "#71717A" }}>
          {heading}
        </span>
      </div>
      {rows.map((row) => {
        const isSelected = row.key === value;
        return (
          <button
            key={row.key}
            type="button"
            onClick={() => onSelect(row.key)}
            className="flex items-center gap-2 w-full transition-colors"
            style={{
              background: "transparent",
              border: "none",
              borderRadius: 6,
              padding: "4px 4px",
              cursor: "pointer",
              textAlign: "left",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {row.icon}
            <span
              className="text-[12px] tracking-wide"
              style={{
                color: isSelected ? "#F4F4F5" : "#A1A1AA",
                fontWeight: isSelected ? 600 : 500,
                flex: 1,
              }}
            >
              {row.label}
            </span>
            {isSelected && <Check size={14} color="#F4F4F5" />}
          </button>
        );
      })}
    </div>
  );
}
