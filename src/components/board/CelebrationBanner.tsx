"use client";

import { X } from "lucide-react";
import { timeAgo } from "@/lib/format";
import type { Client } from "@/types/stages";

type Props = {
  client: Client;
  onDismiss: () => void;
};

export function CelebrationBanner({ client, onDismiss }: Props) {
  return (
    <div
      className="fade-in"
      style={{
        background:
          "linear-gradient(135deg, rgba(16,140,233,0.18) 0%, rgba(139,92,246,0.18) 50%, rgba(236,72,153,0.18) 100%)",
        borderBottom: "1px solid #108CE944",
        padding: "14px 20px",
        display: "flex",
        alignItems: "center",
        gap: "14px",
        position: "relative",
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: "40px",
          height: "40px",
          background: "linear-gradient(135deg, #108CE9 0%, #EC4899 100%)",
          borderRadius: "10px",
          fontSize: "20px",
        }}
      >
        🥳
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold leading-tight">
          Congrats on finishing <span style={{ color: "#7EC2F4" }}>{client.name}</span>!
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: "#979393" }}>
          Submitted by {client.submittedBy} · {client.submittedAt ? timeAgo(client.submittedAt) : ""} ·
          all {client.stages.length} stages complete 🎉
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="flex items-center justify-center transition-colors flex-shrink-0"
        style={{
          width: "32px",
          height: "32px",
          background: "transparent",
          border: "1px solid #36363A",
          borderRadius: "8px",
          color: "#A1A1AA",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#2C2C2F";
          e.currentTarget.style.color = "#E4E4E7";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "#A1A1AA";
        }}
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
