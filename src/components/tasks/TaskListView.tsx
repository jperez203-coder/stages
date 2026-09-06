"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Filter, Search, Plus, Flag } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { HomeTabs } from "@/components/home/HomeTabs";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import { bucketForDeadline, bucketMatchesChip, type Chip } from "@/lib/task-buckets";
import type { TaskRow } from "@/components/tasks/types";
import { TaskGroupBadgeNotStarted } from "@/components/icons/TaskGroupBadgeNotStarted";
import { TaskGroupBadgeInProgress } from "@/components/icons/TaskGroupBadgeInProgress";
import { TaskGroupBadgeOverdue } from "@/components/icons/TaskGroupBadgeOverdue";

/**
 * /w/[slug]/tasks body — the global Task tab (Figma V2).
 *
 * GROUPING (separate axis from the filter pills below):
 *   Overdue      — bucketForDeadline === "overdue" (deadline in the past).
 *                  Takes precedence over status — an overdue task shows
 *                  here regardless of its status value.
 *   In progress  — not overdue, status === "in_progress".
 *   Not started  — not overdue, status === "not_started".
 * Only not-done tasks reach this component at all (the server query
 * already filters done=false), matching My Tasks' "active work list"
 * convention — done tasks aren't part of this view.
 *
 * FILTER PILLS reuse the exact same bucket/chip logic as My Tasks
 * (src/lib/task-buckets.ts) for cross-surface consistency — "Today"
 * folds in overdue there, so it does here too, even though grouping
 * keeps Overdue visually separate. Pills narrow which rows show inside
 * whichever groups they still belong to; they don't change the grouping
 * itself.
 *
 * NOT WIRED YET (flagged, not faked): the "+ Task" button, the "+ Add
 * Task" row per group, and the filter/search icons are visual-only —
 * same documented gap as MyTasksCard's + button (creating a task needs a
 * pipeline/stage picker that doesn't exist yet). Assignees are read-only
 * here too; there's no picker UI for task_assignees yet.
 *
 * Priority and Status ARE both live — plain <select> pickers (not in the
 * original screenshot, which had no Status column, but added since moving
 * a task between the In progress / Not started groups needs SOME control
 * and nothing else suggested one) that write straight to Supabase and
 * immediately re-bucket the row via the `groups` memo above.
 */

const PRIORITY_META: Record<
  NonNullable<TaskRow["priority"]>,
  { label: string; color: string }
> = {
  urgent: { label: "Urgent", color: "#F43F5E" },
  high: { label: "High", color: "#F59E0B" },
  normal: { label: "Normal", color: "#108CE9" },
  low: { label: "Low", color: "#71717A" },
};

const GROUP_META = {
  overdue: { label: "Overdue", color: "#F43F5E", bg: "#F43F5E" },
  in_progress: { label: "In progress", color: "#108CE9", bg: "#108CE9" },
  not_started: { label: "Not started", color: "#71717A", bg: "#71717A" },
} as const;

const STATUS_META: Record<TaskRow["status"], { label: string; color: string }> = {
  not_started: { label: "Not started", color: GROUP_META.not_started.color },
  in_progress: { label: "In progress", color: GROUP_META.in_progress.color },
};

type GroupKey = keyof typeof GROUP_META;

// Figma-supplied pill graphics (label baked in as vector paths, not real
// text) — one exact SVG per group state. The numeric count still renders
// as a separate sibling element next to the badge, same as before.
function GroupBadge({ group }: { group: GroupKey }) {
  if (group === "overdue") return <TaskGroupBadgeOverdue height={26} />;
  if (group === "in_progress") return <TaskGroupBadgeInProgress height={26} />;
  return <TaskGroupBadgeNotStarted height={26} />;
}

function groupForTask(task: TaskRow): GroupKey {
  const deadlineMs = task.deadline ? new Date(task.deadline).getTime() : null;
  if (bucketForDeadline(deadlineMs) === "overdue") return "overdue";
  return task.status === "in_progress" ? "in_progress" : "not_started";
}

function formatDueDate(deadline: string | null): string {
  if (!deadline) return "";
  const d = new Date(deadline);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(todayStart.getDate() + 1);
  if (d.getTime() < todayStart.getTime())
    return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
  if (d.getTime() < tomorrow.getTime()) return "Today";
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(tomorrow.getDate() + 1);
  if (d.getTime() < dayAfter.getTime()) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "thisWeek", label: "This week" },
  { key: "later", label: "Later" },
  { key: "noDate", label: "No date" },
];

