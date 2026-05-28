"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Download, Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { resolveDisplayName } from "@/lib/display-name";
import { createPipelineFileSignedUrl } from "@/lib/file-signed-url";
import { normalizeUrl } from "@/lib/normalize-url";
import type { FileItem } from "@/lib/pipeline-files-data";

/**
 * Pipeline file card. Phase 4b-3-b redesign — preview-forward layout
 * with lazy thumbnails. Shared with 4b-3-c portal Files tab.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ [icon] Title              [Download][E][T]   │  ← header + actions
 *   │        Type label                            │
 *   │ ┌──────────────────────────────────────────┐ │
 *   │ │                                          │ │
 *   │ │       PREVIEW AREA (~200px tall)         │ │
 *   │ │   (image thumb / pdf iframe / icon)      │ │
 *   │ │                                          │ │
 *   │ └──────────────────────────────────────────┘ │
 *   │ [avatar] Uploader Name · 12m ago             │
 *   └──────────────────────────────────────────────┘
 *
 * Thumbnail loading — INTERSECTION OBSERVER:
 *   For previewable file rows (image/* or application/pdf), the
 *   signed URL is fetched only when the card enters the viewport
 *   (rootMargin 200px to start fetching just before scroll arrives).
 *   Avoids firing N signed-URL calls eagerly on page load — scales
 *   from 5 files to 500 with the same browser cost (only the visible
 *   ones do work). Each card observes itself; once loaded, the URL
 *   stays in state for the rest of the session.
 *
 *   Non-previewable file rows (other MIMEs) and links skip the
 *   observer entirely — they render the type icon centered in the
 *   preview area as a placeholder.
 *
 * Action buttons — TOP-RIGHT, ALWAYS VISIBLE:
 *   * Download — always visible for kind='file' (read action, not
 *     edit; clients in 4b-3-c still need to download)
 *   * Visibility eye toggle — only when canEdit (uploader OR
 *     can_edit_pipeline). Clients never see it (portal passes
 *     canEdit={false}).
 *   * Trash — only when canEdit, same gating.
 *
 *   Stops propagation so card-body click (which triggers preview /
 *   download fallback / open-link) doesn't also fire.
 *
 * Card click behavior:
 *   * kind='url' → opens in new tab (handled by parent dispatcher)
 *   * kind='file' + image/pdf → opens preview modal (existing FilePreview)
 *   * kind='file' + other → triggers download
 *   * Uploading row → cursor:wait, no click action
 *
 * PDF preview iframe gets `pointerEvents: none` so the iframe doesn't
 * intercept card-body clicks — the lightbox preview still opens
 * cleanly when the user clicks anywhere on the card.
 */

type OptimisticStatus = "uploading";
type RowWithStatus = FileItem & { status?: OptimisticStatus };

type Props = {
  row: RowWithStatus;
  /** Trash button gate. For agency: uploader OR can_edit_pipeline.
   *  For portal client (4b-3-d): row.added_by === viewerId, so a
   *  client can delete their OWN uploaded rows but nothing else.
   *  The download button is NOT gated by this. */
  canEdit: boolean;
  /** Visibility-toggle (eye) gate — SEPARATE from canEdit so the
   *  portal can grant a client delete-own without granting them
   *  visibility-toggle. Optional; defaults to `canEdit` to preserve
   *  agency-side behavior with no call-site change. Portal passes
   *  `false` explicitly to force-hide the eye even when canEdit is
   *  true for the client's own row. (Clients must never toggle
   *  client_visible: the RLS UPDATE policy on pipeline_links blocks
   *  it server-side, and this prop hides the affordance client-side.) */
  canToggleVisibility?: boolean;
  /** Current viewer's user_id — for the "(You)" suffix on the
   *  uploader name when the row is theirs. */
  viewerId: string;
  onToggleVisibility: (id: string, next: boolean) => void;
  onRequestDelete: (id: string) => void;
  onClick: (row: FileItem) => void;
  onDownload: (row: FileItem) => void;
};

