"use client";

import { Link2 } from "lucide-react";

export function LinksViewPlaceholder() {
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-8">
      <div className="mb-6">
        <div className="text-[13px] text-zinc-400 mb-1">Workspace</div>
        <h2 className="text-2xl font-semibold mb-1">Files &amp; Links</h2>
      </div>
      <div className="panel-card p-8 text-center fade-in">
        <div
          className="mx-auto mb-4 flex items-center justify-center"
          style={{
            width: "56px",
            height: "56px",
            borderRadius: "16px",
            background: "#108CE91A",
            border: "1px solid #108CE944",
          }}
        >
          <Link2 size={24} style={{ color: "#7EC2F4" }} strokeWidth={1.5} />
        </div>
        <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "#979393" }}>
          Phase 2 · Checkpoint D3
        </div>
        <h3 className="text-lg font-semibold mb-2">Files &amp; Links lands in D3</h3>
        <p className="text-[13px] leading-relaxed" style={{ color: "#979393" }}>
          Pipeline-level uploads, URL links, and the rolled-up view of stage attachments — all
          coming in the third pipeline-view sub-checkpoint, alongside the stage page itself.
        </p>
      </div>
    </div>
  );
}
