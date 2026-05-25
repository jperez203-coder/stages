"use client";

import { useCallback, useRef, useState } from "react";
import { Link as LinkIcon, Upload, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildStoragePath } from "@/lib/build-storage-path";
import { triggerFileDownload } from "@/lib/file-signed-url";
import { FileRow } from "@/components/files/FileRow";
import { FilePreview } from "@/components/files/FilePreview";
import { AddLinkModal } from "@/components/files/AddLinkModal";
import type { FileItem } from "@/lib/pipeline-files-data";

/**
 * Agency-side files surface body. Phase 4b-3-b.
 *
 * Owns:
 *   * Local files list state (seeded from server fetch; mutated by
 *     upload / add-link / toggle / delete with optimistic patterns)
 *   * Upload picker (hidden <input type="file">) + click-to-trigger
 *   * Add-link modal state
 *   * Delete confirm state
 *   * Preview modal state (only mounts for image/pdf; other types
 *     trigger a direct download via signed-URL anchor click)
 *   * Inline error surface (ephemeral, dismissed on next interaction)
 *
 * Mutation patterns (mirror the established slice patterns):
 *   * Optimistic add → INSERT → reconcile or revert
 *   * Toggle: snapshot prev → mutate → UPDATE → revert on failure
 *   * Delete: optimistic remove → metadata DELETE → storage DELETE
 *     (order matters — see file comments in handleDelete below)
 *   * Upload: optimistic row (status='uploading') → storage UPLOAD →
 *     metadata INSERT → reconcile; orphan cleanup if metadata fails
 *
 * RLS handles the agency vs. client filter at the DB layer; this
 * component renders whatever pipeline_links_select returns for the
 * caller (full set for agency members).
 */

type Props = {
  pipelineId: string;
  initialFiles: FileItem[];
  viewerId: string;
  canEditPipeline: boolean;
};

type RowWithStatus = FileItem & { status?: "uploading" };
type PreviewState = { type: "image" | "pdf"; row: FileItem } | null;
type DeleteState = { id: string; label: string } | null;

