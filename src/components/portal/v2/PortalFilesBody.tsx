"use client";

import { useCallback, useRef, useState } from "react";
import { Link as LinkIcon, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildStoragePath } from "@/lib/build-storage-path";
import { triggerFileDownload } from "@/lib/file-signed-url";
import { normalizeUrl } from "@/lib/normalize-url";
import { AddLinkModal } from "@/components/files/AddLinkModal";
import { FileCard } from "@/components/files/FileCard";
import { FilePreview } from "@/components/files/FilePreview";
import type { FileItem, UploaderProfile } from "@/lib/pipeline-files-data";

/**
 * Client-portal Files tab body. Phase 4b-3-d added CLIENT UPLOAD on
 * top of the read-only base from 4b-3-c. Phase 4b-3-e added CLIENT
 * LINKS (kind='url') after relaxing the kind='file' lock on the
 * client INSERT path (migration 20260603120000).
 *
 * ─── WHAT CLIENTS CAN DO ON THIS SURFACE ────────────────────────────
 *
 *   * View / preview / download anything client_visible=true the
 *     agency has shared.
 *   * UPLOAD files via the Upload button or drag-and-drop. Every
 *     upload is automatically client_visible=true (RLS+trigger
 *     enforce; the UI just mirrors).
 *   * ADD LINKS via the Add link button. Same client_visible=true +
 *     added_by=self lock as uploads. URL is normalized at save time
 *     by AddLinkModal (https:// prefix on bare domains).
 *   * DELETE rows they themselves uploaded OR linked
 *     (added_by === viewerId). RLS policy pipeline_links_delete
 *     already allows `added_by = auth.uid()`; the same branch covers
 *     both kinds.
 *
 * ─── WHAT CLIENTS STILL CANNOT DO (UI MIRRORS RLS) ──────────────────
 *
 *   * Toggle client_visible — pipeline_links_update policy still
 *     requires can_edit_pipeline. FileCard's eye button is hidden
 *     here via `canToggleVisibility={false}` (separate gate from
 *     canEdit so delete-own can be enabled without re-enabling eye).
 *   * Delete OR edit anyone else's row — `canEdit` is set to
 *     `row.added_by === viewerId`, so the Trash never renders on
 *     rows Casey didn't add herself. RLS would also reject the
 *     DELETE even if the button were clicked.
 *   * Edit existing rows of their own (label/URL) —
 *     pipeline_links_update policy still requires can_edit_pipeline.
 *     Workaround: delete-then-re-add. No inline edit affordance.
 *
 * ─── UPLOAD HELPER — FORKED (NOT SHARED) ────────────────────────────
 *
 * The uploadFile / drag-and-drop / file-picker code below is a FORK
 * of the agency-side implementation in
 *   src/app/w/(canvas)/[slug]/p/[pipeline-id]/files/FilesBody.tsx
 *
 * Differences from the agency version:
 *   1. `client_visible: true` on both the optimistic row AND the
 *      INSERT body (agency uses false; the policy+trigger reject
 *      false from a client, so the UI must mirror).
 *   2. `added_by: viewerId` is hardcoded to the calling client
 *      (agency takes it from viewerId too, but the meaning shifts:
 *      here it's "the client who uploaded," used by delete-own).
 *   3. No `canEditPipeline` gate on Upload / drag-drop — the surface
 *      is client-only and clients always have the affordance here.
 *      (The agency version gates because pipeline members without
 *      can_edit_pipeline shouldn't see Upload either.)
 *
 * Tech debt logged in PROGRESS.md (4b-3-d entry): if either upload
 * path acquires a non-trivial bug, that's the trigger to extract a
 * shared useFileUpload(pipelineId, { forceClientVisible }) hook. For
 * now the duplication is the lesser risk vs. destabilizing
 * prod-verified agency upload.
 *
 * ─── DELETE FLOW — METADATA FIRST, STORAGE SECOND ───────────────────
 *
 * Matches the agency pattern in FilesBody.handleDelete: delete the
 * metadata row first (RLS allows via added_by=auth.uid()), then
 * best-effort storage delete. Documented trade-off: if storage
 * delete fails after metadata succeeded, the bytes orphan in the
 * bucket — privacy-safe (no joined row → RLS SELECT denies), just
 * bucket bloat. Inverting the order risks a broken-metadata
 * worst-case (row present, file 404 on preview) which is worse UX.
 *
 * Side note for future me: Casey's storage DELETE inherently silently
 * 0-affects if it runs after metadata is gone, because the policy
 * requires the joined row to evaluate added_by = auth.uid(). The
 * orphan accumulation rate is one-per-deleted-file. Same behavior
 * the agency surface accepts; janitor pass deferred to v1.1.
 */

