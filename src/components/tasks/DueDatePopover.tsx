"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronUp, ChevronDown } from "lucide-react";

/**
 * Due-date calendar popover for the Task tab's Due date cell (Figma V2).
 * Distinct from src/components/my-tasks/DatePickerPopover.tsx (quick-set
 * row + blue-selected calendar) — this one matches the newer Figma spec:
 * a "Due date" field header inside the popover, Today/month-nav chevrons
 * (up/down, not left/right) next to the month label, and today's cell
 * always shown with a red-filled circle regardless of selection.
 *
 * Portal + position:fixed for the same reason as DatePickerPopover: the
 * Task tab's table rows aren't overflow-clipped today, but anchoring via
 * viewport rect keeps this correct if that ever changes, and avoids
 * z-index fights with sticky table headers.
 */

type Props = {
  anchor: HTMLElement | null;
  value: string | null;
  onSelect: (deadline: string | null) => void;
  onClose: () => void;
};

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const POPOVER_WIDTH = 240;
const POPOVER_HEIGHT = 320;
const GAP = 6;
const VIEWPORT_PAD = 16;

export function DueDatePopover({ anchor, value, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const initialDate = value ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

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

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth), [viewYear, viewMonth]);

  const selectedKey = value ? dayKey(new Date(value)) : null;
  const todayKey = dayKey(new Date());

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const goToToday = () => {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
  };

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const pickDay = (d: Date) => {
    const picked = new Date(d);
    picked.setHours(23, 59, 59, 999);
    onSelect(picked.toISOString());
  };

  if (!position || typeof document === "undefined") return null;

  const fieldLabel = value
    ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "Due date";

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick a due date"
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
        padding: 10,
      }}
    >
      {/* Field header */}
      <div
        className="flex items-center gap-2 mb-3"
        style={{
          height: 34,
          padding: "0 10px",
          background: "#212124",
          border: "1px solid #2D2E30",
          borderRadius: 8,
        }}
      >
        <Calendar size={14} color="#71717A" />
        <span className="text-[12px]" style={{ color: value ? "#E4E4E7" : "#52525B" }}>
          {fieldLabel}
        </span>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-2 px-0.5">
        <span className="text-[13px] font-medium" style={{ color: "#E4E4E7" }}>
          {monthLabel}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goToToday}
            className="text-[12px] transition-colors"
            style={{ background: "transparent", border: "none", color: "#71717A", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
          >
            Today
          </button>
          <div className="flex flex-col" style={{ gap: 1 }}>
            <button
              type="button"
              onClick={prevMonth}
              aria-label="Previous month"
              className="flex items-center justify-center transition-colors"
              style={{ width: 16, height: 11, background: "transparent", border: "none", color: "#71717A", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
            >
              <ChevronUp size={12} />
            </button>
            <button
              type="button"
              onClick={nextMonth}
              aria-label="Next month"
              className="flex items-center justify-center transition-colors"
              style={{ width: 16, height: 11, background: "transparent", border: "none", color: "#71717A", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
            >
              <ChevronDown size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} className="text-[10px] text-center" style={{ color: "#52525B" }}>
            {label}
          </span>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7" style={{ rowGap: 2 }}>
        {cells.map(({ date, inMonth }, idx) => {
          const key = dayKey(date);
          const isSelected = key === selectedKey;
          const isToday = key === todayKey;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => pickDay(date)}
              className="text-[12px] flex items-center justify-center transition-colors"
              style={{
                width: 28,
                height: 28,
                margin: "0 auto",
                borderRadius: "50%",
                background: isSelected ? "#108CE9" : isToday ? "#F43F5E" : "transparent",
                color: isSelected || isToday ? "#FFFFFF" : inMonth ? "#D4D4D8" : "#3A3A3E",
                border: "none",
                cursor: "pointer",
                fontWeight: isSelected || isToday ? 600 : 400,
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

function buildMonthCells(year: number, month: number): { date: Date; inMonth: boolean }[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const firstWeekday = firstOfMonth.getDay();
  const daysInMonth = lastOfMonth.getDate();
  const prevMonthLastDate = new Date(year, month, 0).getDate();

  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, prevMonthLastDate - i), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), inMonth: true });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0 || cells.length < 42) {
    cells.push({ date: new Date(year, month + 1, nextDay), inMonth: false });
    nextDay += 1;
    if (cells.length >= 42) break;
  }
  return cells;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
