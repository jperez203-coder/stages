"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import {
  Download,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  Maximize2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AddLinkModal } from "@/components/files/AddLinkModal";
import { FilePreview } from "@/components/files/FilePreview";
import { buildStoragePath } from "@/lib/build-storage-path";
import { triggerFileDownload } from "@/lib/file-signed-url";
import { normalizeUrl } from "@/lib/normalize-url";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";
import type { FileItem, UploaderProfile } from "@/lib/pipeline-files-data";

/**
 * Client-side task attachments — the portal counterpart to the agency
 * TaskAttachmentsSection (src/components/canvas/TaskDetailPanel.tsx).
 * Phase: portal task attachments slice 2.
 *
 * ─── A STRIPPED FORK, NOT A SHARE ──────────────────────────────────
 *   Deliberately forked rather than shared with the agency component
 *   (same rationale PortalTaskDetailPanel cites for not wrapping the
 *   agency panel): the agency surface will grow agency-only powers
 *   (visibility toggles, role assignment) that must never bleed into
 *   the client surface. Forking keeps the client constraints
 *   declarative instead of conditional spaghetti.
 *
 * Three deltas vs. the agency version:
 *   1. Every insert forces client_visible = true (RLS + the
 *      enforce_client_pipeline_link_insert_scope trigger require it for
 *      client rows anyway; the UI mirrors that — no toggle path exists).
 *   2. NO visibility-toggle ("eye") affordance. Clients have no business
 *      flipping agency visibility, and pipeline_links_update would 403.
 *   3. Delete is per-row, shown ONLY for rows the current client
 *      uploaded (added_by === viewerId) — matching the pipeline_links
 *      DELETE policy's added_by branch. Agency-uploaded rows are
 *      read-only to the client.
 *
 * Context resolution (self-contained, no prop drilling through
 * PortalCanvas / the page):
 *   * pipelineId ← useParams (route is /portal/[pipeline-id]).
 *   * viewerId   ← useSession (the authed client's user id), needed for
 *     added_by + the delete-own gate.
 *
 * RLS perimeter is already open for clients (pipeline_links_insert
 * client branch with kind in file|url, client_visible=true,
 * added_by=self — migration 20260603120000; storage insert allows
 * is_pipeline_client). This is a UI-only addition — no migration.
 */

type TaskAttachmentItem = FileItem & { status?: "uploading" };
type AttachmentPreview = { type: "image" | "pdf"; row: FileItem } | null;
type AttachmentDelete = { id: string; label: string } | null;

const SELECT_COLS =
  "id, kind, label, url, storage_path, file_name, file_size, mime_type, client_visible, added_by, added_at, task_id";

// Log PostgrestError fields explicitly — logging the bare object
// serializes to {} (non-enumerable own-props), which hid the real
// reason in the chat-send bug. Keep diagnostics legible.
function logPgError(scope: string, error: unknown) {
  const e = error as
    | { message?: string; code?: string; details?: string; hint?: string }
    | null
    | undefined;
  console.error(
    `[portal-task-attachments] ${scope}:`,
    e?.message,
    "code:",
    e?.code,
    "details:",
    e?.details,
    "hint:",
    e?.hint,
  );
}

