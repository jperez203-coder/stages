"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import type { Session } from "@/types/stages";

const COLORS = ["#3BA5EE", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#F43F5E"];

type Props = {
  session: Session;
  onLogout: () => void;
};

export function ProfileMenu({ session, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  let hash = 0;
  for (let i = 0; i < session.email.length; i++) {
    hash = session.email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = COLORS[Math.abs(hash) % COLORS.length];
  const initial = session.email.charAt(0).toUpperCase();
  const isOwner = session.role === "owner";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center font-semibold transition-transform"
        style={{
          width: "36px",
          height: "36px",
          background: color + "33",
          color,
          border: `2px solid ${color}66`,
          borderRadius: "9px",
          fontSize: "14px",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        title={session.email}
      >
        {initial}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 fade-in z-50"
          style={{
            width: "260px",
            background: "#1A1A1A",
            border: "1px solid #36363A",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}
        >
          <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
            <div
              className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
              style={{
                width: "44px",
                height: "44px",
                background: color + "33",
                color,
                border: `2px solid ${color}66`,
                fontSize: "16px",
              }}
            >
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate">{session.email}</div>
              <div
                className="text-[11px] mt-0.5 inline-block px-1.5 py-px rounded"
                style={{
                  background: isOwner ? "#108CE933" : "#36363A",
                  color: isOwner ? "#7EC2F4" : "#A1A1AA",
                }}
              >
                {isOwner ? "Owner" : "Member"}
              </div>
            </div>
          </div>
          <div className="p-1">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-zinc-300 transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1F1F22")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ background: "transparent" }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
