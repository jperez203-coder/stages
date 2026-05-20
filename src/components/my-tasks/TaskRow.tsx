"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import type { TaskWithMeta } from "./types";
import type { Bucket } from "@/lib/task-buckets";
import { DatePickerPopover } from "./DatePickerPopover";

/**
 * Task row for the My Tasks list view (step 4). Differs from the
 * dashboard's inline rows: includes a checkbox, the fuller "pipeline
 * emoji + name · Stage N · stage name" subtitle, and a clickable date
 * pill that opens the date picker.
 *
 * Pill colors are BUCKET-colored here (urgency-first surface), not
 * pipeline-colored. See MyTasksView for the rationale.
 *
 * Pipeline emoji fallback: when null, render a small color dot derived
 * from the pipeline id (same fallback as the dashboard's MyTasksCard
 * subtitle).
 */

const PALETTE = ["#DF1E5A", "#E273C1", "#21B159", "#36C5EF", "#F59E0B"];
function pickFallbackColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// Bucket → pill color treatment. Today / Overdue use the same red token
// but Overdue ALSO gets the red-title + original-date treatment below.
const BUCKET_PILL: Record<Bucket, { color: string; bgOpacity: number }> = {
  overdue: { color: "#DF1E5A", bgOpacity: 0.18 },
  today: { color: "#DF1E5A", bgOpacity: 0.18 },
  tomorrow: { color: "#E273C1", bgOpacity: 0.15 },
  thisWeek: { color: "#21B159", bgOpacity: 0.15 },
  later: { color: "#979393", bgOpacity: 0.12 },
  noDate: { color: "#979393", bgOpacity: 0 },
};

// Pill label derivation. Same calendar-day boundaries as the bucketing
// logic; reused here for the label text rather than re-deriving.
function pillLabelFor(bucket: Bucket, deadline: string | null): string {
  if (deadline === null) return "";
  const d = new Date(deadline);
  switch (bucket) {
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow";
    case "overdue":
    case "later":
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    case "thisWeek":
      return d.toLocaleDateString(undefined, { weekday: "short" });
    case "noDate":
      return "";
  }
}

type Props = {
  task: TaskWithMeta;
  bucket: Bucket;
  isLast: boolean;
  onToggleComplete: (taskId: string) => void;
  onDeadlineChange: (taskId: string, deadline: string | null) => void;
};

export function TaskRow({
  task,
  bucket,
  isLast,
  onToggleComplete,
  onDeadlineChange,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const isOverdue = bucket === "overdue";
  const pillTreatment = BUCKET_PILL[bucket];
  const pillLabel = pillLabelFor(bucket, task.deadline);

  // Subtitle: "[emoji] [pipeline name] · Stage [N] · [stage name]"
  const pipelineEmoji = task.stage.pipelineEmoji;
  const fallbackDotColor = pickFallbackColor(task.stage.pipelineId);

  const titleColor = task.done
    ? "rgba(255,255,255,0.4)"
    : isOverdue
      ? "#DF1E5A"
      : "white";
  const titleDecoration = task.done ? "line-through" : "none";

  return (
    <div
      className="flex items-center gap-3 transition-colors relative"
      style={{
        padding: "14px 16px",
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = "transparent")
      }
    >
      {/* Checkbox — toggles completed_at via the parent's mutation handler */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleComplete(task.id);
        }}
        className="flex items-center justify-center flex-shrink-0 transition-colors"
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          background: task.done ? "#108CE9" : "transparent",
          border: task.done
            ? "1px solid #108CE9"
            : "1.5px solid rgba(255,255,255,0.3)",
          cursor: "pointer",
        }}
        aria-label={task.done ? "Mark incomplete" : "Mark complete"}
        aria-pressed={task.done}
      >
        {task.done && <Check size={12} color="white" strokeWidth={3} />}
      </button>

      {/* Title + subtitle */}
      <button
        type="button"
        onClick={() => {
          console.log(
            "[step 4] task row clicked, detail panel arrives step 6.",
            { taskId: task.id },
          );
        }}
        className="flex-1 min-w-0 text-left"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <div
          className="text-[14px] truncate"
          style={{
            color: titleColor,
            textDecoration: titleDecoration,
            fontWeight: 500,
          }}
        >
          {task.title}
        </div>
        <div
          className="flex items-center gap-1.5 mt-0.5 text-[12px] truncate"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          {pipelineEmoji ? (
            <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>
              {pipelineEmoji}
            </span>
          ) : (
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: fallbackDotColor,
                flexShrink: 0,
              }}
            />
          )}
          <span className="truncate">
            {task.stage.pipelineName} · Stage {task.stage.position} ·{" "}
            {task.stage.name}
          </span>
        </div>
      </button>

      {/* Date pill — clicking opens the picker. Null deadline shows
          "+ add date" affordance instead. */}
      <div className="relative flex-shrink-0">
        {task.done ? (
          <span
            className="text-[11px] font-medium"
            style={{
              background: "rgba(33,177,89,0.15)",
              color: "#21B159",
              padding: "4px 10px",
              borderRadius: 6,
            }}
          >
            Done
          </span>
        ) : task.deadline === null ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen((v) => !v);
            }}
            className="text-[12px] flex items-center gap-1 transition-colors"
            style={{
              color: "rgba(255,255,255,0.4)",
              background: "transparent",
              border: "1px dashed rgba(255,255,255,0.15)",
              padding: "4px 10px",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            <Plus size={11} />
            Add date
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen((v) => !v);
            }}
            className="text-[11px] font-medium transition-opacity"
            style={{
              background: `rgba(${hexToRgb(pillTreatment.color)},${pillTreatment.bgOpacity})`,
              color: pillTreatment.color,
              padding: "4px 10px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
            }}
          >
            {pillLabel}
          </button>
        )}

        {pickerOpen && (
          <DatePickerPopover
            currentDeadline={task.deadline}
            onSelect={(newDeadline) => {
              setPickerOpen(false);
              onDeadlineChange(task.id, newDeadline);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// Tiny inline helper to keep the JSX clean. The bucket palette uses hex
// colors; the pill needs rgba bg for opacity control.
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r},${g},${b}`;
}
