"use client";

import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, MoreHorizontal } from "lucide-react";

type Props = {
  onSaveAsTemplate: () => void;
};

export function PipelineMoreMenu({ onSaveAsTemplate }: Props) {
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

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center transition-colors"
        style={{
          width: "36px",
          height: "36px",
          background: open ? "#36363A" : "#2C2C2F",
          border: "1px solid #36363A",
          borderRadius: "8px",
          color: "#E4E4E7",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = "#36363A"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = "#2C2C2F"; }}
        title="More options"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 fade-in z-50"
          style={{
            width: "240px",
            background: "#1A1A1C",
            border: "1px solid #36363A",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}
        >
          <div className="p-1">
            <button
              onClick={() => { setOpen(false); onSaveAsTemplate(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors"
              style={{
                background: "transparent",
                color: "#E4E4E7",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#2C2C2F")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <BookmarkPlus size={15} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">Save as template</div>
                <div className="text-[11px] mt-0.5" style={{ color: "#979393" }}>
                  Reuse this pipeline structure later
                </div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
