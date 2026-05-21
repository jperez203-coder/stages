"use client";

import { useEffect, useState, type RefObject } from "react";
import { Plus, ChevronDown } from "lucide-react";
import type { PipelineLite } from "./types";

/**
 * Quick-add task row at the bottom of /w/[slug]/my-tasks. Dashed
 * placeholder row that expands into a title input + pipeline picker on
 * click or ⌘N focus.
 *
 * Workflow:
 *   1. Collapsed: renders dashed "+ Quick add task" row with the ⌘N shortcut hint.
 *   2. Click or ⌘N → expands. Input autofocuses. Pipeline pre-selected to
 *      profiles.last_active_pipeline_id (or the alphabetically-first
 *      pipeline if last_active is null / not in this workspace).
 *   3. Enter or Add button → calls onCreate(stageId, title). Stage id is
 *      the picked pipeline's currentStageId (derived server-side per the
 *      locked 3-state rule).
 *   4. After successful create: input clears + stays focused for rapid
 *      multi-add. Pipeline pick stays as the user left it.
 *
 * Permission: only renders pipelines the user can write to (filtered
 * server-side via the page's pipelines query, which RLS already
 * restricts to workspace-readable pipelines).
 */

type Props = {
  pipelines: PipelineLite[];
  lastActivePipelineId: string | null;
  /** Parent passes a ref so the bare-`N` keyboard handler in MyTasksView
   *  can focus the input directly after expanding the row. */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Controlled expansion state — lifted to MyTasksView so the keyboard
   *  shortcut can expand from anywhere on the page (the input isn't
   *  mounted while collapsed, so focus alone can't transition states). */
  expanded: boolean;
  onExpandedChange: (next: boolean) => void;
  onCreate: (stageId: string, title: string) => Promise<void>;
};

export function QuickAddRow({
  pipelines,
  lastActivePipelineId,
  inputRef,
  expanded,
  onExpandedChange,
  onCreate,
}: Props) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Resolve the default pipeline. Prefer last_active if it's in this
  // workspace; else first alphabetically; else null (no pipelines at all
  // — user needs to create one first).
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(
    () => {
      if (
        lastActivePipelineId &&
        pipelines.some((p) => p.id === lastActivePipelineId)
      ) {
        return lastActivePipelineId;
      }
      return pipelines[0]?.id ?? null;
    },
  );

  const selectedPipeline =
    pipelines.find((p) => p.id === selectedPipelineId) ?? null;

  // Auto-expand when the input is focused via ⌘N — the parent focuses the
  // input directly via the ref, so we listen to focus events here to flip
  // expanded=true.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    const onFocus = () => onExpandedChange(true);
    node.addEventListener("focus", onFocus);
    return () => node.removeEventListener("focus", onFocus);
  }, [inputRef, onExpandedChange]);

  const canSubmit =
    title.trim().length > 0 &&
    selectedPipeline?.currentStageId != null &&
    !submitting;

  const submit = async () => {
    if (!canSubmit || !selectedPipeline?.currentStageId) return;
    setSubmitting(true);
    await onCreate(selectedPipeline.currentStageId, title.trim());
    setTitle("");
    setSubmitting(false);
    // Keep focus + expansion so the user can rapidly add more.
    inputRef.current?.focus();
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => {
          onExpandedChange(true);
          // Defer to next tick so the input is mounted before we focus it.
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        className="w-full flex items-center gap-2 transition-colors"
        style={{
          padding: "16px 20px",
          background: "#222933",
          border: "1.5px dashed #25476B",
          borderRadius: 12,
          color: "#35C4EE",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        <Plus size={14} />
        <span>Quick add task</span>
        <span className="flex-1" />
        {/* Hint is the bare key `N` — Cmd+N is reserved by the browser
            for New Window and can't be intercepted; ⌘K is reserved for
            the global search/command palette per the Slack/Linear
            convention. See MyTasksView keyboard handler. */}
        <span className="text-[11px]" style={{ color: "#35C4EE" }}>
          N
        </span>
      </button>
    );
  }

  return (
    <div
      className="rounded-xl flex items-center gap-2"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        padding: "12px 16px",
      }}
    >
      <Plus size={14} style={{ color: "rgba(255,255,255,0.4)" }} aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            onExpandedChange(false);
            setTitle("");
          }
        }}
        placeholder="What needs doing?"
        className="flex-1 bg-transparent border-none outline-none text-[14px] text-white placeholder-zinc-500"
        disabled={submitting}
      />

      {/* Pipeline picker — chip with chevron, opens a small menu */}
      <div className="relative flex-shrink-0">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[12px] font-medium transition-colors"
          style={{
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 6,
            padding: "5px 10px",
            cursor: "pointer",
          }}
          disabled={submitting}
        >
          {selectedPipeline ? (
            <>
              <span aria-hidden style={{ fontSize: 12 }}>
                {selectedPipeline.emoji ?? "📋"}
              </span>
              <span className="truncate" style={{ maxWidth: 140 }}>
                {selectedPipeline.name}
              </span>
            </>
          ) : (
            <span style={{ color: "rgba(255,255,255,0.5)" }}>
              Choose pipeline
            </span>
          )}
          <ChevronDown size={12} />
        </button>

        {pickerOpen && (
          <PipelinePickerMenu
            pipelines={pipelines}
            selectedId={selectedPipelineId}
            onSelect={(id) => {
              setSelectedPipelineId(id);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="text-[13px] font-medium transition-opacity"
        style={{
          background: "#108CE9",
          color: "white",
          padding: "6px 14px",
          borderRadius: 6,
          border: "none",
          cursor: canSubmit ? "pointer" : "not-allowed",
          opacity: canSubmit ? 1 : 0.5,
        }}
      >
        {submitting ? "Adding…" : "Add"}
      </button>

      {/* Subtle hint about where this task lands */}
      {selectedPipeline?.currentStageId == null && (
        <span
          className="text-[11px] absolute"
          style={{
            color: "rgba(223,30,90,0.85)",
            bottom: -20,
            right: 16,
          }}
        >
          Pick a pipeline with stages
        </span>
      )}
    </div>
  );
}

// ─── Pipeline picker menu ────────────────────────────────────────────────

function PipelinePickerMenu({
  pipelines,
  selectedId,
  onSelect,
  onClose,
}: {
  pipelines: PipelineLite[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-pipeline-picker]')) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  return (
    <div
      data-pipeline-picker
      className="absolute right-0 z-50 fade-in"
      role="menu"
      style={{
        bottom: "calc(100% + 6px)",
        width: 220,
        background: "#1A1A1A",
        border: "1px solid #36363A",
        borderRadius: 10,
        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        padding: 4,
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      {pipelines.length === 0 ? (
        <div
          className="text-[12px] py-3 px-3 text-center"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          No pipelines yet
        </div>
      ) : (
        pipelines.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className="w-full flex items-center gap-2 text-left transition-colors"
            style={{
              background: p.id === selectedId ? "rgba(16,140,233,0.12)" : "transparent",
              color: p.id === selectedId ? "#7FA7D9" : "rgba(255,255,255,0.85)",
              padding: "8px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
            }}
            onMouseEnter={(e) => {
              if (p.id !== selectedId) {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              }
            }}
            onMouseLeave={(e) => {
              if (p.id !== selectedId) {
                e.currentTarget.style.background = "transparent";
              }
            }}
          >
            <span aria-hidden style={{ fontSize: 14 }}>
              {p.emoji ?? "📋"}
            </span>
            <span className="flex-1 truncate">{p.name}</span>
            {p.currentStageId == null && (
              <span
                className="text-[10px]"
                style={{ color: "rgba(255,255,255,0.4)" }}
              >
                no stages
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