type Props = {
  /** Initial files list — pre-fetched server-side via fetchPipelineFiles.
   *  Already RLS-filtered to client_visible=true rows. Local state below
   *  takes over after mount so uploads / deletes can apply optimistically. */
  initialFiles: FileItem[];
  /** Caller's user_id. Threaded into FileCard for the "(You)" suffix on
   *  uploader names AND used as the gate for delete-own (canEdit ==
   *  row.added_by === viewerId). */
  viewerId: string;
  /** Caller's own profile (display_name + avatar). Used to enrich
   *  `added_by_profile` on freshly-inserted rows so the optimistic
   *  card shows the client's real name immediately instead of the
   *  "Pending member" fallback that would show until next page reload.
   *  Server-fetched in page.tsx via profiles_select branch 1
   *  (`id = auth.uid()`). Always carries `id` even when downstream
   *  fields are null — the reconcile branches match by id alone. */
  viewerProfile: UploaderProfile;
  /** Required for the upload INSERT. Storage path is built with
   *  buildStoragePath(pipelineId, fileName) — first folder segment must
   *  be the pipeline UUID per the storage RLS policy AND the table-level
   *  CHECK constraint pipeline_links_storage_path_matches_pipeline. */
  pipelineId: string;
};

type OptimisticStatus = "uploading";
type RowWithStatus = FileItem & { status?: OptimisticStatus };

type PreviewState =
  | { type: "image"; row: FileItem }
  | { type: "pdf"; row: FileItem }
  | null;

const SELECT_COLS =
  "id, kind, label, url, storage_path, file_name, file_size, mime_type, client_visible, added_by, added_at, task_id";

