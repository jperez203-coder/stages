"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

/**
 * Global header search bar. Wires the placeholder that lived in
 * AppShell since Phase 4a into a real interactive input with a
 * dropdown of pipeline matches.
 *
 * v1 scope (intentionally narrow):
 *   * Searches pipeline NAME + COMPANY only. Honors the existing
 *     "by name or company…" copy. No task / file / message search.
 *   * Active workspace only (no cross-workspace yet).
 *   * Client-side filter on a pre-fetched list — no per-keystroke
 *     DB query. Pipeline counts for an agency are in the low-double
 *     digits; an in-memory `String.includes` is trivially fast.
 *     Switching to a debounced PostgREST `ilike` is a swap-out for
 *     Phase 6+ if scale ever warrants it.
 *   * ⌘K / Ctrl+K focuses the input from anywhere (the public
 *     commitment from the prior placeholder's reserved hint badge).
 *   * Click result → navigate to /w/[slug]/p/[pipelineId].
 *
 * Defer (not in v1):
 *   * Cross-workspace results
 *   * Task / file / channel-message matches
 *   * Match highlighting in result rows
 *   * Mobile search affordance (the input stays `hidden md:block`)
 *
 * Empty-state copy is purpose-built so the dropdown never reads as
 * broken: separate messages for "this workspace has no pipelines"
 * vs "no match for the typed query" vs "couldn't load."
 */

export type HeaderSearchPipeline = {
  id: string;
  name: string;
  company: string | null;
  emoji: string | null;
};

export type HeaderSearchStatus = "loading" | "ready" | "error";

type Props = {
  pipelines: HeaderSearchPipeline[];
  status: HeaderSearchStatus;
  /** Used to build the destination URL on result click:
   *  /w/{workspaceSlug}/p/{pipelineId}. When null (e.g., on a
   *  workspace-agnostic route or before contexts resolve), the
   *  input still renders but result clicks no-op — the dropdown
   *  shows the "loading" empty state instead. */
  workspaceSlug: string | null;
};

// Cap the dropdown at 8 rows even when the workspace has more.
// Prevents an awkward 30-row scrolling dropdown; the user refines
// the query to narrow further. "+N more" footer surfaces overflow.
const MAX_RESULTS = 8;

export function HeaderSearch({ pipelines, status, workspaceSlug }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ── Filtering ──────────────────────────────────────────────────────
  // Case-insensitive substring on name OR company. Empty query →
  // surface the first N pipelines as a "browse" mode so the dropdown
  // is never blank when the user just clicks/focuses without typing.
  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return pipelines.slice(0, MAX_RESULTS);
    return pipelines
      .filter((p) => {
        if (p.name.toLowerCase().includes(trimmed)) return true;
        if (
          p.company &&
          p.company.toLowerCase().includes(trimmed)
        ) {
          return true;
        }
        return false;
      })
      .slice(0, MAX_RESULTS);
  }, [pipelines, query]);

  const overflowCount = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const total = trimmed
      ? pipelines.filter(
          (p) =>
            p.name.toLowerCase().includes(trimmed) ||
            (p.company !== null &&
              p.company.toLowerCase().includes(trimmed)),
        ).length
      : pipelines.length;
    return Math.max(0, total - filtered.length);
  }, [pipelines, query, filtered.length]);

  // Whenever the filtered set changes, snap selection back to the
  // top so Enter targets the most-relevant row.
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

  // ── Navigation ─────────────────────────────────────────────────────
  // Clear the query on navigation so the next ⌘K open is a fresh
  // palette session — matches Linear / Slack / GitHub command-palette
  // convention. User can always retype or back-arrow if they wanted
  // to refine; this is the less-surprising default.
  const go = useCallback(
    (p: HeaderSearchPipeline) => {
      if (!workspaceSlug) return;
      router.push(`/w/${workspaceSlug}/p/${p.id}`);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [router, workspaceSlug],
  );

  // ── Keyboard: ⌘K / Ctrl+K focuses the input from anywhere ──────────
  // The previous placeholder's hint badge reserved this combo; this
  // is the wire-up that honors it. preventDefault stops macOS Chrome
  // from focusing the omnibox.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Click-outside closes the dropdown ──────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // ── Input keydown — arrow nav, Enter to select, Esc closes ─────────
  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const p = filtered[activeIndex];
      if (p) go(p);
      return;
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex-1 min-w-0 hidden md:block"
      style={{ position: "relative" }}
    >
      <div
        className="flex items-center gap-2"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${open ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 8,
          padding: "8px 12px",
          transition: "border-color 120ms ease-out",
        }}
      >
        <Search size={14} style={{ color: "rgba(255,255,255,0.5)" }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          placeholder="Search by name or company…"
          aria-label="Search pipelines by name or company"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent text-[13px] outline-none border-none"
          style={{
            color: "white",
            minWidth: 0,
          }}
        />
        <kbd
          className="text-[11px] flex-shrink-0"
          style={{
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.5)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 4,
            padding: "2px 6px",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
          title="Press ⌘K from anywhere to focus search"
        >
          ⌘K
        </kbd>
      </div>

      {open && (
        <SearchDropdown
          status={status}
          query={query}
          totalPipelines={pipelines.length}
          filtered={filtered}
          overflowCount={overflowCount}
          activeIndex={activeIndex}
          onSelect={go}
          onHover={setActiveIndex}
          workspaceSlug={workspaceSlug}
        />
      )}
    </div>
  );
}

