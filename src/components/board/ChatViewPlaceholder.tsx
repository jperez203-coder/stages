"use client";

import { MessageCircle } from "lucide-react";

export function ChatViewPlaceholder() {
  return (
    <div
      className="flex items-center justify-center"
      style={{ height: "calc(100vh - 64px)", background: "#212124" }}
    >
      <div className="panel-card p-8 max-w-md text-center fade-in">
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
          <MessageCircle size={24} style={{ color: "#7EC2F4" }} strokeWidth={1.5} />
        </div>
        <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "#979393" }}>
          Phase 2 · Checkpoint D2
        </div>
        <h3 className="text-lg font-semibold mb-2">Chat lands next</h3>
        <p className="text-[13px] leading-relaxed" style={{ color: "#979393" }}>
          The full chat ecosystem (channels, threads, mentions, internal notes, client channel)
          is the next sub-checkpoint. The pipeline view chrome is ready to receive it.
        </p>
      </div>
    </div>
  );
}