export function FilesBody({
  pipelineId,
  initialFiles,
  viewerId,
  canEditPipeline,
}: Props) {
  const [files, setFiles] = useState<RowWithStatus[]>(initialFiles);
  const [showAddLink, setShowAddLink] = useState(false);
  const [showDelete, setShowDelete] = useState<DeleteState>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // SELECT clause shared across the two INSERT call sites — keeps the
  // returned row shape in sync with FileItem so reconciliation works
  // without surprise nulls.
  const SELECT_COLS =
    "id, kind, label, url, storage_path, file_name, file_size, mime_type, client_visible, added_by, added_at";

  // ── Upload ──────────────────────────────────────────────────────────
  const handleFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset the input so re-picking the same file works without
      // requiring a different filename.
      e.target.value = "";

      setInlineError(null);
      const storagePath = buildStoragePath(pipelineId, file.name);
      const tempId = crypto.randomUUID();
      const mimeType = file.type || null;

      // Optimistic — row shows immediately with a spinner.
      const optimistic: RowWithStatus = {
        id: tempId,
        kind: "file",
        label: null,
        url: null,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: mimeType,
        client_visible: false,
        added_by: viewerId,
        added_at: new Date().toISOString(),
        status: "uploading",
      };
      setFiles((prev) => [optimistic, ...prev]);

      // 1. Upload to storage.
      const { error: uploadErr } = await supabase
        .storage
        .from("pipeline_files")
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (uploadErr) {
        console.error("[files] storage upload failed:", uploadErr);
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Upload failed. Try again.");
        return;
      }

      // 2. INSERT metadata row.
      const { data: row, error: insertErr } = await supabase
        .from("pipeline_links")
        .insert({
          pipeline_id: pipelineId,
          kind: "file",
          label: null,
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: mimeType,
          added_by: viewerId,
          client_visible: false,
        })
        .select(SELECT_COLS)
        .single();

      // 3. INSERT failure → orphan cleanup.
      if (insertErr || !row) {
        console.error("[files] metadata insert failed:", insertErr);
        const { error: cleanupErr } = await supabase
          .storage
          .from("pipeline_files")
          .remove([storagePath]);
        if (cleanupErr) {
          // Best-effort failed too — bytes sit invisible in the bucket.
          // No RLS path returns them (no joined metadata row), so this
          // is a janitor problem, not a privacy problem.
          console.error(
            "[files] orphan cleanup ALSO failed — invisible bytes left in bucket:",
            cleanupErr,
          );
        }
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Couldn't save file. Try again.");
        return;
      }

      // 4. Reconcile — swap optimistic row for the server row.
      setFiles((prev) =>
        prev.map((f) => (f.id === tempId ? (row as FileItem) : f)),
      );
    },
    [pipelineId, viewerId],
  );

  // ── Add link ────────────────────────────────────────────────────────
  const handleAddLink = useCallback(
    async (label: string, url: string) => {
      const { data: row, error } = await supabase
        .from("pipeline_links")
        .insert({
          pipeline_id: pipelineId,
          kind: "url",
          label,
          url,
          added_by: viewerId,
          client_visible: false,
        })
        .select(SELECT_COLS)
        .single();

      if (error || !row) {
        console.error("[files] add link failed:", error);
        // Re-throw so the modal surfaces an inline error and stays open.
        throw new Error(error?.message ?? "Insert failed");
      }

      setFiles((prev) => [row as FileItem, ...prev]);
      setShowAddLink(false);
    },
    [pipelineId, viewerId],
  );

  // ── Toggle visibility ───────────────────────────────────────────────
  const handleToggleVisibility = useCallback(
    async (id: string, next: boolean) => {
      const snapshot = files;
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, client_visible: next } : f)),
      );

      const { error } = await supabase
        .from("pipeline_links")
        .update({ client_visible: next })
        .eq("id", id);

      if (error) {
        console.error("[files] toggle visibility failed:", error);
        setFiles(snapshot);
        setInlineError("Couldn't change visibility. Try again.");
      }
    },
    [files],
  );

  // ── Delete (after confirm) ──────────────────────────────────────────
  // Order: metadata DELETE first, THEN storage DELETE. Inverse of
  // upload — preferring the "invisible orphan in bucket" failure mode
  // over "broken metadata row with 404 preview." If storage delete
  // fails after metadata delete succeeded, the bytes are unreachable
  // (no joined row → RLS SELECT denies) so privacy-safe; just bucket
  // bloat. Logged for a future janitor pass.
  const handleDelete = useCallback(
    async (id: string) => {
      const row = files.find((f) => f.id === id);
      if (!row) {
        setShowDelete(null);
        return;
      }

      const snapshot = files;
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setShowDelete(null);

      const { error: metaErr } = await supabase
        .from("pipeline_links")
        .delete()
        .eq("id", id);

      if (metaErr) {
        console.error("[files] metadata delete failed:", metaErr);
        setFiles(snapshot);
        setInlineError("Couldn't delete. Try again.");
        return;
      }

      if (row.kind === "file" && row.storage_path) {
        const { error: storageErr } = await supabase
          .storage
          .from("pipeline_files")
          .remove([row.storage_path]);
        if (storageErr) {
          // Metadata is gone; bytes orphaned. Privacy-safe (invisible);
          // just bucket bloat.
          console.error(
            "[files] storage delete failed — orphan left in bucket:",
            storageErr,
          );
        }
      }
    },
    [files],
  );

  // ── Row click (preview / download / open dispatch) ──────────────────
  // For non-previewable file types the click is a "default action =
  // download" — delegates to the shared triggerFileDownload helper
  // (same path the explicit Download button takes via handleDownload
  // below). For previewable types (image/pdf), opens the preview modal.
  // For links, opens in a new tab.
  const handleRowClick = useCallback(async (row: FileItem) => {
    if (row.kind === "url") {
      if (row.url) {
        window.open(row.url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    // kind === 'file'
    if (!row.storage_path) return;
    const mime = row.mime_type ?? "";
    if (mime.startsWith("image/")) {
      setPreview({ type: "image", row });
      return;
    }
    if (mime === "application/pdf") {
      setPreview({ type: "pdf", row });
      return;
    }
    // Other types → download (shared helper).
    const { error } = await triggerFileDownload(
      row.storage_path,
      row.file_name,
    );
    if (error) {
      setInlineError("Couldn't download. Try again.");
    }
  }, []);

  // ── Explicit Download button (always-visible per row, kind='file' only).
  // Same shared helper as the row-click fallback above — single
  // implementation for both entry points; same error surface.
  const handleDownload = useCallback(async (row: FileItem) => {
    if (row.kind !== "file" || !row.storage_path) return;
    const { error } = await triggerFileDownload(
      row.storage_path,
      row.file_name,
    );
    if (error) {
      setInlineError("Couldn't download. Try again.");
    }
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "#212124",
      }}
    >
      {/* Header — title + actions */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 28px 16px",
          borderBottom: "1px solid #2A2A2D",
          gap: 12,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "white",
              lineHeight: 1.2,
            }}
          >
            Files
          </h1>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "rgba(255,255,255,0.5)",
            }}
          >
            {files.length} {files.length === 1 ? "item" : "items"}
          </div>
        </div>
        {canEditPipeline && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setShowAddLink(true)}
              style={btnGhostStyle}
            >
              <LinkIcon size={14} />
              Add link
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={btnPrimaryStyle}
            >
              <Upload size={14} />
              Upload
            </button>
            {/* Hidden input — triggered by the Upload button. */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFilePick}
              style={{ display: "none" }}
            />
          </div>
        )}
      </header>

      {/* Inline error */}
      {inlineError && (
        <div
          role="alert"
          style={{
            margin: "12px 28px 0",
            padding: "10px 14px",
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.3)",
            borderRadius: 8,
            fontSize: 13,
            color: "#F43F5E",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{inlineError}</span>
          <button
            type="button"
            onClick={() => setInlineError(null)}
            aria-label="Dismiss error"
            style={{
              background: "transparent",
              border: "none",
              color: "#F43F5E",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* List or empty state */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 28px 24px",
        }}
      >
        {files.length === 0 ? (
          <EmptyState canEdit={canEditPipeline} />
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {files.map((row) => (
              <li key={row.id}>
                <FileRow
                  row={row}
                  canEdit={
                    canEditPipeline || row.added_by === viewerId
                  }
                  onToggleVisibility={handleToggleVisibility}
                  onRequestDelete={(id) => {
                    const r = files.find((f) => f.id === id);
                    const label =
                      r?.label ?? r?.file_name ?? "this item";
                    setShowDelete({ id, label });
                  }}
                  onClick={handleRowClick}
                  onDownload={handleDownload}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modals */}
      {showAddLink && (
        <AddLinkModal
          onCancel={() => setShowAddLink(false)}
          onSave={handleAddLink}
        />
      )}

      {showDelete && (
        <DeleteConfirm
          label={showDelete.label}
          onCancel={() => setShowDelete(null)}
          onConfirm={() => void handleDelete(showDelete.id)}
        />
      )}

      {preview && (
        <FilePreview
          type={preview.type}
          row={preview.row}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function EmptyState({ canEdit }: { canEdit: boolean }) {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 240,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        textAlign: "center",
        color: "rgba(255,255,255,0.55)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "white" }}>
        No files yet
      </p>
      <p style={{ margin: 0, fontSize: 13, maxWidth: 360, lineHeight: 1.5 }}>
        {canEdit
          ? "Upload a file or attach a link to share it on this pipeline."
          : "Files and links shared on this pipeline will appear here."}
      </p>
    </div>
  );
}

function DeleteConfirm({
  label,
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      role="dialog"
      aria-label="Confirm delete"
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
          maxWidth: 380,
          background: "#1A1A1C",
          border: "1px solid #36363A",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <p style={{ margin: 0, fontSize: 14, color: "white", lineHeight: 1.5 }}>
          Delete <strong>&ldquo;{label}&rdquo;</strong>? This can&rsquo;t be
          undone.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} style={btnGhostStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              ...btnPrimaryStyle,
              background: "#F43F5E",
              border: "1px solid #F43F5E",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared button styles (also defined in AddLinkModal — small
//     duplication kept rather than creating a one-off shared file). ───

const btnGhostStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid #36363A",
  borderRadius: 8,
  color: "rgba(255,255,255,0.85)",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 120ms ease-out, border-color 120ms ease-out",
};

const btnPrimaryStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  background: "#108CE9",
  border: "1px solid #108CE9",
  borderRadius: 8,
  color: "white",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
