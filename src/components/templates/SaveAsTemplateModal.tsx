"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Save-as-template modal — phase 4c slice 3. Mirrors the shape of
 * AddLinkModal (same backdrop, card, button styles, Esc + backdrop-
 * click close, inline-error pattern) so the templates surface stays
 * visually consistent with the rest of the chrome modals.
 *
 * Differences vs AddLinkModal:
 *   * Owns the RPC call itself (calls supabase.rpc('save_pipeline_as_
 *     template', …) directly). AddLinkModal delegates via onSave; the
 *     save-as-template flow has exactly one caller and no need for the
 *     indirection.
 *   * Description field is a textarea (multi-line) and optional.
 *   * Muted explainer text below the form documenting what's stripped
 *     (completion state, assignees, deadlines, positions) — so the
 *     user understands templates are scaffolds, not snapshots.
 *   * SILENT close on success. No success toast or confirmation —
 *     decision deferred to slice 4 once the picker exists and there's
 *     somewhere to point at the new template. For now the modal just
 *     closes, the parent's onSaved fires (currently a no-op beyond
 *     closing), and the user can verify via SQL or wait for slice 4.
 *
 * Permission gating happens TWICE:
 *   1. UI: the trigger affordance (overflow menu item in
 *      PipelineHeader) is gated on chrome.canEditPipeline, so a
 *      non-editor never sees the menu item that opens this modal.
 *   2. RPC: the save_pipeline_as_template function re-checks
 *      can_edit_pipeline(source_pipeline_id) server-side and raises
 *      42501 if the caller fails. Defense in depth — a direct-
 *      PostgREST call (browser console / curl) can't bypass.
 *
 * Validation:
 *   * Trim + non-empty + ≤80 chars (matches the RPC's name validation).
 *   * Description optional; whitespace-only collapses to null on the
 *     DB side (the RPC's `nullif(trim(...), '')` pattern).
 *
 * Error states:
 *   * 42501 from RPC → permission denied (shouldn't happen given UI
 *     gate, but defensive — message displays the RPC's text verbatim).
 *   * 22023 from RPC → validation error (empty name, name too long,
 *     source pipeline not found).
 *   * Network error → generic message + console.error stack.
 *
 * On any error the modal stays open with the inline error visible;
 * the user can correct + retry without re-opening.
 */

const MAX_NAME_LENGTH = 80;

type Props = {
  /** The pipeline being copied. Threaded straight to the RPC as
   *  source_pipeline_id. PipelineHeader knows this via
   *  chrome.pipeline.id. */
  sourcePipelineId: string;
  /** Pre-fill for the template name input. PipelineHeader passes
   *  chrome.pipeline.name so the user can immediately Save to accept
   *  "<pipeline name>" as the template name, or retype to change it.
   *  Input autofocuses + selects-all on mount. */
  defaultName: string;
  /** Close without saving (X, Esc, backdrop, Cancel button). */
  onCancel: () => void;
  /** Save succeeded. Parent should close the modal. No payload —
   *  there's nowhere to navigate to yet (picker is slice 4). */
  onSaved: () => void;
};

export function SaveAsTemplateModal({
  sourcePipelineId,
  defaultName,
  onCancel,
  onSaved,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const tooLong = trimmed.length > MAX_NAME_LENGTH;
  const empty = trimmed === "";
  const canSave = !empty && !tooLong && !saving;

  // Autofocus + select-all so the user can immediately retype to
  // replace the default OR hit Enter / click Save to accept it.
  useEffect(() => {
    const t = setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  // Esc closes (matches AddLinkModal pattern).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc(
      "save_pipeline_as_template",
      {
        source_pipeline_id: sourcePipelineId,
        template_name: trimmed,
        // Empty-string collapses to null on the DB side via the
        // RPC's nullif(trim(...), '') pattern. We pass null
        // explicitly when locally empty so the wire payload is
        // smaller and the intent reads obvious.
        template_description: description.trim() || null,
        // null → RPC defaults to the source pipeline's emoji. No
        // emoji picker in this v1 UI; can be added later.
        template_emoji: null,
      },
    );

    if (rpcError) {
      console.error("[save-as-template] save failed:", rpcError);
      setError(rpcError.message);
      setSaving(false);
      return;
    }
    const result = data as { template_id?: string; name?: string } | null;
    if (!result?.template_id) {
      console.error("[save-as-template] malformed RPC response:", data);
      setError(
        "Save returned an unexpected response. Refresh to verify it landed.",
      );
      setSaving(false);
      return;
    }

    // Silent close — parent unmounts this component. No setSaving(false).
    onSaved();
  };

  return (
    <div
      onClick={() => {
        if (!saving) onCancel();
      }}
      role="dialog"
      aria-label="Save as template"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#1A1A1C",
          border: "1px solid #36363A",
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: "white",
            }}
          >
            Save as template
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label="Close"
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
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Template name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Template name
          </label>
          <input
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client onboarding"
            maxLength={MAX_NAME_LENGTH}
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) {
                e.preventDefault();
                void handleSave();
              }
            }}
            style={inputStyle}
          />
        </div>

        {/* Description (optional) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "rgba(255,255,255,0.55)",
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}
          >
            Description{" "}
            <span
              style={{
                textTransform: "none",
                color: "rgba(255,255,255,0.35)",
                fontWeight: 400,
                letterSpacing: 0,
              }}
            >
              (optional)
            </span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this template for?"
            rows={3}
            disabled={saving}
            style={{
              ...inputStyle,
              resize: "vertical",
              minHeight: 72,
              lineHeight: 1.4,
            }}
          />
        </div>

        {/* Muted explainer — what templates capture / don't capture. */}
        <p
          style={{
            margin: 0,
            fontSize: 12,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.45)",
          }}
        >
          Saves the current pipeline&apos;s stages + tasks as a reusable
          template for this workspace. Won&apos;t include completion state,
          assignees, deadlines, or task positions.
        </p>

        {tooLong && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: "#F43F5E",
              padding: "8px 10px",
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.3)",
              borderRadius: 6,
            }}
          >
            Template name is too long ({trimmed.length} of{" "}
            {MAX_NAME_LENGTH} characters).
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12,
              color: "#F43F5E",
              padding: "8px 10px",
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.3)",
              borderRadius: 6,
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={btnGhostStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            style={{
              ...btnPrimaryStyle,
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared styles (mirror AddLinkModal exactly) ──────────────────────

const inputStyle: React.CSSProperties = {
  background: "#2C2C2F",
  border: "1px solid #36363A",
  borderRadius: 8,
  padding: "9px 12px",
  color: "white",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};

const btnGhostStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "transparent",
  border: "1px solid #36363A",
  borderRadius: 8,
  color: "rgba(255,255,255,0.75)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#108CE9",
  border: "1px solid #108CE9",
  borderRadius: 8,
  color: "white",
  fontSize: 13,
  fontWeight: 600,
};
