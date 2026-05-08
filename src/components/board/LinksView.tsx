"use client";

import { useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  Layers,
  Link2,
  Lock,
  Plus,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { Client, Link, Session, StageAttachment } from "@/types/stages";

const MAX_BYTES = 3 * 1024 * 1024;

function formatBytes(b?: number): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

type FeedItem =
  | (Link & { _origin: { kind: "tab" } })
  | (StageAttachment & {
      _origin: { kind: "stage"; stageId: string; stageName: string; stageColor: string };
      url?: undefined;
    });

type Props = {
  client: Client;
  session: Session;
  onAddLink: (label: string, url: string) => void;
  onAddImage: (label: string, dataUrl: string, fileName: string, fileSize: number) => void;
  onToggleLinkClientVisible: (linkId: string) => void;
  onRemoveLink: (linkId: string) => void;
};

export function LinksView({
  client,
  session,
  onAddLink,
  onAddImage,
  onToggleLinkClientVisible,
  onRemoveLink,
}: Props) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [previewItem, setPreviewItem] = useState<FeedItem | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const links = client.links || [];
  const isOwner = client.ownerEmail === session.email;

  const stageAttachmentItems: FeedItem[] = (client.stages || []).flatMap((stage) =>
    (stage.attachments || []).map(
      (att): FeedItem => ({
        ...att,
        _origin: {
          kind: "stage",
          stageId: stage.id,
          stageName: stage.name,
          stageColor: stage.color,
        },
      }),
    ),
  );

  const allItems: FeedItem[] = [
    ...links.map((l): FeedItem => ({ ...l, _origin: { kind: "tab" } })),
    ...stageAttachmentItems,
  ].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const handleFiles = async (files: FileList | null) => {
    setUploadError("");
    if (!files) return;
    const arr = Array.from(files);
    for (const file of arr) {
      if (!file.type.startsWith("image/")) {
        setUploadError(`Only images are supported in this MVP — ${file.name} skipped.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setUploadError(
          `${file.name} is larger than 3 MB and was skipped. Image uploads are limited in MVP — connect cloud storage in the next release.`,
        );
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        onAddImage(file.name.replace(/\.[^.]+$/, ""), dataUrl, file.name, file.size);
      } catch {
        setUploadError(`Failed to read ${file.name}.`);
      }
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const submitUrl = () => {
    if (!label.trim() || !url.trim()) return;
    let clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) clean = "https://" + clean;
    onAddLink(label, clean);
    setLabel("");
    setUrl("");
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8">
      <div className="mb-6">
        <div className="text-[13px] text-zinc-400 mb-1">Workspace</div>
        <h2 className="text-2xl font-semibold mb-1">Files &amp; Links</h2>
        <div className="text-[13px] text-zinc-500">
          Upload images or paste URLs (Drive, Notion, dashboards). Toggle the eye to share with the
          client.
        </div>
      </div>

      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className="rounded-xl text-center transition-all cursor-pointer mb-3"
        style={{
          border: `2px dashed ${dragActive ? "#108CE9" : "#36363A"}`,
          background: dragActive ? "#108CE91A" : "#1A1A1C",
          padding: "32px 20px",
        }}
      >
        <div
          className="mx-auto mb-3 flex items-center justify-center"
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            background: dragActive ? "#108CE933" : "#2C2C2F",
            border: `1px solid ${dragActive ? "#108CE966" : "#36363A"}`,
          }}
        >
          <Plus size={20} style={{ color: dragActive ? "#7EC2F4" : "#979393" }} strokeWidth={2.5} />
        </div>
        <div className="text-[14px] font-semibold mb-1">
          {dragActive ? "Drop image here" : "Drag & drop an image"}
        </div>
        <div className="text-[12px]" style={{ color: "#979393" }}>
          or <span style={{ color: "#7EC2F4", textDecoration: "underline" }}>click to browse</span>{" "}
          · PNG, JPG, GIF, WebP · up to 3&nbsp;MB
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploadError && (
        <div
          className="rounded-lg px-3 py-2 mb-4 text-[12px] flex items-start gap-2"
          style={{ background: "#F4335E1A", border: "1px solid #F4335E66", color: "#F87171" }}
        >
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span className="flex-1">{uploadError}</span>
          <button
            onClick={() => setUploadError("")}
            className="opacity-60 hover:opacity-100"
            style={{
              background: "transparent",
              border: "none",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="panel-card p-3 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitUrl()}
            placeholder="Label (e.g. Drive folder)"
            className="field"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitUrl()}
            placeholder="Paste a URL…"
            className="field"
          />
          <button
            onClick={submitUrl}
            disabled={!label.trim() || !url.trim()}
            className="btn-primary justify-center"
          >
            <Link2 size={13} strokeWidth={2.5} /> Add link
          </button>
        </div>
      </div>

      {allItems.length === 0 ? (
        <div className="text-center py-12">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: "rgba(59,165,238,0.1)", border: "1px solid #36363A" }}
          >
            <Link2 size={22} style={{ color: "#3BA5EE" }} strokeWidth={1.5} />
          </div>
          <div className="text-[14px] font-semibold mb-1">No files or links yet</div>
          <div className="text-[13px] text-zinc-500">
            Drag in an image above, paste a URL, or upload from inside a stage.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {allItems.map((item) => {
            const isImage = item.kind === "image" && (item as { dataUrl?: string }).dataUrl;
            const fromStage = item._origin.kind === "stage";
            const dataUrl = (item as { dataUrl?: string }).dataUrl;
            const linkUrl = (item as { url?: string }).url;
            return (
              <div
                key={item.id}
                className="panel-card p-3 flex items-center gap-3 group transition-colors"
                style={{ borderColor: "#36363A" }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A4A50")}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#36363A")}
              >
                {isImage ? (
                  <button
                    onClick={() => setPreviewItem(item)}
                    className="flex-shrink-0 overflow-hidden rounded-lg"
                    style={{
                      width: "56px",
                      height: "56px",
                      background: "#1A1A1C",
                      border: "1px solid #36363A",
                      cursor: "zoom-in",
                    }}
                    title="Preview"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={dataUrl}
                      alt={item.label}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </button>
                ) : (
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: "56px",
                      height: "56px",
                      borderRadius: "10px",
                      background: "#108CE91A",
                      color: "#3BA5EE",
                      border: "1px solid #108CE944",
                    }}
                  >
                    <Link2 size={20} strokeWidth={2} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-semibold truncate">{item.label}</span>
                    {isImage && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: "#36363A", color: "#A1A1AA" }}
                      >
                        IMAGE
                      </span>
                    )}
                    {fromStage && item._origin.kind === "stage" && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                        style={{
                          background: (item._origin.stageColor || "#108CE9") + "22",
                          color: item._origin.stageColor || "#7EC2F4",
                          border: `1px solid ${item._origin.stageColor || "#108CE9"}44`,
                        }}
                        title={`Uploaded from ${item._origin.stageName}`}
                      >
                        <Layers size={9} /> {item._origin.stageName}
                      </span>
                    )}
                  </div>
                  <div className="text-[12px] truncate" style={{ color: "#979393" }}>
                    {isImage
                      ? `${(item as { fileName?: string }).fileName || ""}${
                          (item as { fileSize?: number }).fileSize
                            ? " · " + formatBytes((item as { fileSize?: number }).fileSize)
                            : ""
                        }`
                      : linkUrl}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "#71717A" }}>
                    Added by {item.addedBy} · {timeAgo(item.ts)}
                  </div>
                </div>

                {isOwner && !fromStage && onToggleLinkClientVisible && (
                  <button
                    onClick={() => onToggleLinkClientVisible(item.id)}
                    className="inline-flex items-center gap-1 rounded-full transition-colors flex-shrink-0"
                    style={{
                      background: item.clientVisible ? "#108CE91A" : "transparent",
                      border: `1px solid ${item.clientVisible ? "#108CE966" : "#36363A"}`,
                      color: item.clientVisible ? "#7EC2F4" : "#71717A",
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: 500,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    title={
                      item.clientVisible
                        ? "Visible to client — click to hide"
                        : "Internal — click to share with client"
                    }
                  >
                    {item.clientVisible ? <ExternalLink size={10} /> : <Lock size={10} />}
                    <span>{item.clientVisible ? "Client" : "Internal"}</span>
                  </button>
                )}
                {fromStage && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full flex-shrink-0"
                    style={{
                      background: item.clientVisible ? "#108CE91A" : "transparent",
                      border: `1px solid ${item.clientVisible ? "#108CE966" : "#36363A"}`,
                      color: item.clientVisible ? "#7EC2F4" : "#71717A",
                      padding: "4px 10px",
                      fontSize: "11px",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                    title="Toggle visibility on the stage page"
                  >
                    {item.clientVisible ? <ExternalLink size={10} /> : <Lock size={10} />}
                    <span>{item.clientVisible ? "Client" : "Internal"}</span>
                  </span>
                )}

                {isImage ? (
                  <button onClick={() => setPreviewItem(item)} className="icon-btn" title="Preview">
                    <ZoomIn size={13} />
                  </button>
                ) : (
                  <a
                    href={linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="icon-btn"
                    title="Open"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}

                {!fromStage && (isOwner || item.addedBy === session.email) && (
                  <button
                    onClick={() => {
                      if (confirm(`Remove "${item.label}"?`)) onRemoveLink(item.id);
                    }}
                    className="icon-btn opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: "#F87171" }}
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {previewItem && (item => {
        const dataUrl = (item as { dataUrl?: string }).dataUrl;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
            style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
            onClick={() => setPreviewItem(null)}
          >
            <button
              onClick={() => setPreviewItem(null)}
              className="icon-btn absolute"
              style={{ top: "16px", right: "16px", width: 36, height: 36 }}
            >
              <X size={16} />
            </button>
            <div
              onClick={(e) => e.stopPropagation()}
              className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={dataUrl}
                alt={item.label}
                style={{
                  maxWidth: "100%",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  borderRadius: "8px",
                }}
              />
              <div className="text-[13px] font-semibold">{item.label}</div>
              <div className="text-[11px]" style={{ color: "#979393" }}>
                {(item as { fileName?: string }).fileName} ·{" "}
                {formatBytes((item as { fileSize?: number }).fileSize)} · added by {item.addedBy}
              </div>
            </div>
          </div>
        );
      })(previewItem)}
    </div>
  );
}
