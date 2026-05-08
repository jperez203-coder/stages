"use client";

import { useState } from "react";
import { ExternalLink, FileText, Layers, Link2, X, ZoomIn } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { Client, Link, StageAttachment } from "@/types/stages";

type FeedItem =
  | (Link & { _origin: { kind: "tab" } })
  | (StageAttachment & {
      _origin: { kind: "stage"; stageId: string; stageName: string; stageColor: string };
      url?: undefined;
    });

function formatBytes(b?: number): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = { pipeline: Client };

export function ClientPortalFiles({ pipeline }: Props) {
  const [previewItem, setPreviewItem] = useState<FeedItem | null>(null);

  // Filter to clientVisible items only.
  const visibleLinks: FeedItem[] = (pipeline.links || [])
    .filter((l) => l.clientVisible)
    .map((l) => ({ ...l, _origin: { kind: "tab" } }));

  const visibleStageAttachments: FeedItem[] = (pipeline.stages || []).flatMap((stage) =>
    (stage.attachments || [])
      .filter((att) => att.clientVisible)
      .map(
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

  const allItems: FeedItem[] = [...visibleLinks, ...visibleStageAttachments].sort(
    (a, b) => (b.ts || 0) - (a.ts || 0),
  );

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <div
          className="text-[12px] uppercase tracking-wider mb-2"
          style={{ color: "#979393" }}
        >
          Project files
        </div>
        <h1 className="text-2xl font-semibold mb-1">Files shared with you</h1>
        <p className="text-[13px]" style={{ color: "#979393" }}>
          Images, links, and other deliverables your team has shared on this project.
        </p>
      </div>

      {allItems.length === 0 ? (
        <div className="text-center py-16">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
            style={{
              background: "rgba(59,165,238,0.1)",
              border: "1px solid #36363A",
            }}
          >
            <FileText size={22} style={{ color: "#3BA5EE" }} strokeWidth={1.5} />
          </div>
          <div className="text-[14px] font-semibold mb-1">No files shared yet</div>
          <div className="text-[13px]" style={{ color: "#979393" }}>
            Your team hasn&apos;t shared any files for this project yet. They&apos;ll show up here
            as soon as they do.
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
                className="rounded-lg p-3 flex items-center gap-3 transition-colors"
                style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
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
                        title={`From ${item._origin.stageName}`}
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
                    Shared by {item.addedBy} · {timeAgo(item.ts)}
                  </div>
                </div>

                {isImage ? (
                  <button
                    onClick={() => setPreviewItem(item)}
                    className="icon-btn"
                    title="Preview"
                  >
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
              </div>
            );
          })}
        </div>
      )}

      {previewItem && (
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
              src={(previewItem as { dataUrl?: string }).dataUrl}
              alt={previewItem.label}
              style={{
                maxWidth: "100%",
                maxHeight: "75vh",
                objectFit: "contain",
                borderRadius: "8px",
              }}
            />
            <div className="text-[13px] font-semibold">{previewItem.label}</div>
            <div className="text-[11px]" style={{ color: "#979393" }}>
              {(previewItem as { fileName?: string }).fileName} ·{" "}
              {formatBytes((previewItem as { fileSize?: number }).fileSize)} · shared by{" "}
              {previewItem.addedBy}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
