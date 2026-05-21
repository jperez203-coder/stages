import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { TaskWithMeta } from "./types";

/**
 * /w/[slug]/my-tasks/recently-done view.
 *
 * Flat record list of tasks the current user has COMPLETED within the
 * last 7 days. No buckets, no chips, no search, no restore button.
 * Completion is the signal; the 7-day rolling window is the only filter.
 * The list is read-only — to "un-complete" a task, the user goes back
 * to the active /my-tasks view and unchecks it there (it'll only appear
 * there for tasks completed today, since the active view's auto-hide
 * filter excludes completed-before-today). Permanent delete lives in
 * the task detail panel (step 6) with a confirm.
 *
 * Server component-friendly: no `"use client"` directive. All state
 * is server-rendered; navigation happens via <Link>.
 */

const PALETTE = ["#DF1E5A", "#E273C1", "#21B159", "#36C5EF", "#F59E0B"];
function pickFallbackColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const COMPLETED_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

type Props = {
  workspaceSlug: string;
  tasks: TaskWithMeta[];
  fetchError: string | null;
};

export function RecentlyDoneView({
  workspaceSlug,
  tasks,
  fetchError,
}: Props) {
  return (
    <div className="flex-1 flex flex-col">
      {/* Header band — same treatment as /my-tasks (solid bg, no dots,
          subtle bottom stroke). */}
      <div
        className="px-6 sm:px-12"
        style={{
          background: "#212124",
          borderBottom: "1px solid #36363A",
          paddingTop: 20,
          paddingBottom: 20,
        }}
      >
        <div className="max-w-[1600px] mx-auto">
          <header className="flex items-center gap-3">
            <Link
              href={`/w/${workspaceSlug}/my-tasks`}
              className="flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#212124",
                border: "1px solid #36363A",
                color: "rgba(255,255,255,0.7)",
              }}
              aria-label="Back to My Tasks"
            >
              <ArrowLeft size={16} />
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-[24px] font-semibold text-white">
                  Recently done
                </h1>
                <span
                  className="inline-flex items-center text-[12px] font-medium"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.7)",
                    borderRadius: 999,
                    padding: "2px 10px",
                  }}
                >
                  {tasks.length}
                </span>
              </div>
              <p
                className="text-[13px] mt-0.5"
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                Tasks you completed in the last 7 days.
              </p>
            </div>
          </header>
        </div>
      </div>

      {/* List area — dotted-grid backdrop, same as /my-tasks. */}
      <div className="dotted-grid flex-1 px-6 sm:px-12 py-6">
        <div className="max-w-[1600px] mx-auto">
          {fetchError ? (
            <div
              className="p-3 rounded-lg flex items-start gap-2 text-[13px]"
              style={{
                background: "rgba(223,30,90,0.08)",
                border: "1px solid rgba(223,30,90,0.35)",
                color: "#DF1E5A",
              }}
            >
              Couldn&apos;t load tasks — refresh to try again. ({fetchError})
            </div>
          ) : tasks.length === 0 ? (
            <div
              className="rounded-2xl flex flex-col items-center text-center"
              style={{
                background: "#2C2C2F",
                border: "1px solid #36363A",
                padding: "48px 24px",
              }}
            >
              <span
                aria-hidden
                style={{ fontSize: 28, lineHeight: 1, marginBottom: 10 }}
              >
                ✅
              </span>
              <p
                className="text-[13px] max-w-[420px]"
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                Nothing here yet. Tasks you complete will appear here for
                7 days, then roll off.
              </p>
            </div>
          ) : (
            <div
              className="rounded-xl overflow-hidden"
              style={{
                background: "#2C2C2F",
                border: "1px solid #36363A",
              }}
            >
              {tasks.map((task, idx) => (
                <RecentlyDoneRow
                  key={task.id}
                  task={task}
                  isLast={idx === tasks.length - 1}
                  pipelineFallbackColor={pickFallbackColor(
                    task.stage.pipelineId,
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Single recently-done row ────────────────────────────────────────────

function RecentlyDoneRow({
  task,
  isLast,
  pipelineFallbackColor,
}: {
  task: TaskWithMeta;
  isLast: boolean;
  pipelineFallbackColor: string;
}) {
  const completedLabel = task.completedAt
    ? COMPLETED_DATE_FMT.format(new Date(task.completedAt))
    : "";

  return (
    <div
      className="flex items-center gap-3"
      style={{
        padding: "14px 16px",
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="text-[14px] truncate"
          style={{
            color: "rgba(255,255,255,0.6)",
            textDecoration: "line-through",
            fontWeight: 500,
          }}
        >
          {task.title}
        </div>
        <div
          className="flex items-center gap-1.5 mt-0.5 text-[12px] truncate"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          {task.stage.pipelineEmoji ? (
            <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>
              {task.stage.pipelineEmoji}
            </span>
          ) : (
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: pipelineFallbackColor,
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

      <span
        className="text-[11px] flex-shrink-0 font-medium"
        style={{
          background: "#1F4535",
          color: "#15B981",
          padding: "4px 10px",
          borderRadius: 6,
        }}
      >
        {completedLabel}
      </span>
    </div>
  );
}
