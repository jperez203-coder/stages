"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * Date-picker popover for the My Tasks list view. Two layers:
 *
 *   Quick-set row (top)  — Today / Tomorrow / Next week / Clear
 *   Month calendar (bottom) — for specific picks
 *
 * Selecting any option writes the new deadline immediately via the
 * parent's `onSelect` callback and closes (no debounce — discrete picks).
 *
 * Popover behavior:
 *   * Anchored to its parent (TaskRow's pill button) via position
 *     absolute + the parent's position relative.
 *   * Closes on outside click, Esc key, or successful select.
 *   * Auto-flips to render above the anchor if the popover would
 *     extend past the viewport bottom.
 *
 * Calendar is hand-rolled (~one month at a time, no external dep). Day
 * cells are buttons; the selected date is highlighted in primary blue.
 */

type Props = {
  /** Current deadline (ISO string) or null. Used to highlight the
   *  initial month + selected date when opening. */
  currentDeadline: string | null;
  /** Called with the new deadline ISO (or null for Clear). The parent
   *  closes the popover after this fires. */
  onSelect: (deadline: string | null) => void;
  /** Called on outside click / Esc. Parent should set its open state to false. */
  onClose: () => void;
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function DatePickerPopover({
  currentDeadline,
  onSelect,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [flipUp, setFlipUp] = useState(false);

  // Visible month state — start at the current deadline's month if set,
  // else today's month.
  const initialDate = currentDeadline ? new Date(currentDeadline) : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  // Outside click + Esc to close.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
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
  }, [onClose]);

  // Flip-up check — runs once on mount. If the bottom of the popover
  // would extend past the viewport, render above the anchor instead.
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 16) {
      setFlipUp(true);
    }
  }, []);

  // ── Quick-set handlers ────────────────────────────────────────────────
  const setToday = () => {
    const d = new Date();
    // Use end-of-day local time so the deadline reads as "Today" through
    // 23:59 in the user's local TZ.
    d.setHours(23, 59, 59, 999);
    onSelect(d.toISOString());
  };

  const setTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 59, 999);
    onSelect(d.toISOString());
  };

  const setNextWeek = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(23, 59, 59, 999);
    onSelect(d.toISOString());
  };

  const clear = () => onSelect(null);

  // ── Calendar grid ─────────────────────────────────────────────────────
  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth), [
    viewYear,
    viewMonth,
  ]);

  const currentSelectedKey = currentDeadline
    ? dayKey(new Date(currentDeadline))
    : null;
  const todayKey = dayKey(new Date());

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );

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

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick a deadline"
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 z-50 fade-in"
      style={{
        [flipUp ? "bottom" : "top"]: "calc(100% + 8px)",
        width: 288,
        background: "#1A1A1A",
        border: "1px solid #36363A",
        borderRadius: 12,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        padding: 12,
      }}
    >
      {/* Quick-set row */}
      <div className="grid grid-cols-4 gap-1.5 mb-3">
        <QuickButton label="Today" onClick={setToday} />
        <QuickButton label="Tomorrow" onClick={setTomorrow} />
        <QuickButton label="Next week" onClick={setNextWeek} />
        <QuickButton label="Clear" onClick={clear} icon={<X size={11} />} />
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          className="flex items-center justify-center transition-colors"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
          }}
        >
          <ChevronLeft size={14} />
        </button>
        <span
          className="text-[13px] font-medium"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="flex items-center justify-center transition-colors"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.6)",
            cursor: "pointer",
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((label, idx) => (
          <span
            key={idx}
            className="text-[10px] text-center"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, idx) => {
          if (!cell) {
            return <span key={idx} aria-hidden />;
          }
          const key = dayKey(cell);
          const isSelected = key === currentSelectedKey;
          const isToday = key === todayKey;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => {
                const d = new Date(cell);
                d.setHours(23, 59, 59, 999);
                onSelect(d.toISOString());
              }}
              className="text-[12px] flex items-center justify-center transition-colors"
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: isSelected
                  ? "#108CE9"
                  : isToday
                    ? "rgba(16,140,233,0.12)"
                    : "transparent",
                color: isSelected
                  ? "white"
                  : isToday
                    ? "#7FA7D9"
                    : "rgba(255,255,255,0.8)",
                border: "none",
                cursor: "pointer",
                fontWeight: isSelected || isToday ? 600 : 400,
              }}
            >
              {cell.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Quick-set button ────────────────────────────────────────────────────

function QuickButton({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-1 text-[11px] font-medium transition-colors"
      style={{
        background: "rgba(255,255,255,0.05)",
        color: "rgba(255,255,255,0.85)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
        padding: "6px 4px",
        cursor: "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Calendar grid helpers ───────────────────────────────────────────────

/**
 * Builds a 6-row × 7-col grid for the given month. Cells before the first
 * day and after the last day are null (rendered as blank slots).
 */
function buildMonthCells(year: number, month: number): (Date | null)[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const firstWeekday = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = lastOfMonth.getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  // Pad to a multiple of 7 (typically up to 6 rows = 42 cells).
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Stable YYYY-MM-DD key for comparing two dates ignoring time-of-day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