// ─── Dropdown ──────────────────────────────────────────────────────────

function SearchDropdown({
  status,
  query,
  totalPipelines,
  filtered,
  overflowCount,
  activeIndex,
  onSelect,
  onHover,
  workspaceSlug,
}: {
  status: HeaderSearchStatus;
  query: string;
  totalPipelines: number;
  filtered: HeaderSearchPipeline[];
  overflowCount: number;
  activeIndex: number;
  onSelect: (p: HeaderSearchPipeline) => void;
  onHover: (i: number) => void;
  workspaceSlug: string | null;
}) {
  // Decide what to render: loading → loading row; error → error row;
  // ready+no-workspace → "no workspace" hint; ready+no-pipelines →
  // empty workspace message (purpose-built copy per the spec);
  // ready+no-match → "no match for query"; else → list + optional
  // overflow footer.
  let body: React.ReactNode;
  if (status === "loading") {
    body = <EmptyRow text="Loading pipelines…" tone="muted" />;
  } else if (status === "error") {
    body = (
      <EmptyRow
        text="Couldn't load pipelines. Reload the page to retry."
        tone="error"
      />
    );
  } else if (!workspaceSlug) {
    body = (
      <EmptyRow
        text="Choose a workspace to search its pipelines."
        tone="muted"
      />
    );
  } else if (totalPipelines === 0) {
    body = (
      <EmptyRow
        text="No pipelines in this workspace yet — create one with the + Pipeline button."
        tone="muted"
      />
    );
  } else if (filtered.length === 0) {
    body = (
      <EmptyRow
        text={`No pipelines match “${query.trim()}”.`}
        tone="muted"
      />
    );
  } else {
    body = (
      <>
        {filtered.map((p, i) => (
          <ResultRow
            key={p.id}
            pipeline={p}
            active={i === activeIndex}
            onSelect={() => onSelect(p)}
            onHover={() => onHover(i)}
          />
        ))}
        {overflowCount > 0 && (
          <div
            style={{
              padding: "8px 12px",
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              borderTop: "1px solid #2A2A2D",
            }}
          >
            +{overflowCount} more — refine your search to narrow
          </div>
        )}
      </>
    );
  }

  return (
    <div
      role="listbox"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        right: 0,
        background: "#1A1A1C",
        border: "1px solid #36363A",
        borderRadius: 10,
        boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
        zIndex: 50,
        overflow: "hidden",
      }}
    >
      {body}
    </div>
  );
}

function ResultRow({
  pipeline,
  active,
  onSelect,
  onHover,
}: {
  pipeline: HeaderSearchPipeline;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      // mousedown (not click) fires before the input's blur handler,
      // which prevents the click-outside detector from closing the
      // dropdown the instant the user starts a click on the result.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "10px 12px",
        background: active ? "rgba(16,140,233,0.15)" : "transparent",
        border: "none",
        textAlign: "left",
        cursor: "pointer",
        color: "white",
      }}
    >
      <span
        style={{
          fontSize: 16,
          width: 22,
          textAlign: "center",
          flexShrink: 0,
        }}
        aria-hidden
      >
        {pipeline.emoji ?? "📁"}
      </span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "white",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {pipeline.name}
        </span>
        {pipeline.company && (
          <span
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {pipeline.company}
          </span>
        )}
      </span>
    </button>
  );
}

function EmptyRow({
  text,
  tone,
}: {
  text: string;
  tone: "muted" | "error";
}) {
  return (
    <div
      style={{
        padding: "14px 14px",
        fontSize: 12,
        lineHeight: 1.5,
        color: tone === "error" ? "#F43F5E" : "rgba(255,255,255,0.55)",
      }}
    >
      {text}
    </div>
  );
}
