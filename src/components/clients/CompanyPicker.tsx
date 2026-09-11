"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import Link from "next/link";

/**
 * Searchable company picker — used by CreateClientModal's Company field.
 * Same viewport-aware flip-up positioning as ProjectPicker/
 * AssigneesPopover/etc. (see ProjectPicker's doc comment for why that
 * matters), plus a re-measure on query change since the filtered list's
 * height shifts as you type.
 *
 * Search-only, no inline "create new" — a Company IS a pipeline (see
 * 20260911120000's migration comment), and creating one is the full
 * name+emoji+template portal-creation flow at /w/[slug]/p/new, not
 * something to shortcut from inside this modal with just a name.
 */

export type CompanyOption = { id: string; name: string; emoji: string | null };

const POPOVER_WIDTH = 260;
const POPOVER_HEIGHT = 260;
const GAP = 6;
const VIEWPORT_PAD = 16;

export function CompanyPicker({
  anchor,
  companies,
  selectedId,
  slug,
  onSelectExisting,
  onClose,
}: {
  anchor: HTMLElement | null;
  companies: CompanyOption[];
  selectedId: string | null;
  slug: string;
  onSelectExisting: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [query, setQuery] = useState("");

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
    const raf = requestAnimationFrame(compute);
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [anchor]);

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

  const trimmed = query.trim();
  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(trimmed.toLowerCase()),
  );

  if (!position || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="listbox"
      aria-label="Select company"
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
          placeholder="Search companies…"
          className="text-[12px] outline-none flex-1"
          style={{ background: "transparent", border: "none", color: "#E4E4E7" }}
        />
      </div>

      <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectExisting(c.id)}
            className="w-full flex items-center gap-2 rounded text-left transition-colors"
            style={{ padding: "6px 8px", background: c.id === selectedId ? "#232326" : "transparent", border: "none", cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#26262A")}
            onMouseLeave={(e) => (e.currentTarget.style.background = c.id === selectedId ? "#232326" : "transparent")}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>{c.emoji ?? "📋"}</span>
            <span className="text-[13px] truncate" style={{ color: "#E4E4E7" }}>{c.name}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-[12px]" style={{ color: "#52525B", padding: "8px" }}>
            {companies.length === 0 ? (
              <>
                No companies yet.{" "}
                <Link href={`/w/${slug}/p/new`} className="underline" style={{ color: "#108CE9" }}>
                  Create a client portal
                </Link>{" "}
                first.
              </>
            ) : (
              "No matches."
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
