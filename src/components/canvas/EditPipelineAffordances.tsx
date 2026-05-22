"use client";

import { useCallback, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

/**
 * Edit-mode-only canvas affordances + the delete-stage confirm dialog.
 * Phase 4a step 5e.
 *
 * Lives in its own file (vs inline in PipelineCanvas) because the
 * canvas file was already approaching 800 lines after the 5e callback
 * additions; the dialog + insert buttons are self-contained UI with no
 * cross-talk to the canvas's state machine — clean extraction point.
 *
 * Three pieces here:
 *   * `AddStageEndButton` — persistent "+ Add stage" affordance at the
 *     right edge of the stage cluster. Click expands into an inline
 *     title input → Enter submits + calls create_stage (after=null).
 *   * `InsertStageHandle` — invisible-by-default gap target between two
 *     adjacent stages; "+" pill fades in on hover. Click expands inline
 *     → Enter submits + calls create_stage (after=LEFT stage of gap).
 *   * `DeleteStageConfirmDialog` — full-screen modal overlay with the
 *     N-aware copy spec'd in PROGRESS.md (5e backend section).
 *
 * All three render in canvas-plane coords (absolute positioning inside
 * the TransformComponent) except the dialog, which renders fixed at
 * viewport coords (outside the zoom transform).
 *
 * `pan-disabled` class is set on every interactive element so
 * pointerdown doesn't start a canvas pan — matches the StageNode +
 * TaskRow pattern. The dialog is outside the canvas transform so it
 * doesn't need the class.
 */

// ─── shared input/affordance constants ────────────────────────────────────

// Match the StageNode badge geometry — these buttons sit on the same
// vertical baseline as the stage badges so the row reads as "stages + 1
// add button at the end."
const BUTTON_DIAMETER = 32;

// ─── AddStageEndButton ────────────────────────────────────────────────────

export function AddStageEndButton({
  x,
  y,
  onAdd,
}: {
  /** Top-left x in canvas-plane coords. */
  x: number;
  /** Top-left y in canvas-plane coords. Match this to the badge row's y. */
  y: number;
  onAdd: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = useCallback(() => {
    const cleaned = name.trim();
    if (cleaned) onAdd(cleaned);
    setName("");
    setExpanded(false);
  }, [name, onAdd]);

  const cancel = useCallback(() => {
    setName("");
    setExpanded(false);
  }, []);

  if (!expanded) {
    return (
      <button
        type="button"
        className="pan-disabled"
        aria-label="Add stage at end"
        onClick={() => {
          setExpanded(true);
          // Input not mounted yet — focus next tick.
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: BUTTON_DIAMETER,
          height: BUTTON_DIAMETER,
          borderRadius: "50%",
          background: "rgba(16,140,233,0.18)",
          border: "1.5px dashed #108CE9",
          color: "#108CE9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition: "background 120ms ease-out",
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "rgba(16,140,233,0.28)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.background = "rgba(16,140,233,0.18)")
        }
      >
        <Plus size={16} />
      </button>
    );
  }

  // Expanded — inline input matching stage-box geometry so the new
  // stage's eventual position is obvious before submit.
  return (
    <div
      className="pan-disabled"
      style={{
        position: "absolute",
        left: x,
        top: y,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        background: "rgba(33,33,36,0.95)",
        border: "1px solid #108CE9",
        borderRadius: 8,
        height: BUTTON_DIAMETER,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={submit}
        placeholder="Stage name…"
        maxLength={80}
        style={{
          width: 160,
          background: "transparent",
          border: "none",
          color: "white",
          fontSize: 13,
          fontWeight: 500,
          padding: 0,
          outline: "none",
        }}
      />
    </div>
  );
}

// ─── InsertStageHandle (gap between two adjacent stages) ──────────────────

/**
 * Hovers in the GAP between two adjacent stages. Invisible until the
 * user hovers within a wider hit-area centered on the gap; then a "+"
 * pill fades in and is clickable.
 *
 * `x` + `y` are top-left of the hit area, NOT the visible "+" pill.
 * Hit area is wider than visible affordance so hover doesn't feel
 * pixel-perfect.
 */
export function InsertStageHandle({
  x,
  y,
  hitWidth,
  hitHeight,
  onInsert,
  afterStageId,
}: {
  x: number;
  y: number;
  hitWidth: number;
  hitHeight: number;
  afterStageId: string;
  onInsert: (afterStageId: string, name: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = useCallback(() => {
    const cleaned = name.trim();
    if (cleaned) onInsert(afterStageId, cleaned);
    setName("");
    setExpanded(false);
    setHovered(false);
  }, [name, onInsert, afterStageId]);

  const cancel = useCallback(() => {
    setName("");
    setExpanded(false);
    setHovered(false);
  }, []);

  if (expanded) {
    // Inline input — center within the hit area.
    return (
      <div
        className="pan-disabled"
        style={{
          position: "absolute",
          left: x + hitWidth / 2 - 90,
          top: y + hitHeight / 2 - 16,
          display: "flex",
          alignItems: "center",
          padding: "4px 8px",
          background: "rgba(33,33,36,0.95)",
          border: "1px solid #108CE9",
          borderRadius: 8,
          width: 180,
          height: 32,
          zIndex: 5,
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={submit}
          placeholder="Stage name…"
          maxLength={80}
          style={{
            width: "100%",
            background: "transparent",
            border: "none",
            color: "white",
            fontSize: 13,
            fontWeight: 500,
            padding: 0,
            outline: "none",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="pan-disabled"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: hitWidth,
        height: hitHeight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Hit area is transparent — only the visible "+" pill shows.
        // No background fill, no border.
      }}
    >
      <button
        type="button"
        aria-label="Insert stage here"
        onClick={() => {
          setExpanded(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: hovered ? "rgba(16,140,233,0.95)" : "transparent",
          border: hovered
            ? "1.5px solid #108CE9"
            : "1.5px dashed rgba(16,140,233,0)",
          color: hovered ? "white" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          opacity: hovered ? 1 : 0,
          transition:
            "opacity 120ms ease-out, background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out",
        }}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

// ─── DeleteStageConfirmDialog ─────────────────────────────────────────────

export function DeleteStageConfirmDialog({
  stageName,
  taskCount,
  onCancel,
  onConfirm,
}: {
  stageName: string;
  taskCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // N-aware copy per the locked spec (PROGRESS.md, 5e backend section).
  const copy =
    taskCount >= 1
      ? `This will delete "${stageName}" and its ${taskCount} task${taskCount === 1 ? "" : "s"}. This can't be undone.`
      : `Delete "${stageName}"? This can't be undone.`;

  return (
    <div
      className="fade-in"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-card"
        style={{
          width: "100%",
          maxWidth: 420,
          padding: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <h2
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "#E4E4E7",
              margin: 0,
            }}
          >
            Delete stage?
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel delete"
            className="icon-btn"
          >
            <X size={14} />
          </button>
        </div>
        <p
          style={{
            fontSize: 13,
            color: "#979393",
            lineHeight: 1.5,
            margin: "12px 0 20px",
          }}
        >
          {copy}
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid #36363A",
              color: "#E4E4E7",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              background: "#F43F5E",
              border: "1px solid #F43F5E",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
