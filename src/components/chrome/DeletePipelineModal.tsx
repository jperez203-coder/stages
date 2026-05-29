"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Destructive-confirm modal for "Delete pipeline". GitHub-repo-style
 * type-the-name friction — the Delete button only enables when the
 * user types the EXACT pipeline name (case-sensitive, trim-only). The
 * pipeline name is shown verbatim in bold so the user can read what
 * to type.
 *
 * Lives under chrome/ (not templates/) because deletion is a
 * pipeline-chrome-level destructive action, paired with the overflow
 * menu in PipelineHeader. Mirrors SaveAsTemplateModal styling so the
 * two modals feel like one family.
 *
 * Calls the delete_pipeline RPC (migration 20260610120000):
 *   * security definer, re-checks can_edit_pipeline on the server
 *   * single transaction: bulk-cleans pipeline_files + stage_attachments
 *     storage objects by `{pipeline_id}/...` prefix, then runs the
 *     DELETE FROM pipelines (which cascades to memberships, stages,
 *     tasks, channels, chat messages, activity, invites)
 *   * templates.source_pipeline_id is ON DELETE SET NULL, so saved
 *     templates SURVIVE — the explainer copy mentions this
 *
 * Defense in depth: even if the UI menu item somehow rendered for a
 * user who shouldn't see it, the RPC's can_edit_pipeline re-check
 * returns 42501 with the message surfaced inline.
 *
 * On success the modal does NOT auto-close — it calls onDeleted, which
 * the parent uses to router.push('/w/<slug>'). The router navigation
 * unmounts the canvas + this modal together as part of the route
 * change, so there's no perceptible "modal still showing on a
 * deleted-pipeline canvas" flash.
 */

type Props = {
  pipelineId: string;
  pipelineName: string;
  onCancel: () => void;
  /** Fired after the RPC returns successfully. Parent handles the
   *  redirect to /w/<slug>; the modal doesn't manage its own
   *  visibility because the parent's navigation unmounts everything. */
  onDeleted: () => void;
};

export function DeletePipelineModal({
  pipelineId,
  pipelineName,
  onCancel,
  onDeleted,
}: Props) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Case-sensitive, trim-only match. Trim is forgiving for a stray
  // leading/trailing space (a common paste artifact); case-sensitivity
  // is the intentional friction — GitHub-style repo-name confirm.
  const canDelete = confirmText.trim() === pipelineName && !deleting;

  // Autofocus the confirm input. No select-all here — defaulting to
  // empty means the input is naturally ready for typing; no value to
  // select. The user MUST type the name to enable Delete.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Esc closes (matches SaveAsTemplateModal). Disabled while the RPC
  // is in flight so a stray Esc doesn't abandon a half-done delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, deleting]);

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("delete_pipeline", {
      pipeline_id: pipelineId,
    });

    if (rpcError) {
      console.error(
        "[delete-pipeline] RPC failed:",
        rpcError?.message,
        "code:",
        rpcError?.code,
        "details:",
        rpcError?.details,
        "hint:",
        rpcError?.hint,
      );
      setError(rpcError.message);
      setDeleting(false);
      return;
    }

    // Parent handles router.push('/w/<slug>'). Don't setDeleting(false)
    // — the canvas page is about to unmount as part of the navigation,
    // so leaving the button in its disabled "Deleting…" state until
    // unmount is the right read.
    onDeleted();
  };

  return (
    <div
      onClick={() => {
        if (!deleting) onCancel();
      }}
      role="dialog"
      aria-label="Delete pipeline"
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
        {/* Header — default-white title per founder's call (modal +
            Delete button already carry the destructive red signal). */}
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
            Delete pipeline
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
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
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Explainer + "can't be undone" + what survives. The
            saved-templates-survive line is important because users may
            have invested time saving a template from this pipeline and
            should know it persists. */}
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: 12,
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.3)",
            borderRadius: 8,
          }}
        >
          <AlertTriangle
            size={14}
            color="#F43F5E"
            style={{ flexShrink: 0, marginTop: 2 }}
          />
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            Deleting{" "}
            <strong style={{ color: "white" }}>
              &ldquo;{pipelineName}&rdquo;
            </strong>{" "}
            permanently removes its stages, tasks, channels, chat messages,
            files, and the client&apos;s portal access.{" "}
            <span style={{ color: "#F43F5E", fontWeight: 600 }}>
              This can&apos;t be undone.
            </span>{" "}
            Templates you saved from this pipeline are kept.
          </div>
        </div>

        {/* Type-the-name confirm. Label uses <strong> for the pipeline
            name so the user can see exactly what to type. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label
            htmlFor="delete-pipeline-confirm-input"
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.75)",
              lineHeight: 1.5,
            }}
          >
            Type{" "}
            <strong
              style={{
                color: "white",
                fontWeight: 700,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {pipelineName}
            </strong>{" "}
            to confirm.
          </label>
          <input
            id="delete-pipeline-confirm-input"
            ref={inputRef}
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={pipelineName}
            disabled={deleting}
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canDelete) {
                e.preventDefault();
                void handleDelete();
              }
            }}
            style={inputStyle}
          />
        </div>

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

        {/* Actions — Cancel ghost, Delete destructive red. Disabled
            until name matches exactly (case-sensitive). */}
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
            disabled={deleting}
            style={btnGhostStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={!canDelete}
            style={{
              ...btnDestructiveStyle,
              opacity: canDelete ? 1 : 0.4,
              cursor: canDelete ? "pointer" : "not-allowed",
            }}
          >
            {deleting ? "Deleting…" : "Delete pipeline"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared styles (mirror SaveAsTemplateModal + DeleteConfirm) ───────

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

// Destructive variant of the primary button — red accent matches the
// agency-side DeleteConfirm (FilesBody.tsx) + the portal-side
// DeleteConfirm (PortalFilesBody.tsx). Same token (#F43F5E = stages-red).
const btnDestructiveStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#F43F5E",
  border: "1px solid #F43F5E",
  borderRadius: 8,
  color: "white",
  fontSize: 13,
  fontWeight: 600,
};
