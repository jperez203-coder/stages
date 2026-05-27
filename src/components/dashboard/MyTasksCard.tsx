"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, AlertCircle } from "lucide-react";
import { BUCKET_PILL, bucketForDeadline } from "@/lib/task-buckets";

/**
 * My Tasks card on the workspace dashboard. Phase 4a step 2.
 *
 * Renders up to 5 tasks assigned to the current user, sorted per the
 * locked rule (overdue first, then deadline asc, then no-deadline by
 * created_at desc). Sorting happens in the parent server component;
 * this client component just renders + handles the + button + row clicks.
 *
 * The + button opens an inline quick-add for STEP 2 = title-only. Step 4
 * expands it with deadline + assignee pickers. For now: submit creates a
 * task assigned to self on... well, that's the hard part. There's no
 * default stage to attach it to.
 *
 * TODO(step 4): the title-only composer in step 2 doesn't have anywhere to
 * write to (a task needs a stage_id). Either (a) prompt user to pick a
 * pipeline/stage in step 2 too, (b) keep the + button visible but disable
 * it with a tooltip "create from a pipeline" until step 4 introduces the
 * full picker, or (c) skip the inline quick-add entirely in step 2.
 * Going with (b) — visible affordance, disabled with tooltip; step 4 wires
 * the real flow.
 */

type Task = {
  id: string;
  title: string;
  deadline: string | null;
  createdAt: string;
  stage: {
    id: string;
    name: string;
    color: string | null;
    position: number;
    pipelineId: string;
    pipelineName: string;
    pipelineEmoji: string;
  };
};

type Props = {
  workspaceName: string;
  workspaceSlug: string;
  tasks: Task[];
  totalCount: number;
  error: string | null;
};

// Deterministic palette pick from pipeline id when stage.color is null.
// Same algorithm shape as UserAvatar.tsx so the color choice is stable
// across renders.
const PALETTE = ["#DF1E5A", "#E273C1", "#21B159", "#36C5EF", "#F59E0B"];
function pickFallbackColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// Date pill: returns label + (isOverdue) flag for the parent to color.
function describeDeadline(deadline: string | null): {
  label: string;
  isOverdue: boolean;
} | null {
  if (!deadline) return null;
  const d = new Date(deadline);
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(todayStart.getDate() + 1);
  const dayAfterTomorrow = new Date(todayStart);
  dayAfterTomorrow.setDate(todayStart.getDate() + 2);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(todayStart.getDate() + 7);

  const isOverdue = d.getTime() < todayStart.getTime();
  if (isOverdue) {
    return {
      label: d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      isOverdue: true,
    };
  }
  if (d.getTime() < tomorrow.getTime()) return { label: "Today", isOverdue: false };
  if (d.getTime() < dayAfterTomorrow.getTime()) return { label: "Tomorrow", isOverdue: false };
  if (d.getTime() < weekEnd.getTime())
    return {
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      isOverdue: false,
    };
  return {
    label: d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    isOverdue: false,
  };
}

