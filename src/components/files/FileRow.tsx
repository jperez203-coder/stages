"use client";

import Image from "next/image";
import { Download, Eye, EyeOff, Trash2, Loader2 } from "lucide-react";
import type { FileItem } from "@/lib/pipeline-files-data";

/**
 * One row in the pipeline files list. Phase 4b-3-b. Shared with the
 * portal Files tab in 4b-3-c — same component, different `canEdit`
 * gating per surface.
 *
 * Row layout:
 *   [type icon] [label / file_name + (size)]  [eye toggle] [trash] →
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ 📄  Brief.pdf  · 2.4 MB                       👁  🗑   │
 *   └────────────────────────────────────────────────────────┘
 *
 * Click anywhere on the row body → onClick (parent handles preview/
 * download dispatch). Eye + Trash buttons stop propagation so they
 * don't trigger the row click.
 *
 * Gating:
 *   * canEdit=true (uploader OR pipeline editor) → eye + trash visible
 *   * canEdit=false (e.g., portal client viewer) → eye + trash hidden
 *   * Server RLS enforces the same gate (pipeline_links_update and
 *     pipeline_links_delete both allow added_by OR can_edit_pipeline).
 *     UI gating is the cosmetic layer; DB is the truth.
 *
 * Optimistic-uploading rows render with a spinner instead of the
 * icon and ignore clicks. The parent passes status='uploading' on
 * the row during the upload window.
 */

type OptimisticStatus = "uploading";
type RowWithStatus = FileItem & { status?: OptimisticStatus };

type Props = {
  row: RowWithStatus;
  /** uploader OR pipeline-editor — gates the eye toggle + trash. The
   *  download button is NOT gated by this (clients in 4b-3-c still
   *  need to download — it's a read action, not an edit action). */
  canEdit: boolean;
  onToggleVisibility: (id: string, next: boolean) => void;
  onRequestDelete: (id: string) => void;
  onClick: (row: FileItem) => void;
  /** Download the file. Always available for kind='file' rows; not
   *  rendered for kind='url' (links open in a new tab via row click).
   *  Parent handles the signed-URL + anchor-click via the shared
   *  triggerFileDownload helper. */
  onDownload: (row: FileItem) => void;
};

export function FileRow({
  row,
  canEdit,
  onToggleVisibility,
  onRequestDelete,
  onClick,
  onDownload,
}: Props) {
  const isUploading = row.status === "uploading";
  const iconSrc = pickIcon(row);
  const displayLabel = resolveLabel(row);
  const sizeStr = row.file_size != null ? formatBytes(row.file_size) : null;

  return (
    <div
      onClick={() => {
        if (!isUploading) onClick(row);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "#2C2C2F",
        border: "1px solid #36363A",
        borderRadius: 10,
        cursor: isUploading ? "wait" : "pointer",
        opacity: isUploading ? 0.6 : 1,
        transition: "background 120ms ease-out, border-color 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!isUploading) {
          e.currentTarget.style.background = "#33333A";
          e.currentTarget.style.borderColor = "#4A4A50";
        }
      }}
      onMouseLeave={(e) => {
        if (!isUploading) {
          e.currentTarget.style.background = "#2C2C2F";
          e.currentTarget.style.borderColor = "#36363A";
        }
      }}
    >
      {/* Type icon (or spinner during upload). */}
      <div
        style={{
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isUploading ? (
          <Loader2
            size={18}
            color="rgba(255,255,255,0.6)"
            style={{ animation: "spin 1s linear infinite" }}
          />
        ) : (
          <Image
            src={iconSrc}
            alt=""
            width={24}
            height={24}
            style={{ opacity: 0.85 }}
          />
        )}
      </div>

      {/* Label + size */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "white",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayLabel}
        </div>
        {sizeStr && (
          <div
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.2,
            }}
          >
            {sizeStr}
          </div>
        )}
      </div>

      {/* Download button — kind='file' only (links don't have downloads;
          they open in a new tab via the row click). ALWAYS visible
          regardless of canEdit — clients in 4b-3-c need to download
          too; it's a read action, not an edit action. Stops
          propagation so the row click (which would trigger preview
          for images/pdfs OR a download fallback for other types)
          doesn't also fire. */}
      {row.kind === "file" && !isUploading && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownload(row);
          }}
          aria-label={`Download "${displayLabel}"`}
          title="Download"
          style={iconBtnStyle(false)}
        >
          <Download size={15} color="rgba(255,255,255,0.65)" />
        </button>
      )}

      {/* Eye toggle — only when canEdit. Filled eye = visible to
          client; slashed eye = hidden. */}
      {canEdit && !isUploading && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(row.id, !row.client_visible);
          }}
          aria-label={
            row.client_visible
              ? `Hide "${displayLabel}" from client`
              : `Show "${displayLabel}" to client`
          }
          aria-pressed={row.client_visible}
          title={
            row.client_visible ? "Visible to client" : "Hidden from client"
          }
          style={iconBtnStyle(row.client_visible)}
        >
          {row.client_visible ? (
            <Eye size={15} color="#15B981" />
          ) : (
            <EyeOff size={15} color="rgba(255,255,255,0.45)" />
          )}
        </button>
      )}

      {/* Delete — only when canEdit. Parent shows confirm dialog. */}
      {canEdit && !isUploading && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestDelete(row.id);
          }}
          aria-label={`Delete "${displayLabel}"`}
          title="Delete"
          style={iconBtnStyle(false)}
        >
          <Trash2 size={15} color="rgba(255,255,255,0.55)" />
        </button>
      )}

      {/* Inline keyframes — used only for the uploading spinner. */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function pickIcon(row: FileItem): string {
  if (row.kind === "url") return "/icons/file-link.svg";
  const mime = row.mime_type ?? "";
  if (mime.startsWith("image/")) return "/icons/file-image.svg";
  if (mime === "application/pdf") return "/icons/file-pdf.svg";
  // Fallback: any other file type uses the generic doc/pdf icon for
  // now. Per the 4b-3-b spec — extend with more icons later if we
  // ship a wider type matrix.
  return "/icons/file-pdf.svg";
}

function resolveLabel(row: FileItem): string {
  if (row.label && row.label.trim()) return row.label;
  if (row.file_name) return row.file_name;
  if (row.kind === "url" && row.url) return row.url;
  return "Untitled";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function iconBtnStyle(active: boolean): React.CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 6,
    background: active
      ? "rgba(21,185,129,0.10)"
      : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? "rgba(21,185,129,0.25)" : "#36363A"}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    transition: "background 120ms ease-out, border-color 120ms ease-out",
  };
}