export function TaskListView({
  slug,
  firstName,
  initialTasks,
}: {
  slug: string;
  firstName: string | null;
  initialTasks: TaskRow[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [activeChip, setActiveChip] = useState<Chip>("all");
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());

  const chipCounts = useMemo(() => {
    const counts: Record<Chip, number> = { all: tasks.length, today: 0, thisWeek: 0, later: 0, noDate: 0 };
    for (const t of tasks) {
      const ms = t.deadline ? new Date(t.deadline).getTime() : null;
      const bucket = bucketForDeadline(ms);
      for (const chip of CHIPS) {
        if (chip.key !== "all" && bucketMatchesChip(bucket, chip.key)) {
          counts[chip.key] += 1;
        }
      }
    }
    return counts;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (activeChip === "all") return tasks;
    return tasks.filter((t) => {
      const ms = t.deadline ? new Date(t.deadline).getTime() : null;
      return bucketMatchesChip(bucketForDeadline(ms), activeChip);
    });
  }, [tasks, activeChip]);

  const groups = useMemo(() => {
    const map: Record<GroupKey, TaskRow[]> = { overdue: [], in_progress: [], not_started: [] };
    for (const t of visibleTasks) map[groupForTask(t)].push(t);
    return map;
  }, [visibleTasks]);

  const toggleGroup = (key: GroupKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updatePriority = async (taskId: string, priority: TaskRow["priority"]) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, priority } : t)));
    const { error } = await supabase.from("tasks").update({ priority }).eq("id", taskId);
    if (error) console.error("[tasks] priority update failed:", error.message);
  };

  const updateStatus = async (taskId: string, status: TaskRow["status"]) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status } : t)));
    const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
    if (error) console.error("[tasks] status update failed:", error.message);
  };

  return (
    <div className="dotted-grid flex-1 px-6 pt-3 pb-6 overflow-y-auto">
      <div className="max-w-[1600px] mx-auto mb-4">
        <HomeGreeting firstName={firstName} />
      </div>

      <div className="mb-6">
        <HomeTabs activeTab="tasks" slug={slug} />
      </div>

      <div className="max-w-[1600px] mx-auto">
        {/* Filter pills + right-side actions */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {CHIPS.map((chip) => {
              const isActive = activeChip === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setActiveChip(chip.key)}
                  className="flex items-center gap-1.5 rounded-full transition-colors"
                  style={{
                    padding: "2px 12px",
                    fontSize: 12,
                    background: isActive ? "#2C2C2F" : "transparent",
                    border: "1px solid #36363A",
                    color: isActive ? "#E4E4E7" : "#979393",
                    cursor: "pointer",
                  }}
                >
                  {chip.label} {chip.key === "all" ? chipCounts.all : chipCounts[chip.key]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              title="Filter (coming soon)"
              disabled
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 32, height: 32, background: "transparent", border: "none", color: "#71717A", cursor: "not-allowed" }}
            >
              <Filter size={16} />
            </button>
            <button
              type="button"
              title="Search (coming soon)"
              disabled
              className="flex items-center justify-center rounded transition-colors"
              style={{ width: 32, height: 32, background: "transparent", border: "none", color: "#71717A", cursor: "not-allowed" }}
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              title="Create a task from within a project for now"
              disabled
              className="flex items-center gap-1.5 rounded-md"
              style={{
                padding: "7px 12px",
                fontSize: 13,
                fontWeight: 500,
                background: "#108CE9",
                border: "none",
                color: "#fff",
                opacity: 0.5,
                cursor: "not-allowed",
              }}
            >
              <Plus size={14} /> Task
            </button>
          </div>
        </div>

        {(["overdue", "in_progress", "not_started"] as GroupKey[]).map((key) => {
          const groupTasks = groups[key];
          if (groupTasks.length === 0) return null;
          const meta = GROUP_META[key];
          const isCollapsed = collapsed.has(key);
          return (
            <div key={key} className="mb-6">
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                className="flex items-center gap-2 mb-2"
                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
              >
                {isCollapsed ? (
                  <ChevronRight size={14} color="#71717A" />
                ) : (
                  <ChevronDown size={14} color="#71717A" />
                )}
                <GroupBadge group={key} />
                <span className="text-[13px]" style={{ color: "#71717A" }}>
                  {groupTasks.length}
                </span>
              </button>

              {!isCollapsed && (
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2D2E30" }}>
                      <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A" }}>Name</th>
                      <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A", width: 110 }}>Priority</th>
                      <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A", width: 120 }}>Status</th>
                      <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A", width: 160 }}>Pipeline</th>
                      <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A", width: 120 }}>Assignees</th>
                      <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A", width: 100 }}>Due date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupTasks.map((task) => {
                      const dueLabel = formatDueDate(task.deadline);
                      const isOverdue = key === "overdue";
                      return (
                        <tr key={task.id} style={{ borderBottom: "1px solid #212124" }}>
                          <td style={{ padding: "8px" }}>
                            <div className="flex items-center gap-2">
                              <span
                                aria-hidden
                                style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, flexShrink: 0 }}
                              />
                              <span className="text-[13px]" style={{ color: "#E4E4E7" }}>{task.title}</span>
                            </div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div className="flex items-center gap-1.5">
                              <Flag
                                size={12}
                                color={task.priority ? PRIORITY_META[task.priority].color : "#3A3A3E"}
                                fill={task.priority ? PRIORITY_META[task.priority].color : "none"}
                              />
                              <select
                                value={task.priority ?? ""}
                                onChange={(e) =>
                                  updatePriority(task.id, (e.target.value || null) as TaskRow["priority"])
                                }
                                className="text-[13px] outline-none"
                                style={{ background: "transparent", border: "none", color: "#E4E4E7", cursor: "pointer" }}
                              >
                                <option value="" style={{ background: "#212124" }}>—</option>
                                {(Object.keys(PRIORITY_META) as (keyof typeof PRIORITY_META)[]).map((p) => (
                                  <option key={p} value={p} style={{ background: "#212124" }}>
                                    {PRIORITY_META[p].label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div className="flex items-center gap-1.5">
                              <span
                                aria-hidden
                                style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_META[task.status].color, flexShrink: 0 }}
                              />
                              <select
                                value={task.status}
                                onChange={(e) => updateStatus(task.id, e.target.value as TaskRow["status"])}
                                className="text-[13px] outline-none"
                                style={{ background: "transparent", border: "none", color: "#E4E4E7", cursor: "pointer" }}
                              >
                                {(Object.keys(STATUS_META) as TaskRow["status"][]).map((s) => (
                                  <option key={s} value={s} style={{ background: "#212124" }}>
                                    {STATUS_META[s].label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div className="flex items-center gap-1.5">
                              <span style={{ fontSize: 13 }}>{task.pipeline.emoji}</span>
                              <span className="text-[13px] truncate" style={{ color: "#979393" }}>
                                {task.pipeline.name}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div className="flex items-center" style={{ marginLeft: 4 }}>
                              {task.assignees.length === 0 ? (
                                <span className="text-[13px]" style={{ color: "#3A3A3E" }}>—</span>
                              ) : (
                                task.assignees.map((a) => {
                                  const { text, bg } = getAvatarColorFromUserId(a.id);
                                  return (
                                    <div
                                      key={a.id}
                                      title={a.displayName ?? undefined}
                                      className="flex items-center justify-center rounded-full text-[11px] font-medium"
                                      style={{
                                        width: 22,
                                        height: 22,
                                        marginLeft: -4,
                                        background: bg,
                                        color: text,
                                        border: "1.5px solid #17171A",
                                      }}
                                    >
                                      {resolveInitial({ display_name: a.displayName })}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            {dueLabel ? (
                              <span className="text-[13px]" style={{ color: isOverdue ? "#F43F5E" : "#979393" }}>
                                {dueLabel}
                              </span>
                            ) : (
                              <span className="text-[13px]" style={{ color: "#3A3A3E" }}>Add date</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {!isCollapsed && key !== "overdue" && (
                <button
                  type="button"
                  disabled
                  title="Create a task from within a project for now"
                  className="flex items-center gap-1.5 mt-1"
                  style={{ padding: "6px 8px", background: "transparent", border: "none", color: "#3A3A3E", cursor: "not-allowed", fontSize: 13 }}
                >
                  <Plus size={13} /> Add Task
                </button>
              )}
            </div>
          );
        })}

        {tasks.length === 0 && (
          <p className="text-[14px]" style={{ color: "#71717A" }}>
            No open tasks in this workspace.
          </p>
        )}
      </div>
    </div>
  );
}
