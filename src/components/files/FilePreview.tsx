"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { createPipelineFileSignedUrl } from "@/lib/file-signed-url";
import type { FileItem } from "@/lib/pipeline-files-data";

/**
 * Preview modal for pipeline files. Phase 4b-3-b. Shared with the
 * portal Files tab in 4b-3-c — same component, same lazy signed-URL
 * pattern, RLS-gated regardless of viewer.
 *
 * Renders only for `image/*` and `application/pdf` MIME types — other
 * file types trigger a direct download from the parent (no modal) +
 * external links open in a new tab (also no modal). The parent
 * (FilesBody) handles the dispatch and only mounts this when type is
 * 'image' or 'pdf'.
 *
 * Signed URL is fetched on mount with 1-hour TTL. Loading state shown
 * during the fetch (typically ~100-300ms). Error state if RLS denies
 * (shouldn't happen on agency surface; will happen on portal if a
 * client somehow obtained a path to an internal file — which is the
 * defense layer working as designed).
 *
 * Close paths: X button, ESC key, backdrop click.
 */

type Props = {
  type: "image" | "pdf";
  row: FileItem;
  onClose: () => void;
};

export function FilePreview({ type, row, onClose }: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazy signed-URL fetch on mount.
  useEffect(() => {
    if (!row.storage_path) {
      setError("Missing file path");
      return;
    }
    let cancelled = false;
    (async () => {
      const { signedUrl, error: urlErr } = await createPipelineFileSignedUrl(
        row.storage_path!,
      );
      if (cancelled) return;
      if (urlErr || !signedUrl) {
        setError("Couldn't load preview. Try again.");
        return;
      }
      setSignedUrl(signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.storage_path]);

  // ESC to close — matches the portal task panel + agency task panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const displayName = row.label ?? row.file_name ?? "Preview";

  return (
    <>
      {/* Inline @keyframes — small enough to colocate. */}
      <style>{`
        @keyframes filePreviewFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      <div
        onClick={onClose}
        role="dialog"
        aria-label={`Preview: ${displayName}`}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(4px)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          animation: "filePreviewFadeIn 160ms ease-out",
        }}
      >
        {/* Close button — top-right of the viewport, sits above the
            content. Stopping propagation here keeps backdrop clicks
            still closing while a deliberate close button is also
            obvious. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          aria-label="Close preview"
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            width: 36,
            height: 36,
            borderRadius: 8,
            background: "rgba(28,28,30,0.9)",
            border: "1px solid #36363A",
            color: "rgba(255,255,255,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 101,
          }}
        >
          <X size={18} />
        </button>

        {/* Content — stops propagation so clicking the preview itself
            doesn't trigger the backdrop close. */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {error && (
            <div
              style={{
                padding: 24,
                background: "#2C2C2F",
                border: "1px solid #36363A",
                borderRadius: 10,
                color: "rgba(255,255,255,0.7)",
                fontSize: 14,
              }}
            >
              {error}
            </div>
          )}

          {!signedUrl && !error && (
            <div
              style={{
                padding: 24,
                color: "rgba(255,255,255,0.5)",
                fontSize: 13,
              }}
            >
              Loading preview…
            </div>
          )}

          {signedUrl && type === "image" && (
            <Image
              src={signedUrl}
              alt={row.file_name ?? "Image preview"}
              width={0}
              height={0}
              sizes="100vw"
              unoptimized
              style={{
                width: "auto",
                height: "auto",
                maxWidth: "90vw",
                maxHeight: "85vh",
                objectFit: "contain",
                borderRadius: 8,
                boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
              }}
            />
          )}

          {signedUrl && type === "pdf" && (
            <iframe
              src={signedUrl}
              title={row.file_name ?? "PDF preview"}
              style={{
                width: "85vw",
                height: "85vh",
                border: "1px solid #36363A",
                borderRadius: 8,
                background: "white",
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