export function PortalTaskAttachmentsSection({ taskId }: { taskId: string }) {
  const params = useParams();
  const session = useSession();
  const pipelineId =
    typeof params?.["pipeline-id"] === "string"
      ? (params["pipeline-id"] as string)
      : null;
  const viewerId =
    session.status === "authenticated" ? session.user.id : null;

  const [files, setFiles] = useState<TaskAttachmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [showAddLink, setShowAddLink] = useState(false);
  const [showDelete, setShowDelete] = useState<AttachmentDelete>(null);
  const [preview, setPreview] = useState<AttachmentPreview>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  // ── Lazy fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!pipelineId) return;
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    void (async () => {
      const { data, error: fetchErr } = await supabase
        .from("pipeline_links")
        .select(SELECT_COLS)
        .eq("pipeline_id", pipelineId)
        .eq("task_id", taskId)
        .order("added_at", { ascending: false });

      if (cancelled) return;
      if (fetchErr) {
        logPgError("fetch failed", fetchErr);
        setFetchError("Couldn't load attachments.");
        setLoading(false);
        return;
      }

      const rawRows = (data ?? []) as Array<
        Omit<FileItem, "added_by_profile" | "task_title">
      >;

      const uploaderIds = Array.from(
        new Set(
          rawRows
            .map((r) => r.added_by)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const profilesRes = uploaderIds.length
        ? await supabase
            .from("profiles")
            .select("id, display_name, avatar_url, email")
            .in("id", uploaderIds)
        : { data: [], error: null };
      if (cancelled) return;
      if (profilesRes.error) {
        logPgError("profile fetch failed", profilesRes.error);
      }
      const profileById = new Map<string, UploaderProfile>();
      for (const p of (profilesRes.data ?? []) as UploaderProfile[]) {
        profileById.set(p.id, p);
      }

      const items: TaskAttachmentItem[] = rawRows.map((r) => ({
        ...r,
        added_by_profile: r.added_by
          ? (profileById.get(r.added_by) ?? null)
          : null,
        task_title: null,
      }));
      setFiles(items);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineId, taskId]);

  // ── Upload (single file) ────────────────────────────────────────────
  const uploadFile = useCallback(
    async (file: File) => {
      if (!pipelineId || !viewerId) return;
      setInlineError(null);
      const storagePath = buildStoragePath(pipelineId, file.name);
      const tempId = crypto.randomUUID();
      const mimeType = file.type || null;

      const optimistic: TaskAttachmentItem = {
        id: tempId,
        kind: "file",
        label: null,
        url: null,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: mimeType,
        // DELTA 1: clients always upload client_visible=true.
        client_visible: true,
        added_by: viewerId,
        added_by_profile: null,
        added_at: new Date().toISOString(),
        task_id: taskId,
        task_title: null,
        status: "uploading",
      };
      setFiles((prev) => [optimistic, ...prev]);

      const { error: uploadErr } = await supabase.storage
        .from("pipeline_files")
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (uploadErr) {
        logPgError("storage upload failed", uploadErr);
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Upload failed. Try again.");
        return;
      }

      const { data: row, error: insertErr } = await supabase
        .from("pipeline_links")
        .insert({
          pipeline_id: pipelineId,
          task_id: taskId,
          kind: "file",
          label: null,
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: mimeType,
          added_by: viewerId,
          client_visible: true, // DELTA 1
        })
        .select(SELECT_COLS)
        .single();

      if (insertErr || !row) {
        logPgError("metadata insert failed", insertErr);
        const { error: cleanupErr } = await supabase.storage
          .from("pipeline_files")
          .remove([storagePath]);
        if (cleanupErr) {
          logPgError("orphan cleanup ALSO failed", cleanupErr);
        }
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Couldn't save attachment. Try again.");
        return;
      }

      const enriched: FileItem = {
        ...(row as Omit<FileItem, "added_by_profile" | "task_title">),
        added_by_profile: null,
        task_title: null,
      };
      setFiles((prev) => prev.map((f) => (f.id === tempId ? enriched : f)));
    },
    [pipelineId, taskId, viewerId],
  );

  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      void uploadFile(file);
    },
    [uploadFile],
  );

  // ── Drag-and-drop (always enabled for the client) ──────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragActive(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length === 0) return;
      for (const file of dropped) {
        void uploadFile(file);
      }
    },
    [uploadFile],
  );

  // ── Add link ─────────────────────────────────────────────────────────
  const handleAddLink = useCallback(
    async (label: string, url: string) => {
      if (!pipelineId || !viewerId) return;
      const { data: row, error } = await supabase
        .from("pipeline_links")
        .insert({
          pipeline_id: pipelineId,
          task_id: taskId,
          kind: "url",
          label,
          url,
          added_by: viewerId,
          client_visible: true, // DELTA 1
        })
        .select(SELECT_COLS)
        .single();

      if (error || !row) {
        logPgError("add link failed", error);
        throw new Error(error?.message ?? "Insert failed");
      }

      const enriched: FileItem = {
        ...(row as Omit<FileItem, "added_by_profile" | "task_title">),
        added_by_profile: null,
        task_title: null,
      };
      setFiles((prev) => [enriched, ...prev]);
      setShowAddLink(false);
    },
    [pipelineId, taskId, viewerId],
  );

  // ── Delete (after confirm) — own rows only ──────────────────────────
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
        logPgError("metadata delete failed", metaErr);
        setFiles(snapshot);
        setInlineError("Couldn't delete. Try again.");
        return;
      }

      if (row.kind === "file" && row.storage_path) {
        const { error: storageErr } = await supabase.storage
          .from("pipeline_files")
          .remove([row.storage_path]);
        if (storageErr) {
          logPgError("storage delete failed (orphan left)", storageErr);
        }
      }
    },
    [files],
  );

  // ── Row dispatch (preview / download / open) ────────────────────────
  const handleRowClick = useCallback(async (row: FileItem) => {
    if (row.kind === "url") {
      const target = row.url ? normalizeUrl(row.url) : null;
      if (target) window.open(target, "_blank", "noopener,noreferrer");
      return;
    }
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
    const { error } = await triggerFileDownload(row.storage_path, row.file_name);
    if (error) setInlineError("Couldn't download. Try again.");
  }, []);

  const handleDownload = useCallback(async (row: FileItem) => {
    if (row.kind !== "file" || !row.storage_path) return;
    const { error } = await triggerFileDownload(row.storage_path, row.file_name);
    if (error) setInlineError("Couldn't download. Try again.");
  }, []);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
        Attachments
      </h3>

      {/* Action row — always available to the client. */}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={attachmentBtnStyle}
        >
          <Upload size={12} />
          Upload
        </button>
        <button
          type="button"
          onClick={() => setShowAddLink(true)}
          style={attachmentBtnStyle}
        >
          <LinkIcon size={12} />
          Add link
        </button>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFilePick}
          style={{ display: "none" }}
        />
      </div>

      {(inlineError || fetchError) && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.3)",
            borderRadius: 6,
            fontSize: 12,
            color: "#F43F5E",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{inlineError ?? fetchError}</span>
          {inlineError && (
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
              <X size={12} />
            </button>
          )}
        </div>
      )}

      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          position: "relative",
          minHeight: 64,
          padding: 4,
          border: `1.5px dashed ${dragActive ? "#108CE9" : "transparent"}`,
          borderRadius: 8,
          transition: "border-color 120ms ease-out, background 120ms ease-out",
          background: dragActive ? "rgba(16,140,233,0.04)" : "transparent",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {loading ? (
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              padding: "8px 4px",
            }}
          >
            Loading…
          </div>
        ) : files.length === 0 ? (
          <div
            style={{
              padding: "12px 10px",
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(255,255,255,0.12)",
              borderRadius: 6,
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              textAlign: "center",
            }}
          >
            Drop a file here, or use Upload / Add link.
          </div>
        ) : (
          files.map((row) => (
            <PortalAttachmentRow
              key={row.id}
              row={row}
              canDelete={row.added_by === viewerId}
              onRequestDelete={(id) => {
                const r = files.find((f) => f.id === id);
                const label = r?.label ?? r?.file_name ?? "this item";
                setShowDelete({ id, label });
              }}
              onClick={handleRowClick}
              onDownload={handleDownload}
            />
          ))
        )}

        {dragActive && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <div
              style={{
                padding: "8px 14px",
                background: "rgba(16,140,233,0.18)",
                border: "1px solid #108CE9",
                borderRadius: 999,
                color: "#108CE9",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Drop to upload
            </div>
          </div>
        )}
      </div>

      {showAddLink && (
        <AddLinkModal
          onCancel={() => setShowAddLink(false)}
          onSave={handleAddLink}
        />
      )}
      {showDelete && (
        <PortalAttachmentDeleteConfirm
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
    </section>
  );
}

// Compact one-line attachment row — same shape as the agency
// TaskAttachmentRow but WITHOUT the visibility-toggle (eye) affordance.
// The delete button shows only when the caller passes canDelete (the
// client uploaded this row).
function PortalAttachmentRow({
  row,
  canDelete,
  onRequestDelete,
  onClick,
  onDownload,
}: {
  row: TaskAttachmentItem;
  canDelete: boolean;
  onRequestDelete: (id: string) => void;
  onClick: (row: FileItem) => void;
  onDownload: (row: FileItem) => void;
}) {
  const isUploading = row.status === "uploading";
  const mime = row.mime_type ?? "";
  const isImage = row.kind === "file" && mime.startsWith("image/");
  const isPdf = row.kind === "file" && mime === "application/pdf";
  const isPreviewable = isImage || isPdf;

  const iconSrc = pickRowIcon(row);
  const displayLabel =
    row.label?.trim() ||
    row.file_name ||
    (row.kind === "url" ? row.url : null) ||
    "Untitled";
  const typeText = rowTypeLabel(row);

  return (
    <div
      onClick={() => {
        if (!isUploading) onClick(row);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: "#212124",
        border: "1px solid #2A2A2D",
        borderRadius: 6,
        cursor: isUploading ? "wait" : "pointer",
        opacity: isUploading ? 0.7 : 1,
        transition: "border-color 120ms ease-out, background 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!isUploading) e.currentTarget.style.borderColor = "#3A3A3E";
      }}
      onMouseLeave={(e) => {
        if (!isUploading) e.currentTarget.style.borderColor = "#2A2A2D";
      }}
    >
      <Image src={iconSrc} alt="" width={22} height={22} style={{ flexShrink: 0 }} />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <span
          title={displayLabel ?? undefined}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "white",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.3,
          }}
        >
          {displayLabel}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "rgba(255,255,255,0.5)",
            lineHeight: 1.2,
          }}
        >
          {typeText}
        </span>
      </div>

      {isUploading ? (
        <Loader2
          size={16}
          color="rgba(255,255,255,0.6)"
          style={{
            flexShrink: 0,
            animation: "portalAttachmentSpin 1s linear infinite",
          }}
        />
      ) : (
        <div
          style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (row.kind === "file" && !isPreviewable) {
                onDownload(row);
              } else {
                onClick(row);
              }
            }}
            aria-label={
              row.kind === "url"
                ? `Open "${displayLabel}" in new tab`
                : isPreviewable
                  ? `Preview "${displayLabel}"`
                  : `Download "${displayLabel}"`
            }
            title={
              row.kind === "url" ? "Open" : isPreviewable ? "Preview" : "Download"
            }
            style={rowIconBtnStyle}
          >
            {row.kind === "url" ? (
              <ExternalLink size={13} color="rgba(255,255,255,0.65)" />
            ) : isPreviewable ? (
              <Maximize2 size={13} color="rgba(255,255,255,0.65)" />
            ) : (
              <Download size={13} color="rgba(255,255,255,0.65)" />
            )}
          </button>

          {/* DELTA 3: delete only for rows this client uploaded.
              No eye/visibility toggle (DELTA 2 — absent entirely). */}
          {canDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(row.id);
              }}
              aria-label={`Delete "${displayLabel}"`}
              title="Delete"
              style={rowIconBtnStyle}
            >
              <Trash2 size={13} color="rgba(255,255,255,0.55)" />
            </button>
          )}
        </div>
      )}

      <style>{`
        @keyframes portalAttachmentSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function pickRowIcon(row: FileItem): string {
  if (row.kind === "url") return "/icons/file-link.svg";
  const mime = row.mime_type ?? "";
  if (mime.startsWith("image/")) return "/icons/file-image.svg";
  if (mime === "application/pdf") return "/icons/file-pdf.svg";
  if (mime.startsWith("video/")) return "/icons/file-video.svg";
  return "/icons/file-pdf.svg";
}

function rowTypeLabel(row: FileItem): string {
  if (row.kind === "url") return "Link";
  const mime = row.mime_type ?? "";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  const fn = row.file_name ?? "";
  const dotIdx = fn.lastIndexOf(".");
  if (dotIdx > 0) {
    const ext = fn.slice(dotIdx + 1).toUpperCase();
    if (ext.length > 0 && ext.length <= 6) return ext;
  }
  return "File";
}

const rowIconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 5,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid #36363A",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
  transition: "background 120ms ease-out, border-color 120ms ease-out",
};

const attachmentBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid #36363A",
  borderRadius: 6,
  color: "rgba(255,255,255,0.85)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 120ms ease-out, border-color 120ms ease-out",
};

function PortalAttachmentDeleteConfirm({
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
          <button
            type="button"
            onClick={onCancel}
            style={{ ...attachmentBtnStyle, padding: "8px 14px" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              background: "#F43F5E",
              border: "1px solid #F43F5E",
              borderRadius: 8,
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
