"use client";

import { useEffect } from "react";
import { Check, X } from "lucide-react";
import type { VisibleTask } from "@/lib/portal-canvas-data";
import { PortalChecklistSection } from "./PortalChecklistSection";

/**
 * Slim, client-mode task detail panel for the portal canvas.
 * Phase 4b-2-b.
 *
 * Slide-in from the right (matches agency TaskDetailPanel's animation
 * + 500px width). Read-only display for title / description / deadline
 * (clients track progress, agency authors content); functional done
 * checkbox; functional checklist toggles (via PortalChecklistSection).
 *
 * ─── DELIBERATELY NOT A WRAPPER AROUND THE AGENCY PANEL ────────────
 *   Agency TaskDetailPanel is ~1900 lines, heavily edit-coupled
 *   (assignee picker, client_visible toggle, +Add sibling, delete
 *   confirm, member resolution, inline rename, etc.). This is a slim
 *   sibling — ~250 lines — built fresh for the client surface. Same
 *   pattern as PortalCanvas / PortalStageNode / PortalTaskRow. The
 *   agency file is untouched.
 *
 * ─── SYNC WITH CANVAS ─────────────────────────────────────────────
 *   The done toggle calls the SAME `onToggleDone` callback PortalCanvas
 *   passes to PortalTaskRow. Single source of truth: `tasksState` in
 *   PortalCanvas. Toggling done here mutates that state → the canvas
 *   card re-renders, the stage state recomputes via stageStateFromCounts,
 *   stage badge + box re-colors, all in one render pass.
 *
 *   The `task` prop is looked up by id from tasksState each render in
 *   PortalCanvas — so when state changes, the panel sees the fresh
 *   value automatically. No prop-keyed React tricks needed.
 *
 *   `onClose` is wired to clear `openTaskId` in PortalCanvas. If the
 *   task disappears between renders (defensive — shouldn't happen on
 *   the portal surface), PortalCanvas's lookup returns undefined and
 *   the panel never mounts, achieving an implicit self-close.
 *
 * ─── SECTIONS RENDERED (locked) ───────────────────────────────────
 *   * Breadcrumb (pipeline › stage) — read-only
 *   * Title — read-only
 *   * Done checkbox — editable
 *   * Description — read-only, hidden when null
 *   * Deadline — read-only, hidden when null
 *   * Checklist — render items + togglable checkboxes; section
 *     hidden entirely if no items (handled inside ChecklistSection)
 *
 * NOT rendered: assignee picker, client_visible toggle, +Add sibling,
 * Delete task, stage notes / attachments / activity stubs.
 */

const PANEL_WIDTH = 500;

type Props = {
  task: VisibleTask;
  pipelineName: string;
  stageName: string;
  onClose: () => void;
  /** Same callback PortalCanvas passes to PortalTaskRow. Toggling
   *  done in the panel updates the shared tasksState; the canvas
   *  card re-colors in the same render pass. */
  onToggleDone: (taskId: string, nextDone: boolean) => void;
};

export function PortalTaskDetailPanel({
  task,
  pipelineName,
  stageName,
  onClose,
  onToggleDone,
}: Props) {
  // Close on Escape (matches agency panel behavior).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isDone = task.done;
  const hasDescription = task.description != null && task.description.trim() !== "";
  const hasDeadline = task.deadline != null;

  return (
    <>
      {/* Inline @keyframes — same shape as agency panel. Small enough
          to colocate; avoids a global stylesheet edit for one panel. */}
      <style>{`
        @keyframes portalPanelSlideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes portalPanelFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Dimming overlay — click anywhere outside the panel to close.
          Stops short of the panel's left edge so the panel itself
          isn't dimmed. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          right: PANEL_WIDTH,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(2px)",
          zIndex: 50,
          animation: "portalPanelFadeIn 160ms ease-out",
        }}
      />

      {/* Panel — slide-in from the right. */}
      <aside
        role="dialog"
        aria-label={`Task details: ${task.title}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          background: "#1A1A1C",
          borderLeft: "1px solid #36363A",
          color: "#E4E4E7",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          animation: "portalPanelSlideIn 220ms cubic-bezier(0.2, 0, 0, 1)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* ── Header: breadcrumb + close ──────────────────────────── */}
        <div
          style={{
            padding: "14px 16px 12px",
            borderBottom: "1px solid #2A2A2D",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              flex: 1,
            }}
          >
            {pipelineName ? <>{pipelineName} <span style={{ opacity: 0.5 }}>›</span> </> : null}
            <span style={{ color: "rgba(255,255,255,0.7)" }}>{stageName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
              color: "rgba(255,255,255,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              transition: "background 120ms, color 120ms, border-color 120ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "white";
              e.currentTarget.style.borderColor = "#36363A";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255,255,255,0.6)";
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "18px 20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 22,
          }}
        >
          {/* Title + done checkbox row */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <button
              type="button"
              onClick={() => onToggleDone(task.id, !isDone)}
              aria-label={isDone ? "Mark as not done" : "Mark as done"}
              aria-pressed={isDone}
              style={{
                marginTop: 4,
                width: 22,
                height: 22,
                borderRadius: 6,
                background: isDone ? "#15B981" : "transparent",
                border: `1.5px solid ${isDone ? "#15B981" : "#4A4A50"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
                transition:
                  "background 120ms ease-out, border-color 120ms ease-out",
              }}
              onMouseEnter={(e) => {
                if (!isDone) e.currentTarget.style.borderColor = "#979393";
              }}
              onMouseLeave={(e) => {
                if (!isDone) e.currentTarget.style.borderColor = "#4A4A50";
              }}
            >
              {isDone && <Check size={14} color="white" strokeWidth={3} />}
            </button>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1.3,
                color: isDone ? "rgba(255,255,255,0.6)" : "white",
                textDecoration: isDone ? "line-through" : "none",
                wordBreak: "break-word",
              }}
            >
              {task.title}
            </h2>
          </div>

          {/* Description — read-only, hidden when empty/null. */}
          {hasDescription && (
            <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.5)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  margin: 0,
                }}
              >
                Description
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "rgba(255,255,255,0.88)",
                  lineHeight: 1.55,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {task.description}
              </p>
            </section>
          )}

          {/* Deadline — read-only, hidden when null. */}
          {hasDeadline && (
            <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <h3
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.5)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  margin: 0,
                }}
              >
                Deadline
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: "rgba(255,255,255,0.88)",
                  lineHeight: 1.4,
                }}
              >
                {formatDeadlineLong(task.deadline as string)}
              </p>
            </section>
          )}

          {/* Checklist — self-contained: lazy-fetches, renders nothing
              when empty/loading, togglable per-item for the client. */}
          <PortalChecklistSection taskId={task.id} />
        </div>
      </aside>
    </>
  );
}

/**
 * Format a deadline timestamp into a human-readable long-form string
 * for the panel (vs the card's compact pill form). Examples:
 *   "Today" / "Tomorrow" / "Monday" (within next week) /
 *   "March 14, 2026" (further out)
 */
function formatDeadlineLong(iso: string): string {
  const d = new Date(iso);
  const now = new Date();

  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return "Today";

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  ) {
    return "Tomorrow";
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((d.getTime() - now.getTime()) / msPerDay);
  if (diffDays > 1 && diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }

  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
