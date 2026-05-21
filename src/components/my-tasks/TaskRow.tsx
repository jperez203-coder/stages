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

// Bucket → pill color treatment. Urgency gradient runs:
//   red (Overdue/Today) → pink (Tomorrow) → blue (This week)
//   → grey (Later / No date)
// Green is RESERVED for the "Done" badge (rendered separately below) so a
// completed row and an upcoming "Sun"/"Wed" row never look the same color
// at a glance. Earlier rev used green for thisWeek too — fine in isolation,
// but a screen with a Done and a thisWeek pill side-by-side was hard to
// scan. Blue keeps the "calm, planned, not urgent" semantic without
// colliding with completion green.
//
// `bg` is explicit (rgba or hex) rather than derived from color+opacity —
// lets specific buckets use locked figma tokens without breaking the
// shared rendering path.
const BUCKET_PILL: Record<Bucket, { color: string; bg: string }> = {
  overdue:  { color: "#DF1E5A", bg: "rgba(223,30,90,0.18)" },
  today:    { color: "#DF1E5A", bg: "rgba(223,30,90,0.18)" },
  tomorrow: { color: "#E273C1", bg: "rgba(226,115,193,0.15)" },
  thisWeek: { color: "#108CE9", bg: "rgba(16,140,233,0.15)" },
  later:    { color: "#979393", bg: "rgba(151,147,147,0.12)" },
  noDate:   { color: "#979393", bg: "transparent" },
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
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.02)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
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

      {/* Title + subtitle. `<div role="button">` rather than a real
          `<button>` because step 5 wires the row click to route to the
          pipeline+stage and step 6 may want to nest additional inline
          controls here (assignee chip, deadline chip) — keeping the
          outer role-button avoids invalid nested-button HTML when those
          land. Today it's just the click+keyboard surface. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          // Step 5 wires this: router.push(`/w/${slug}/p/${pipelineId}
          // ?stage=${stageId}`) — pipeline canvas loads with the
          // relevant stage focused. Step 6 may then auto-open the task
          // detail panel overlay (Asana/Trello pattern). Payload already
          // includes the routing target so step 5 is a one-line wire-up.
          console.log(
            "[step 4] task row clicked. step 5 routes to pipeline+stage; step 6 opens detail panel.",
            {
              taskId: task.id,
              pipelineId: task.stage.pipelineId,
              stageId: task.stage.id,
            },
          );
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            console.log(
              "[step 4] task row clicked (kbd). step 5 routes to pipeline+stage; step 6 opens detail panel.",
              {
                taskId: task.id,
                pipelineId: task.stage.pipelineId,
                stageId: task.stage.id,
              },
            );
          }
        }}
        className="flex-1 min-w-0 text-left"
        style={{ cursor: "pointer" }}
      >
        {/* Title line. flex-1 + truncate on the span so long titles
            ellipsis-truncate inside the row's content area. */}
        <div className="flex items-center gap-1.5">
          <span
            className="text-[14px] truncate"
            style={{
              color: titleColor,
              textDecoration: titleDecoration,
              fontWeight: 500,
              flex: 1,
              minWidth: 0,
            }}
          >
            {task.title}
          </span>
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
      </div>

      {/* Date pill — clicking opens the picker. Null deadline shows
          "+ add date" affordance instead. */}
      <div className="relative flex-shrink-0">
        {task.done ? (
          <span
            className="text-[11px] font-medium"
            style={{
              background: "#1F4535",
              color: "#15B981",
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
              background: pillTreatment.bg,
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

