"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * Positioning:
 *   * Rendered via React Portal into document.body so it escapes any
 *     ancestor's overflow:hidden + stacking context. The /my-tasks
 *     bucket sections use `rounded-xl overflow-hidden` to clip TaskRow
 *     hover tints to the rounded card corners — that overflow:hidden
 *     also clips an absolutely-positioned popover, which was the bug:
 *     the picker was invisible (clipped) for rows near the section's
 *     bottom edge. Portal + position:fixed sidesteps that entirely.
 *   * Position is calculated from the anchor button's viewport rect
 *     (passed in via the `anchor` prop). Re-runs on scroll/resize so
 *     the popover stays glued to the anchor while the page moves.
 *   * Auto-flips above the anchor when there isn't enough room below
 *     the viewport bottom (same intent as before, now with a real
 *     viewport-vs-fixed-rect calculation instead of after-the-fact
 *     measurement).
 *
 * Close behavior:
 *   * Outside click — except clicks on the anchor itself (which has its
 *     own toggle handler; double-handling would close+reopen on the
 *     same click and net to "stays open").
 *   * Esc key.
 *   * Successful select.
 *
 * Calendar is hand-rolled (~one month at a time, no external dep). Day
 * cells are buttons; the selected date is highlighted in primary blue.
 */

type Props = {
  /** The button element the popover should attach to. Required — the
   *  popover renders via portal and needs the anchor to compute its
   *  viewport-fixed position. May be null briefly while the parent
   *  resolves its own ref; the popover renders null until set. */
  anchor: HTMLElement | null;
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

// Approximate popover dimensions for the flip-up calculation. The actual
// rendered popover may be a few pixels off depending on font metrics, but
// the calculation only needs to decide DOWN vs UP — small drift is fine.
const POPOVER_HEIGHT = 360;
const POPOVER_WIDTH = 288;
const GAP = 8;
const VIEWPORT_PAD = 16;

export function DatePickerPopover({
  anchor,
  currentDeadline,
  onSelect,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);

  // Visible month state — start at the current deadline's month if set,
  // else today's month.
  const initialDate = currentDeadline ? new Date(currentDeadline) : new Date();
  const [viewYear, setViewYear] = useState(initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialDate.getMonth());

  // ── Position computation (anchor-relative, viewport-fixed) ────────────
  useLayoutEffect(() => {
    if (!anchor) return;
    const compute = () => {
      const a = anchor.getBoundingClientRect();
      const bottomIfBelow = a.bottom + GAP + POPOVER_HEIGHT;
      const flipUp = bottomIfBelow > window.innerHeight - VIEWPORT_PAD;
      const top = flipUp
        ? Math.max(VIEWPORT_PAD, a.top - GAP - POPOVER_HEIGHT)
        : a.bottom + GAP;
      // Anchor to the right edge of the anchor button so the popover
      // hangs off the same side regardless of viewport width. This
      // mirrors the previous `right: 0` behavior, just calculated as
      // a viewport offset for position:fixed.
      const right = Math.max(
        VIEWPORT_PAD,
        window.innerWidth - a.right,
      );
      setPosition({ top, right });
    };
    compute();
    // Re-anchor on scroll (anywhere in the page, including the bucket
    // sections that scroll independently) + window resize. The `true`
    // third arg is critical — captures scrolls on ANY scrollable
    // ancestor, not just window.
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchor]);

  // ── Outside click + Esc to close ──────────────────────────────────────
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      // Clicks on the anchor button are handled by the anchor's own
      // toggle — if we ALSO closed here, the close-then-toggle race
      // would net to "stays open" and the user couldn't close via the
      // button. Skipping anchor-targeted mousedowns lets the anchor's
      // setPickerOpen(v => !v) handle the close cleanly.
      if (anchor && anchor.contains(e.target as Node)) return;
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
  }, [anchor, onClose]);

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

  // Don't render until we have a position. SSR-safe portal target.
  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick a deadline"
      onClick={(e) => e.stopPropagation()}
      className="fade-in"
      style={{
        position: "fixed",
        top: position.top,
        right: position.right,
        zIndex: 60,
        width: POPOVER_WIDTH,
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
    </div>,
    document.body,
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