export function MyTasksCard({
  workspaceName,
  workspaceSlug,
  tasks,
  totalCount,
  error,
}: Props) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  return (
    <div
      className="rounded-2xl flex flex-col"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        padding: "20px 24px",
      }}
    >
      <header className="flex items-start gap-3">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: "#212124",
            border: "1px solid #36363A",
            fontSize: 24,
          }}
        >
          📝
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-[18px] font-medium text-white">My Tasks</h2>
            <span
              className="inline-flex items-center justify-center text-[12px] font-medium"
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.7)",
                borderRadius: 999,
                padding: "1px 8px",
                minWidth: 22,
              }}
            >
              {totalCount}
            </span>
          </div>
          <div
            className="text-[13px] mt-0.5 truncate"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            {workspaceName}
          </div>
        </div>
        {/* TODO(step 4): wire to real quick-add with stage picker. For
            step 2, this button toggles an explanatory placeholder. */}
        <button
          type="button"
          onClick={() => setQuickAddOpen((v) => !v)}
          className="flex items-center justify-center transition-colors"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: quickAddOpen
              ? "rgba(255,255,255,0.08)"
              : "transparent",
            cursor: "pointer",
            border: "none",
            color: "rgba(255,255,255,0.6)",
          }}
          aria-label="Add task"
          aria-expanded={quickAddOpen}
        >
          <Plus size={18} />
        </button>
      </header>

      {quickAddOpen && (
        <div
          className="mt-4 p-3 rounded-lg text-[12px] leading-relaxed"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          Quick-add lands in step 4 with a stage picker. For now, create
          tasks from inside a pipeline.
        </div>
      )}

      <div className="mt-5 flex-1 flex flex-col">
        {error ? (
          <div
            className="flex items-start gap-2 text-[14px] py-3"
            style={{ color: "#DF1E5A" }}
          >
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Couldn&apos;t load tasks — refresh to try again.</span>
          </div>
        ) : tasks.length === 0 ? (
          // Empty state: vertical-center the emoji + copy inside the
          // flex-1 content area. 👍 matches the figma reference for
          // "nothing assigned" — visually echoes the spec'd 🚀 pattern on
          // the Pipelines empty state. 48px emoji + 16px gap to copy.
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <span
              aria-hidden
              style={{ fontSize: 28, lineHeight: 1, marginBottom: 10 }}
            >
              👍
            </span>
            <p
              className="text-[13px]"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              no task created yet
            </p>
          </div>
        ) : (
          <ul className="space-y-0">
            {tasks.map((task) => {
              // Color the per-task dot + date pill by deadline-urgency
              // bucket (NOT stage color) so this widget matches the
              // /my-tasks page treatment for the same task. Shared
              // BUCKET_PILL map in task-buckets.ts is the single source
              // of truth for both surfaces.
              const deadlineMs = task.deadline
                ? new Date(task.deadline).getTime()
                : null;
              const bucket = bucketForDeadline(deadlineMs);
              const bucketColors = BUCKET_PILL[bucket];
              const pill = describeDeadline(task.deadline);
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => {
                      // Step 5 wires this: router.push(`/w/${slug}/p/
                      // ${pipelineId}?stage=${stageId}`) — pipeline canvas
                      // loads with the relevant stage focused/scrolled-to.
                      // Step 6 may then auto-open the task detail panel
                      // overlay on top of the canvas (Asana/Trello pattern).
                      // Payload already includes the routing target so the
                      // step 5 wire-up is one line.
                      console.log(
                        "[step 2 stub] task row clicked. step 5 routes to pipeline+stage; step 6 opens detail panel.",
                        {
                          taskId: task.id,
                          pipelineId: task.stage.pipelineId,
                          stageId: task.stage.id,
                          source: "dashboard_my_tasks",
                        },
                      );
                    }}
                    className="w-full flex items-center gap-3 transition-colors text-left"
                    style={{
                      // Internal padding + negative horizontal margin so
                      // the hover pill extends 12px into the card's outer
                      // padding on each side. Effect: wider hover surface
                      // without the dot/title content visually shifting.
                      //
                      // Vertical padding is 8px (not 12px) per the figma's
                      // tighter dashboard density. Calibrated in two passes:
                      // first compaction to 6px read too cramped, 8px keeps
                      // rows clearly tighter than the original 12px while
                      // leaving enough breathing room between titles. The
                      // full /my-tasks view keeps its looser 14px for
                      // scan-and-act readability — different surface,
                      // different density rule.
                      padding: "8px 12px",
                      margin: "0 -12px",
                      borderRadius: 10,
                      cursor: "pointer",
                      background: "transparent",
                      border: "none",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        "rgba(255,255,255,0.04)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: bucketColors.color,
                        flexShrink: 0,
                      }}
                      aria-hidden
                    />
                    <span className="flex-1 min-w-0">
                      <span
                        className="block text-[15px] truncate"
                        style={{
                          color: pill?.isOverdue ? "#DF1E5A" : "white",
                        }}
                      >
                        {task.title}
                      </span>
                      {/* Subtitle = pipeline emoji + pipeline name. Two
                          markers on the row: the stage-color dot above
                          (encodes the task's stage) + this emoji (encodes
                          the parent pipeline). When the pipeline has no
                          emoji set, fall back to a pipeline-id-hashed dot. */}
                      <span
                        className="flex items-center gap-1.5 mt-0.5 text-[13px] truncate"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                      >
                        {task.stage.pipelineEmoji ? (
                          <span
                            aria-hidden
                            style={{ fontSize: 13, lineHeight: 1 }}
                          >
                            {task.stage.pipelineEmoji}
                          </span>
                        ) : (
                          <span
                            aria-hidden
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: pickFallbackColor(
                                task.stage.pipelineId,
                              ),
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span className="truncate">
                          {task.stage.pipelineName}
                        </span>
                      </span>
                    </span>
                    {pill && (
                      <span
                        className="flex-shrink-0 text-[12px] font-medium"
                        style={{
                          background: bucketColors.bg,
                          color: bucketColors.color,
                          padding: "4px 10px",
                          borderRadius: 6,
                        }}
                      >
                        {pill.label}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div
        className="mt-4 pt-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Footer color is count-conditional per spec: grey when there's
            nothing to see, the figma's light-blue text token when there's
            a count > 0. Same conditional + same token apply to ActivityCard
            and the Team strip's "Open chat" link — keeps active text-link
            color consistent across dashboard surfaces. */}
        <Link
          href={`/w/${workspaceSlug}/my-tasks`}
          className="text-[14px] font-medium"
          style={{ color: totalCount > 0 ? "#7FA7D9" : "#979393" }}
        >
          See all {totalCount} →
        </Link>
      </div>
    </div>
  );
}
