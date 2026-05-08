"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Calendar, Check } from "lucide-react";
import {
  formatDeadline,
  fromDatetimeLocal,
  getDeadlineColors,
  getDeadlineStatus,
  toDatetimeLocal,
} from "@/lib/format";

type Props = {
  deadline: number | null | undefined;
  onChange: (value: number | null) => void;
  canEdit?: boolean;
  size?: "sm" | "md";
  emptyLabel?: string;
};

export function DeadlinePill({
  deadline,
  onChange,
  canEdit = true,
  size = "sm",
  emptyLabel = "Set deadline",
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(toDatetimeLocal(deadline));
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(toDatetimeLocal(deadline));
  }, [deadline]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const popoverWidth = 280;
      const popoverHeight = 140;
      let top = rect.bottom + 6;
      if (top + popoverHeight > window.innerHeight - 16) {
        top = Math.max(16, rect.top - popoverHeight - 6);
      }
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - popoverWidth - 16);
      }
      setCoords({ top, left });
    };
    updatePosition();
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && popoverRef.current.contains(e.target as Node)) return;
      if (buttonRef.current && buttonRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handler);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  const status = getDeadlineStatus(deadline);
  const colors = getDeadlineColors(status);
  const label = deadline ? formatDeadline(deadline, { short: true }) : emptyLabel;
  const fontSize = size === "sm" ? "11px" : "12px";
  const padding = size === "sm" ? "3px 8px" : "5px 10px";

  const commit = () => {
    onChange(fromDatetimeLocal(draft));
    setOpen(false);
  };
  const clear = () => {
    onChange(null);
    setDraft("");
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          if (canEdit) setOpen(!open);
        }}
        disabled={!canEdit && !deadline}
        className="inline-flex items-center gap-1 rounded-full transition-colors flex-shrink-0"
        style={{
          background: deadline ? colors.bg : "transparent",
          border: `1px solid ${deadline ? colors.border : "#36363A"}`,
          color: deadline ? colors.text : "#71717A",
          padding,
          fontSize,
          fontWeight: 500,
          cursor: canEdit ? "pointer" : "default",
          whiteSpace: "nowrap",
        }}
        title={deadline ? `Due ${formatDeadline(deadline)}` : "Add deadline"}
        onMouseEnter={(e) => {
          if (canEdit && !deadline) {
            e.currentTarget.style.background = "#2C2C2F";
            e.currentTarget.style.color = "#A1A1AA";
          }
        }}
        onMouseLeave={(e) => {
          if (canEdit && !deadline) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "#71717A";
          }
        }}
      >
        {status === "overdue" ? <AlertCircle size={11} /> : <Calendar size={11} />}
        <span>{label}</span>
      </button>

      {open && canEdit && (
        <div
          ref={popoverRef}
          className="fade-in"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            zIndex: 1000,
            width: "280px",
            background: "#1A1A1C",
            border: "1px solid #36363A",
            borderRadius: "10px",
            padding: "12px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
          }}
        >
          <div className="text-[12px] mb-2" style={{ color: "#979393" }}>
            Deadline
          </div>
          <input
            type="datetime-local"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            className="w-full"
            style={{
              background: "#212124",
              border: "1px solid #36363A",
              borderRadius: "8px",
              color: "#E4E4E7",
              padding: "8px 10px",
              fontSize: "13px",
              outline: "none",
              colorScheme: "dark",
            }}
          />
          <div className="flex justify-between items-center gap-2 mt-3">
            {deadline ? (
              <button
                onClick={clear}
                className="text-[12px] transition-colors"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#979393",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#F87171")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#979393")}
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="btn-ghost"
                style={{ padding: "6px 10px", fontSize: "12px" }}
              >
                Cancel
              </button>
              <button
                onClick={commit}
                disabled={!draft}
                className="btn-primary"
                style={{ padding: "6px 10px", fontSize: "12px" }}
              >
                <Check size={11} strokeWidth={2.5} /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