export function PortalFilesBody({
  initialFiles,
  viewerId,
  viewerProfile,
  pipelineId,
}: Props) {
  const [files, setFiles] = useState<RowWithStatus[]>(initialFiles);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState<{ id: string; label: string } | null>(null);
  const [showAddLink, setShowAddLink] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Drag-and-drop bookkeeping. Same dragCounterRef pattern as the
  // agency surface — dragenter/leave fire on every child boundary, so
  // a naive bool would flicker. Depth counter only flips state at the
  // outer boundary.
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  // ── Upload (FORK — see header comment for diffs vs agency) ─────────
  const uploadFile = useCallback(
    async (file: File) => {
      setInlineError(null);
      const storagePath = buildStoragePath(pipelineId, file.name);
      const tempId = crypto.randomUUID();
      const mimeType = file.type || null;

      // Optimistic — row shows immediately with a spinner.
      // client_visible: true matches what we'll INSERT; the RLS+trigger
      // would reject `false` anyway (P0001 "Clients must upload with
      // client_visible = true.").
      const optimistic: RowWithStatus = {
        id: tempId,
        kind: "file",
        label: null,
        url: null,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: mimeType,
        client_visible: true,
        added_by: viewerId,
        // Inject the caller's own profile so the optimistic row shows
        // "Casey Client (You)" with her avatar during the upload
        // spinner — instead of "Pending member (You)" flashing for a
        // few hundred ms until reconcile. added_by is hardcoded to
        // viewerId above, so the conditional below is always-true
        // here; spelled out as a conditional anyway for symmetry with
        // the post-INSERT reconcile sites.
        added_by_profile:
          viewerId === viewerProfile.id ? viewerProfile : null,
        added_at: new Date().toISOString(),
        task_id: null,
        task_title: null,
        status: "uploading",
      };
      setFiles((prev) => [optimistic, ...prev]);

      // 1. Storage upload.
      const { error: uploadErr } = await supabase
        .storage
        .from("pipeline_files")
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (uploadErr) {
        console.error(
          "[portal-files] storage upload failed:",
          uploadErr?.message,
        );
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Upload failed. Try again.");
        return;
      }

      // 2. Metadata INSERT. The RLS WITH CHECK (policy from migration
      // 20260601120000) requires kind='file', added_by=auth.uid(), and
      // client_visible=true on the client branch — all satisfied below.
      // The CHECK constraint from 20260602120000 also requires
      // storage_path to start with pipeline_id, which buildStoragePath
      // guarantees.
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
          client_visible: true,
        })
        .select(SELECT_COLS)
        .single();

      // 3. INSERT failure → orphan cleanup (best-effort).
      if (insertErr || !row) {
        console.error(
          "[portal-files] metadata insert failed:",
          insertErr?.message,
          "code:",
          insertErr?.code,
          "details:",
          insertErr?.details,
          "hint:",
          insertErr?.hint,
        );
        const { error: cleanupErr } = await supabase
          .storage
          .from("pipeline_files")
          .remove([storagePath]);
        if (cleanupErr) {
          // Orphan accepted — no joined row, so RLS SELECT denies it.
          // Same posture as the agency upload helper.
          console.error(
            "[portal-files] orphan cleanup ALSO failed — invisible bytes left in bucket:",
            cleanupErr?.message,
          );
        }
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Couldn't save file. Try again.");
        return;
      }

      // 4. Reconcile — swap optimistic row for the server row.
      // Match by added_by so the joined profile carries through; the
      // conditional is defensive (clients always upload as themselves
      // today, but checking id keeps this correct if a future code
      // path inserts on someone else's behalf).
      const enriched: FileItem = {
        ...(row as Omit<FileItem, "added_by_profile" | "task_title">),
        added_by_profile:
          row.added_by === viewerProfile.id ? viewerProfile : null,
        task_title: null,
      };
      setFiles((prev) => prev.map((f) => (f.id === tempId ? enriched : f)));
    },
    [pipelineId, viewerId, viewerProfile],
  );

  // Hidden file-input → file picker change event.
  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      void uploadFile(file);
    },
    [uploadFile],
  );

  // ── Drag-and-drop (no canEdit gate — clients always have upload here)
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
      for (const file of dropped) void uploadFile(file);
    },
    [uploadFile],
  );

  // ── Add link (FORK — see header for fork rationale) ────────────────
  // Forked from the agency FilesBody.handleAddLink with two changes:
  //   * client_visible: true is hardcoded (agency uses false; the
  //     policy+trigger reject false from a client per migration
  //     20260601120000, so the UI must match).
  //   * added_by: viewerId is also hardcoded (same shape as the upload
  //     helper above; ensures delete-own works for the new row).
  // AddLinkModal itself is shared with agency — it already normalizes
  // the URL (https:// prefix on bare domains) at save time via
  // lib/normalize-url. We don't re-normalize here.
  // The modal's onSave is async; it catches a throw and re-opens with
  // an inline error. We throw on failure rather than swallowing.
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
          client_visible: true,
        })
        .select(SELECT_COLS)
        .single();

      if (error || !row) {
        console.error(
          "[portal-files] add link failed:",
          error?.message,
          "code:",
          error?.code,
          "details:",
          error?.details,
          "hint:",
          error?.hint,
        );
        // Re-throw so the modal surfaces an inline error and stays open
        // for the user to retry / correct the URL.
        throw new Error(error?.message ?? "Insert failed");
      }

      // Hydrate the joined uploader profile from the caller's own
      // record so the new link card shows "Casey Client (You)" with
      // her avatar immediately instead of "Pending member (You)" until
      // the next page reload. Conditional match on added_by is
      // defensive — client inserts always set added_by=self, but
      // keying by id keeps this correct if a future code path inserts
      // on someone else's behalf.
      const enriched: FileItem = {
        ...(row as Omit<FileItem, "added_by_profile" | "task_title">),
        added_by_profile:
          row.added_by === viewerProfile.id ? viewerProfile : null,
        task_title: null,
      };
      setFiles((prev) => [enriched, ...prev]);
      setShowAddLink(false);
    },
    [pipelineId, viewerId, viewerProfile],
  );

  // ── Delete-own (RLS allows via added_by = auth.uid()) ───────────────
  const handleDelete = useCallback(
    async (id: string) => {
      const row = files.find((f) => f.id === id);
      if (!row) {
        setShowDelete(null);
        return;
      }
      // Defensive: only the row's uploader is allowed to delete from
      // the portal surface. (RLS also enforces; this is the UI mirror.)
      if (row.added_by !== viewerId) {
        setShowDelete(null);
        setInlineError("You can only delete files you uploaded.");
        return;
      }

      const snapshot = files;
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setShowDelete(null);

      // Metadata first, then storage — see header comment for the
      // orphan trade-off rationale (matches agency).
      const { error: metaErr } = await supabase
        .from("pipeline_links")
        .delete()
        .eq("id", id);

      if (metaErr) {
        console.error(
          "[portal-files] metadata delete failed:",
          metaErr?.message,
          "code:",
          metaErr?.code,
          "details:",
          metaErr?.details,
          "hint:",
          metaErr?.hint,
        );
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
          console.error(
            "[portal-files] storage delete failed — orphan left in bucket:",
            storageErr?.message,
          );
        }
      }
    },
    [files, viewerId],
  );

  // ── Row click — preview / download / open-link dispatch ─────────────
  const handleRowClick = useCallback(async (row: FileItem) => {
    if (row.kind === "url") {
      if (row.url) {
        const target = normalizeUrl(row.url);
        if (target) window.open(target, "_blank", "noopener,noreferrer");
      }
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

  // ── Explicit Download button (always-visible for kind='file') ───────
  const handleDownload = useCallback(async (row: FileItem) => {
    if (row.kind !== "file" || !row.storage_path) return;
    const { error } = await triggerFileDownload(row.storage_path, row.file_name);
    if (error) setInlineError("Couldn't download. Try again.");
  }, []);

  // No-op visibility toggle — FileCard's eye is hidden via
  // canToggleVisibility={false}, but the handler prop is required by
  // the component signature. Passing a noop keeps the prop contract
  // satisfied without an extra optional/required hoop.
  const noopToggle = useCallback(() => {}, []);

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
      {/* Header — title + count + Upload button. NO Add link button
          (per the kind='file' lock on the client INSERT path). */}
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
        <div style={{ display: "flex", gap: 8 }}>
          {/* Add link — ghost button, left of primary. Matches the
              agency layout (FilesBody.tsx header). */}
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
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFilePick}
            style={{ display: "none" }}
          />
        </div>
      </header>

      {/* Inline error — dismissible by clicking anywhere on it. */}
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

      {/* Grid / empty state — drag-and-drop attached to the container
          so dropping anywhere in the body triggers an upload, including
          on the empty state. */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 28px 24px",
          position: "relative",
          border: `2px dashed ${dragActive ? "#108CE9" : "transparent"}`,
          borderRadius: 12,
          transition: "border-color 120ms ease-out, background 120ms ease-out",
          background: dragActive ? "rgba(16,140,233,0.04)" : "transparent",
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
                // canEdit gates the Trash. Set true only for Casey's
                // OWN uploads — she can clean up her own mistakes
                // without touching agency files.
                canEdit={row.added_by === viewerId}
                // SEPARATE gate: visibility-toggle (eye) is hard-off
                // here regardless of canEdit. Defense-in-depth UI
                // mirror of the pipeline_links_update policy
                // (clients can't UPDATE rows; eye would no-op anyway,
                // but hiding the affordance prevents confusion).
                canToggleVisibility={false}
                viewerId={viewerId}
                onToggleVisibility={noopToggle}
                onRequestDelete={(id) => {
                  const r = files.find((f) => f.id === id);
                  const label = r?.label ?? r?.file_name ?? "this item";
                  setShowDelete({ id, label });
                }}
                onClick={handleRowClick}
                onDownload={handleDownload}
              />
            ))}
          </div>
        )}

        {/* Drop overlay — same treatment as the agency surface. */}
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
                padding: "12px 20px",
                background: "rgba(16,140,233,0.18)",
                border: "1px solid #108CE9",
                borderRadius: 999,
                color: "#108CE9",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Drop to upload
            </div>
          </div>
        )}
      </div>

      {/* Preview modal — image lightbox / pdf iframe, ESC + backdrop
          to close. Shared with the agency surface; no client variant. */}
      {preview && (
        <FilePreview
          type={preview.type}
          row={preview.row}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Delete confirm modal — for Casey's own rows only (gated above
          by canEdit=row.added_by===viewerId). Inline component instead
          of an import to avoid touching/sharing with agency code per
          the "fork, don't refactor" 4b-3-d directive. */}
      {showDelete && (
        <DeleteConfirm
          label={showDelete.label}
          onCancel={() => setShowDelete(null)}
          onConfirm={() => void handleDelete(showDelete.id)}
        />
      )}

      {/* Add link modal — shared with agency surface (lib component).
          handleAddLink hardcodes client_visible=true + added_by=viewerId
          so the RLS+trigger constraints from migration 20260601120000
          pass. URL is normalized at save time by AddLinkModal itself. */}
      {showAddLink && (
        <AddLinkModal
          onCancel={() => setShowAddLink(false)}
          onSave={handleAddLink}
        />
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

/**
 * Client-side empty state. Now mentions upload since clients have the
 * affordance in 4b-3-d. (Pre-4b-3-d copy was passive: "No files
 * shared yet" + "Documents shared by your agency will appear here.")
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
        No files yet
      </div>
      <div
        style={{
          fontSize: 13,
          color: "rgba(255,255,255,0.45)",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        Upload a file to share with your agency, or wait for them to share
        something with you.
      </div>
    </div>
  );
}

/**
 * Inline delete-confirm modal. Mirrors the agency surface's component
 * (FilesBody.tsx). Kept local rather than extracted to avoid creating
 * a shared file that would couple the two surfaces.
 */
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

// ─── Button styles (mirror agency surface) ────────────────────────────

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
