"use client";

import { useState } from "react";
import { FileCard } from "@/components/files/FileCard";
import { FilePreview } from "@/components/files/FilePreview";
import { triggerFileDownload } from "@/lib/file-signed-url";
import type { FileItem } from "@/lib/pipeline-files-data";

/**
 * Client-portal Files tab body. Phase 4b-3-c (the last 4b-3 piece).
 *
 * Consume-only counterpart to the agency-side `FilesBody`. The same
 * `FileCard` is reused with `canEdit={false}` so the Eye (visibility
 * toggle) and Trash buttons never enter the render tree; the Download
 * button stays visible for kind='file' rows because clients need to
 * download.
 *
 * ─── WHAT THIS COMPONENT INTENTIONALLY DOES NOT HAVE ────────────────
 *
 * No upload input, no drag-and-drop handlers, no AddLinkModal import,
 * no visibility toggle handler, no delete confirm. Defense-in-depth:
 *
 *   1. Render layer — this file. Nothing edit-related is even in the
 *      JSX tree; a compromised React build can't surface UI that
 *      doesn't exist here.
 *   2. Prop gate — FileCard's `canEdit={false}` removes the Eye / Trash
 *      buttons at the component level.
 *   3. RLS — pipeline_links_insert / _update / _delete all require
 *      is_pipeline_agency_member. A client crafting a direct API call
 *      gets 0 rows / 403. Storage bucket policies match.
 *
 * ─── DATA FLOW ─────────────────────────────────────────────────────
 *
 * Server fetches initial files via `fetchPipelineFiles` — RLS auto-
 * filters to client_visible=true rows for client viewers via
 * pipeline_links_select. The list is static after mount (no realtime
 * subscription, no optimistic mutation — clients don't mutate). If
 * the agency adds a new file or flips visibility, the client sees it
 * on the next page load.
 *
 * Uploader avatars on each card: profile reads succeed via the
 * profiles_select branches 5 (users_share_pipeline) and 6
 * (caller_pipeline_in_workspace_owned_by) added in migrations
 * 20260527120000 / 20260529120000. If a profile is unreadable (RLS
 * denies for an unexpected relationship OR the user was deleted),
 * `added_by_profile` is null and the card renders the "Pending
 * member" placeholder — same fallback pattern chat uses.
 *
 * ─── PREVIEW / DOWNLOAD DISPATCH ───────────────────────────────────
 *
 * Card-click handler mirrors the agency `handleRowClick`:
 *   * kind='url' → window.open(normalized URL, _blank, noopener)
 *   * kind='file' + image/* → opens FilePreview lightbox
 *   * kind='file' + application/pdf → opens FilePreview pdf modal
 *   * kind='file' + other → triggers download via signed-URL helper
 *
 * URL normalization (https:// prefix for bare domains) is already
 * applied by FileCard's favicon path and at the click site here, so
 * legacy bare-domain rows still open correctly.
 */

type Props = {
  /** Files list — pre-fetched server-side via fetchPipelineFiles.
   *  Already RLS-filtered to client_visible=true rows for client
   *  viewers; no additional client-side filter needed. */
  files: FileItem[];
  /** Caller's user_id. Threaded into FileCard for the "(You)" suffix
   *  on uploader names — in practice clients aren't uploaders today,
   *  but keeping the prop wired means a future "client uploads"
   *  feature wouldn't require re-threading this. */
  viewerId: string;
};

type PreviewState =
  | { type: "image"; row: FileItem }
  | { type: "pdf"; row: FileItem }
  | null;

export function PortalFilesBody({ files, viewerId }: Props) {
  const [preview, setPreview] = useState<PreviewState>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Card-click dispatch — mirrors agency FilesBody.handleRowClick but
  // without any edit branches (no delete handler, no toggle).
  const handleRowClick = async (row: FileItem) => {
    if (row.kind === "url") {
      if (row.url) {
        // Defensive: normalize-url is already applied at save time on
        // the agency side, but rows created before that fix landed
        // may be bare domains. Lazy-import the helper to keep the
        // hot-path code small; window.open is fine without await.
        const { normalizeUrl } = await import("@/lib/normalize-url");
        const target = normalizeUrl(row.url);
        if (target) window.open(target, "_blank", "noopener,noreferrer");
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
    // Other types → download.
    const { error } = await triggerFileDownload(
      row.storage_path,
      row.file_name,
    );
    if (error) setInlineError("Couldn't download. Try again.");
  };

  // Explicit Download button (always-visible per row for kind='file').
  // Same helper, single error surface as the row-click fallback.
  const handleDownload = async (row: FileItem) => {
    if (row.kind !== "file" || !row.storage_path) return;
    const { error } = await triggerFileDownload(
      row.storage_path,
      row.file_name,
    );
    if (error) setInlineError("Couldn't download. Try again.");
  };

  // No-op handlers passed to FileCard for the edit-only props. canEdit
  // is false so the buttons that would invoke these never render; we
  // pass stubs to satisfy the FileCard prop contract without a wider
  // type change. (Making the props optional in FileCard would touch
  // agency code — out of scope for 4b-3-c per the user's instructions.)
  const noopToggle = () => {};
  const noopDelete = () => {};

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
      {/* Header — title + item count. No right-side button cluster
          (no Upload, no Add link) — clients are consume-only. */}
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
      </header>

      {/* Inline error — only path that triggers it is a failed
          signed-URL download. Dismissible by clicking. */}
      {inlineError && (
        <div
          role="alert"
          onClick={() => setInlineError(null)}
          style={{
            margin: "12px 28px 0",
            padding: "10px 14px",
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.3)",
            borderRadius: 8,
            fontSize: 13,
            color: "#F43F5E",
            cursor: "pointer",
          }}
        >
          {inlineError}
        </div>
      )}

      {/* Grid / empty state — no drag-and-drop wrapper (clients don't
          upload). Same min-360px grid as the agency surface. */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 28px 24px",
        }}
      >
        {files.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            {files.map((row) => (
              <FileCard
                key={row.id}
                row={row}
                // ─── LOCKED: clients never see edit affordances.
                // Eye / Trash are gated on this; Download stays
                // visible for kind='file' regardless. RLS is the
                // ultimate enforcer — this is the render-layer half
                // of the defense-in-depth.
                canEdit={false}
                viewerId={viewerId}
                onToggleVisibility={noopToggle}
                onRequestDelete={noopDelete}
                onClick={handleRowClick}
                onDownload={handleDownload}
              />
            ))}
          </div>
        )}
      </div>

      {/* Preview modal — image lightbox / pdf iframe, ESC + backdrop
          to close. Shared with the agency surface; no client-specific
          variant needed. */}
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

/**
 * Client-side empty state. Passive copy — no call to action because
 * clients can't add files. Distinct from the agency EmptyState which
 * prompts "Upload a file or attach a link…".
 */
function EmptyState() {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        gap: 6,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "rgba(255,255,255,0.75)",
        }}
      >
        No files shared yet
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.45)",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        Documents, images, and links shared by your agency will appear here.
      </div>
    </div>
  );
}