type ThumbStatus = "idle" | "loading" | "loaded" | "error";

export function FileCard({
  row,
  canEdit,
  canToggleVisibility,
  viewerId,
  onToggleVisibility,
  onRequestDelete,
  onClick,
  onDownload,
}: Props) {
  const isUploading = row.status === "uploading";
  // The eye gate falls back to `canEdit` when the prop is omitted —
  // preserves agency behavior with zero call-site changes. Portal
  // passes `false` explicitly to keep the eye hidden for client
  // delete-own rows (where canEdit is true for delete purposes only).
  const showVisibilityToggle = canToggleVisibility ?? canEdit;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [thumbStatus, setThumbStatus] = useState<ThumbStatus>("idle");
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  const mime = row.mime_type ?? "";
  const isImage = row.kind === "file" && mime.startsWith("image/");
  const isPdf = row.kind === "file" && mime === "application/pdf";
  const isPreviewable = isImage || isPdf;

  // Uploader label. Name-resolution delegated to the shared util
  // (display_name → email local-part → "Pending member"); the "(You)"
  // suffix is presentation logic specific to this card, kept here.
  const uploaderBaseName = resolveDisplayName(row.added_by_profile, {
    whenMissing: "Pending member",
  });
  const uploaderName =
    row.added_by && row.added_by === viewerId
      ? `${uploaderBaseName} (You)`
      : uploaderBaseName;

  // ── Lazy thumbnail load via IntersectionObserver ────────────────────
  useEffect(() => {
    if (!isPreviewable || !row.storage_path) return;
    if (thumbStatus !== "idle") return;
    const el = cardRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          obs.disconnect();
          setThumbStatus("loading");
          void (async () => {
            const { signedUrl, error } = await createPipelineFileSignedUrl(
              row.storage_path!,
            );
            if (error || !signedUrl) {
              console.error("[file-card] thumb fetch failed:", error);
              setThumbStatus("error");
              return;
            }
            setThumbUrl(signedUrl);
            setThumbStatus("loaded");
          })();
        }
      },
      {
        // Start fetching 200px before the card enters the viewport so
        // the thumb is usually ready by the time it's actually visible.
        rootMargin: "200px 0px",
      },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [isPreviewable, row.storage_path, thumbStatus]);

  const displayLabel = resolveLabel(row);
  const typeText = typeLabel(row);
  const iconSrc = pickIcon(row);
  // For kind='url' rows, try to show the linked site's real favicon
  // as the card icon (instead of the generic chain glyph). Returns
  // null for file rows or when hostname parsing fails — falls back
  // to the static iconSrc above.
  const faviconUrl = getFaviconUrl(row);
  // Header / preview-placeholder icon footprint. The image chip's
  // desaturated dark-teal palette reads slightly smaller than the
  // high-contrast PDF / video / link chips at the same render size.
  // 2026-05-25 we boosted it +8 (to 40/56) which overshot. Settled
  // 2026-05-27 on a small +2 nudge (34/50) — enough to lift the image
  // chip's perceived mass to parity with the others without it
  // looking visibly larger.
  const isImageIcon =
    row.kind === "file" && (row.mime_type ?? "").startsWith("image/");
  const headerIconSize = isImageIcon ? 34 : 32;
  const previewIconSize = isImageIcon ? 50 : 48;

  return (
    <div
      ref={cardRef}
      onClick={() => {
        if (!isUploading) onClick(row);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        background: "#2C2C2F",
        border: "1px solid #36363A",
        borderRadius: 12,
        padding: 16,
        gap: 12,
        cursor: isUploading ? "wait" : "pointer",
        opacity: isUploading ? 0.7 : 1,
        transition: "border-color 120ms ease-out, background 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!isUploading) e.currentTarget.style.borderColor = "#4A4A50";
      }}
      onMouseLeave={(e) => {
        if (!isUploading) e.currentTarget.style.borderColor = "#36363A";
      }}
    >
      {/* ── Header row: icon + title block + actions ────────────────
          alignItems: center vertically centers the title-block (and
          the action cluster) against the 40×40 icon, so the icon's
          horizontal midline lines up with the gap between filename
          and type label — fixes the slight visual misalignment where
          the text used to sit a touch below the icon. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Type icon — box removed (was a 40×40 chip with bg + border);
            icon now fills the previous chip footprint at 40×40 so the
            header row's layout proportions stay identical while the
            icon itself becomes the dominant visual. flexShrink: 0
            prevents the icon from being squeezed in the flex row.
            For kind='url' rows with a parseable hostname, we render
            the linked site's favicon instead; FaviconImage handles
            onError fallback back to the static iconSrc. */}
        {faviconUrl ? (
          <FaviconImage faviconUrl={faviconUrl} size={headerIconSize} />
        ) : (
          <Image
            src={iconSrc}
            alt=""
            width={headerIconSize}
            height={headerIconSize}
            style={{ flexShrink: 0 }}
          />
        )}

        {/* Title + type label */}
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
              fontSize: 15,
              fontWeight: 700,
              color: "white",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={displayLabel}
          >
            {displayLabel}
          </div>
          {/* Type label, with the task source appended inline when this
              row is task-scoped (replaces the earlier standalone pill
              that took its own row). The "· from <title>" suffix is a
              smaller, more muted font so the primary type label still
              reads as the dominant token, and the whole line truncates
              with ellipsis so a long task title never wraps or grows
              the card. */}
          <div
            title={
              row.task_id && row.task_title
                ? `${typeText} · from ${row.task_title}`
                : undefined
            }
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 0,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 500,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.2,
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ flexShrink: 0 }}>{typeText}</span>
            {row.task_id && row.task_title && (
              <>
                {/* Standalone separator span — bullet glyph at a larger
                    size than the surrounding text so it reads as an
                    intentional bullet rather than a hyphen-adjacent
                    middot. Equal horizontal margins (8px) sit it
                    visually centered between "Video" and "from …". */}
                <span
                  aria-hidden
                  style={{
                    marginLeft: 6,
                    marginRight: 6,
                    fontSize: 11,
                    lineHeight: 1,
                    color: "rgba(255,255,255,0.4)",
                    flexShrink: 0,
                  }}
                >
                  •
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 400,
                    color: "rgba(255,255,255,0.35)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  from {row.task_title}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Actions cluster — top-right, always visible (per click).
            Download visible for kind='file' regardless of canEdit.
            Eye + trash gated on canEdit. */}
        {!isUploading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexShrink: 0,
            }}
          >
            {row.kind === "file" && (
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
                <Download size={14} color="rgba(255,255,255,0.65)" />
              </button>
            )}
            {/* Eye is gated on showVisibilityToggle (separate from canEdit)
                so the portal can grant a client delete-own without
                granting visibility-toggle. See Props.canToggleVisibility
                for the full rationale. */}
            {showVisibilityToggle && (
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
                  row.client_visible
                    ? "Visible to client"
                    : "Hidden from client"
                }
                style={iconBtnStyle(row.client_visible)}
              >
                {row.client_visible ? (
                  <Eye size={14} color="#15B981" />
                ) : (
                  <EyeOff size={14} color="rgba(255,255,255,0.45)" />
                )}
              </button>
            )}
            {canEdit && (
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
                <Trash2 size={14} color="rgba(255,255,255,0.55)" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Preview area ─────────────────────────────────────────── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 200,
          borderRadius: 8,
          background: "#1A1A1C",
          border: "1px solid #36363A",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isUploading && (
          <Loader2
            size={28}
            color="rgba(255,255,255,0.6)"
            style={{ animation: "fc-spin 1s linear infinite" }}
          />
        )}

        {!isUploading && !isPreviewable && (
          // Links + non-previewable files: centered icon placeholder.
          // For links with a parseable hostname, render the site's
          // favicon at full opacity (it IS meaningful content, not a
          // placeholder). Non-previewable files keep the dimmed-icon
          // placeholder treatment.
          faviconUrl ? (
            <FaviconImage faviconUrl={faviconUrl} size={previewIconSize} />
          ) : (
            <Image
              src={iconSrc}
              alt=""
              width={previewIconSize}
              height={previewIconSize}
              style={{ opacity: 0.55 }}
            />
          )
        )}

        {!isUploading &&
          isPreviewable &&
          (thumbStatus === "idle" || thumbStatus === "loading") && (
            <div
              aria-hidden
              style={{
                width: "100%",
                height: "100%",
                background:
                  "linear-gradient(90deg, #1A1A1C 0%, #232326 50%, #1A1A1C 100%)",
                backgroundSize: "200% 100%",
                animation: "fc-skel 1.4s ease-in-out infinite",
              }}
            />
          )}

        {!isUploading && isPreviewable && thumbStatus === "error" && (
          // Fallback to the type icon if the signed-URL fetch failed.
          // Functional degradation — the row's still clickable for
          // download / lightbox via the parent's dispatch.
          <Image
            src={iconSrc}
            alt=""
            width={previewIconSize}
            height={previewIconSize}
            style={{ opacity: 0.4 }}
          />
        )}

        {!isUploading && isImage && thumbStatus === "loaded" && thumbUrl && (
          <Image
            src={thumbUrl}
            alt={row.file_name ?? ""}
            width={0}
            height={0}
            sizes="(max-width: 720px) 100vw, 360px"
            unoptimized
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#1A1A1C",
            }}
          />
        )}

        {!isUploading && isPdf && thumbStatus === "loaded" && thumbUrl && (
          // pointerEvents: none → clicks pass through to the card
          // wrapper, so clicking on the PDF preview still opens the
          // full lightbox iframe via the parent's onClick dispatch.
          // Without this, the iframe would absorb clicks and the
          // card-click handler would never fire.
          <iframe
            src={thumbUrl}
            title={row.file_name ?? "PDF preview"}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              background: "white",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* ── Uploader row ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
        }}
      >
        <UploaderAvatar profile={row.added_by_profile} />
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            minWidth: 0,
            flex: 1,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "white",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {uploaderName}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              flexShrink: 0,
            }}
          >
            {relativeTime(row.added_at)}
          </span>
        </div>
      </div>

      {/* Inline keyframes — used for the upload spinner + thumb skeleton. */}
      <style>{`
        @keyframes fc-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes fc-skel {
          0%   { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function UploaderAvatar({ profile }: { profile: FileItem["added_by_profile"] }) {
  // Render UserAvatar when we have a profile; placeholder shape when
  // RLS denied or user deleted (matches the "Pending member" fallback
  // pattern from chat).
  if (!profile) {
    return (
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          background: "#36363A",
          color: "rgba(255,255,255,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          flexShrink: 0,
        }}
        aria-label="Unknown uploader"
      >
        ?
      </div>
    );
  }
  return (
    <UserAvatar
      user={{
        id: profile.id,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        email: profile.email,
      }}
      size={28}
    />
  );
}

/**
 * Renders a site's favicon (from Google's s2 service) inside a white
 * rounded chip so it has matching visual weight to the colored chips
 * on the other file icons (link/image/video/pdf each render as a
 * solid-colored 48-viewBox SVG with rx=12 and an inset glyph). The
 * chip footprint matches the requested `size` — same outer dimensions
 * as the other icons in both the header (40×40) and preview (56×56)
 * spots. Falls back to the generic file-link.svg (already chipped) on
 * favicon load failure; tracks the error in local state so a broken
 * URL doesn't keep retrying on every render.
 *
 * Uses a plain <img> (not next/image) for two reasons:
 *   1. The user spec calls for "a small <img>".
 *   2. Avoids needing to register www.google.com under
 *      next.config.ts → images.remotePatterns just for 1KB icons —
 *      the optimizer would be net-negative work here anyway.
 *
 * Proportions:
 *   - Outer chip: size × size, borderRadius = size * 0.25 (matches
 *     the other icons' rx=12-in-48-viewBox visual radius)
 *   - Inner favicon: ~60% of size, centered. We tightened from 65%
 *     → 40% to match the image icon's glyph proportions, then bumped
 *     back to 60% once the outer chip itself was sized down (per
 *     design feedback 2026-05-25) — keeps the chip footprint compact
 *     but lets the favicon read clearly as a recognizable brand.
 *   - objectFit:contain — Google occasionally returns slightly
 *     non-square favicons; contain keeps them un-stretched.
 */
function FaviconImage({
  faviconUrl,
  size,
}: {
  faviconUrl: string;
  size: number;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <Image
        src="/icons/file-link.svg"
        alt=""
        width={size}
        height={size}
        style={{ flexShrink: 0 }}
      />
    );
  }
  const inner = Math.round(size * 0.6);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={faviconUrl}
        alt=""
        width={inner}
        height={inner}
        onError={() => setErrored(true)}
        style={{ objectFit: "contain" }}
      />
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Build the Google s2 favicon URL for a kind='url' row.
 *
 * Returns null when:
 *   - the row isn't a url-kind row
 *   - row.url is missing
 *   - the URL can't be parsed (malformed even after normalization)
 *   - the parsed hostname is empty
 * Caller falls back to the static iconSrc when null.
 *
 * Normalizes the URL first (defensive — rows saved before the
 * https://-prefix fix may be bare domains; `new URL("facebook.com")`
 * throws, but `new URL("https://facebook.com")` doesn't).
 */
function getFaviconUrl(row: FileItem): string | null {
  if (row.kind !== "url" || !row.url) return null;
  const normalized = normalizeUrl(row.url);
  if (!normalized) return null;
  try {
    const hostname = new URL(normalized).hostname;
    if (!hostname) return null;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return null;
  }
}

function pickIcon(row: FileItem): string {
  if (row.kind === "url") return "/icons/file-link.svg";
  const mime = row.mime_type ?? "";
  if (mime.startsWith("image/")) return "/icons/file-image.svg";
  if (mime === "application/pdf") return "/icons/file-pdf.svg";
  if (mime.startsWith("video/")) return "/icons/file-video.svg";
  // Fallback for other file types (.zip, .csv, .docx, etc.) — same
  // generic file glyph until we ship more type icons.
  return "/icons/file-pdf.svg";
}

function typeLabel(row: FileItem): string {
  if (row.kind === "url") return "Link";
  const mime = row.mime_type ?? "";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) {
    // "Image" rather than a specific format — the user cares it's an
    // image, not whether it's JPEG vs PNG.
    return "Image";
  }
  if (mime.startsWith("video/")) {
    // Same principle as Image — "Video" reads better than "MP4" or
    // "MOV" in the small type-label slot.
    return "Video";
  }
  // Fallback to the file extension upper-cased (.zip → "ZIP", .csv → "CSV").
  const fn = row.file_name ?? "";
  const dotIdx = fn.lastIndexOf(".");
  if (dotIdx > 0) {
    const ext = fn.slice(dotIdx + 1).toUpperCase();
    if (ext.length > 0 && ext.length <= 6) return ext;
  }
  return "File";
}

function resolveLabel(row: FileItem): string {
  if (row.label && row.label.trim()) return row.label;
  if (row.file_name) return row.file_name;
  if (row.kind === "url" && row.url) return row.url;
  return "Untitled";
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
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
