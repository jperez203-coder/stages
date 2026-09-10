"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

/**
 * Shared project/pipeline picker popover — a searchable dropdown listing
 * every real project in the workspace (the hidden "Unassigned" system
 * pipeline is never included; callers pass an already-filtered list, same
 * as tasks/page.tsx's taskCreatablePipelines). Used by CreateTaskModal's
 * "Select Project" button and by TaskListView's Pipeline table cell (both
 * per Jordan: "input the same exact project opened module thats in the
 * task module to select a project/pipeline").
 *
 * Positioning follows the same viewport-aware, flip-up-when-near-the-
 * bottom-edge pattern as DueDatePopover/PriorityPopover/StatusPopover/
 * AssigneesPopover — without it, opening this from a row near the bottom
 * of the table (or the viewport) rendered the list off-screen with
 * nothing visible to click.
 */

export type ProjectPickerPipeline = {
  id: string;
  name: string;
  emoji: string | null;
  defaultStageId: string | null;
};

const POPOVER_WIDTH = 260;
const POPOVER_HEIGHT = 300;
const GAP = 6;
const VIEWPORT_PAD = 16;

export function ProjectPicker({
  anchor,
  pipelines,
  selectedId,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement | null;
  pipelines: ProjectPickerPipeline[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [query, setQuery] = useState("");

  // POPOVER_HEIGHT is a rough upper bound (maxHeight on the popover
  // itself) — actual height is usually much shorter (few projects, or a
  // short search result), so `compute` prefers the real measured height
  // once the popover has mounted, correcting the flip-up `top` rather
  // than leaving a big unwanted gap above the trigger.
  useLayoutEffect(() => {
    if (!anchor) return;
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
    // Re-measure once mounted (first pass runs before the popover exists,
    // so it uses the POPOVER_HEIGHT guess) — this sees the real rendered
    // height and corrects the flip-up position if the guess was off.
    const raf = requestAnimationFrame(compute);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchor]);

  // The list's height changes as the search query filters it — re-run the
  // same measurement so a flipped-up popover stays snug against the
  // trigger instead of drifting as content shrinks/grows.
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const height = ref.current.getBoundingClientRect().height;
    const bottomIfBelow = a.bottom + GAP + height;
    const flipUp = bottomIfBelow > window.innerHeight - VIEWPORT_PAD;
    const top = flipUp ? Math.max(VIEWPORT_PAD, a.top - GAP - height) : a.bottom + GAP;
    const left = Math.max(VIEWPORT_PAD, Math.min(a.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_PAD));
    setPosition((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

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

  const filtered = pipelines.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="listbox"
      aria-label="Select project"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className="fade-in"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        zIndex: 60,
        width: POPOVER_WIDTH,
        maxHeight: POPOVER_HEIGHT,
        display: "flex",
        flexDirection: "column",
        background: "#18181B",
        border: "1px solid #2D2E30",
        borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        padding: 8,
      }}
    >
      <div
        className="flex items-center gap-2"
        style={{
          height: 32,
          padding: "0 10px",
          background: "#212124",
          border: "1px solid #2D2E30",
          borderRadius: 8,
          marginBottom: 8,
          flexShrink: 0,
        }}
      >
        <Search size={13} color="#71717A" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="text-[12px] outline-none flex-1"
          style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
        />
      </div>

      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {filtered.length === 0 && (
          <div className="text-[12px]" style={{ color: "#52525B", padding: "8px" }}>
            {pipelines.length === 0 ? "No projects yet." : "No matches."}
          </div>
        )}
        {filtered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className="w-full flex items-center gap-2 rounded text-left transition-colors"
            style={{ padding: "6px 8px", background: p.id === selectedId ? "#232326" : "transparent", border: "none", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
            onMouseLeave={(e) => (e.currentTarget.style.background = p.id === selectedId ? "#232326" : "transparent")}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{p.emoji ?? "📋"}</span>
            <span className="text-[13px] truncate" style={{ color: "#E4E4E7" }}>{p.name}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
