"use client";

import { useMemo, useState } from "react";
import { Filter, Search, Plus, Flag } from "lucide-react";
import { SidebarChevron } from "@/components/icons/SidebarChevron";
import { supabase } from "@/lib/supabase";
import { HomeGreeting } from "@/components/home/HomeGreeting";
import { HomeTabs } from "@/components/home/HomeTabs";
import Image from "next/image";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import { sortAssigneesForViewer } from "@/lib/sort-assignees";
import { bucketForDeadline, bucketMatchesChip, type Chip } from "@/lib/task-buckets";
import type { TaskAssignee, TaskRow } from "@/components/tasks/types";
import { TaskGroupBadgeNotStarted } from "@/components/icons/TaskGroupBadgeNotStarted";
import { TaskGroupBadgeInProgress } from "@/components/icons/TaskGroupBadgeInProgress";
import { TaskGroupBadgeOverdue } from "@/components/icons/TaskGroupBadgeOverdue";
import { TaskCreateButtonGraphic } from "@/components/icons/TaskCreateButtonGraphic";
import { DueDatePopover } from "@/components/tasks/DueDatePopover";
import { PriorityPopover } from "@/components/tasks/PriorityPopover";
import { StatusPopover, type StatusSelection } from "@/components/tasks/StatusPopover";
import { AssigneesPopover } from "@/components/tasks/AssigneesPopover";
import { GlobalTaskDetailPanel } from "@/components/tasks/GlobalTaskDetailPanel";

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
 * pipeline/stage picker that doesn't exist yet). Assignees IS live here
 * too now (AssigneesPopover, same component the task detail panel uses)
 * — clicking the cell's avatars/— opens the same name-search picker.
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
  currentUserId,
}: {
  slug: string;
  firstName: string | null;
  initialTasks: TaskRow[];
  currentUserId: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [activeChip, setActiveChip] = useState<Chip>("all");
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const [openDatePickerTaskId, setOpenDatePickerTaskId] = useState<string | null>(null);
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null);
  const [openPriorityTaskId, setOpenPriorityTaskId] = useState<string | null>(null);
  const [priorityAnchor, setPriorityAnchor] = useState<HTMLElement | null>(null);
  const [openStatusTaskId, setOpenStatusTaskId] = useState<string | null>(null);
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
  const [openAssigneesTaskId, setOpenAssigneesTaskId] = useState<string | null>(null);
  const [assigneesAnchor, setAssigneesAnchor] = useState<HTMLElement | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  // Shared patch applier used by the detail panel — marking a task done
  // drops it from this not-done list, same as the table cell's Complete
  // handler in updateStatus below.
  const applyTaskPatch = (taskId: string, patch: Partial<TaskRow>) => {
    if (patch.done === true) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      return;
    }
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)));
  };

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
    setOpenPriorityTaskId(null);
    const { error } = await supabase.from("tasks").update({ priority }).eq("id", taskId);
    if (error) console.error("[tasks] priority update failed:", error.message);
  };

  const updateStatus = async (taskId: string, selection: StatusSelection) => {
    setOpenStatusTaskId(null);
    if (selection === "complete") {
      // Completed tasks drop out of this not-done list, matching the
      // server query's `.eq("done", false)` filter.
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      const { error } = await supabase.from("tasks").update({ done: true }).eq("id", taskId);
      if (error) console.error("[tasks] status update failed:", error.message);
      return;
    }
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: selection, done: false } : t)));
    const { error } = await supabase.from("tasks").update({ status: selection, done: false }).eq("id", taskId);
    if (error) console.error("[tasks] status update failed:", error.message);
  };

  const updateDeadline = async (taskId: string, deadline: string | null) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, deadline } : t)));
    setOpenDatePickerTaskId(null);
    const { error } = await supabase.from("tasks").update({ deadline }).eq("id", taskId);
    if (error) console.error("[tasks] deadline update failed:", error.message);
  };

  // AssigneesPopover writes its own task_assignees inserts/deletes as each
  // row is toggled — this just keeps the local list in sync, same as
  // GlobalTaskDetailPanel's handleAssigneesChange.
  const updateAssignees = (taskId: string, assignees: TaskAssignee[]) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, assignees } : t)));
  };

  return (
    <div className="dotted-grid flex-1 px-6 pt-3 pb-6 overflow-y-auto overflow-x-hidden">
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
              style={{ background: "transparent", border: "none", padding: 0, opacity: 0.6, cursor: "not-allowed" }}
            >
              <TaskCreateButtonGraphic height={28} />
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
                <SidebarChevron open={!isCollapsed} size={9} />
                <GroupBadge group={key} />
                <span className="text-[13px]" style={{ color: "#71717A" }}>
                  {groupTasks.length}
                </span>
              </button>

              {!isCollapsed && (
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #2D2E30", transition: "border-color 100ms ease-out" }}>
                      <th className="text-left font-normal text-[13px]" style={{ padding: "6px 8px", color: "#71717A", position: "relative" }}>
                        Name
                        {/* Widened by the FIRST body row's hover (it has no
                            previousElementSibling in tbody to borrow from,
                            since the header lives in a separate <thead>) —
                            see that row's onMouseEnter/onMouseLeave. */}
                        <div
                          className="header-divider-bottom"
                          // zIndex 2, above row-hover-fill's 0: the first
                          // body row's fill extends 1px upward (same -1
                          // trick that closes the row-to-row gap) into this
                          // exact seam, and <tbody> content can win the
                          // paint-order race against <thead> content even
                          // though this div is declared earlier in the
                          // DOM — an explicit higher z-index settles it
                          // instead of leaving it to table-painting quirks.
                          style={{ position: "absolute", bottom: -1, left: -9999, right: -9999, height: 1, background: "#2D2E30", opacity: 0, transition: "opacity 100ms ease-out", pointerEvents: "none", zIndex: 2 }}
                        />
                      </th>
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
                        <tr
                          key={task.id}
                          style={{ borderBottom: "1px solid #212124", transition: "border-color 100ms ease-out" }}
                          onMouseEnter={(e) => {
                            const row = e.currentTarget;
                            // Hide the row's OWN native border and reveal
                            // its full-bleed replacement — never both at
                            // once, which was the earlier bug: two nearly-
                            // identical lines at slightly different
                            // sub-pixel positions read as a doubled/ridged
                            // line. The seam ABOVE this row is a different
                            // element's border (the previous row's own
                            // borderBottom, or the header's, in collapsed-
                            // border tables — a row never draws its own
                            // top edge), so widening it means reaching that
                            // sibling and doing the exact same swap on it.
                            row.style.borderBottomColor = "transparent";
                            row.querySelector<HTMLElement>(".row-hover-fill")!.style.opacity = "1";
                            row.querySelector<HTMLElement>(".row-divider-bottom")!.style.opacity = "1";
                            const prev = row.previousElementSibling as HTMLElement | null;
                            if (prev) {
                              prev.style.borderBottomColor = "transparent";
                              prev.querySelector<HTMLElement>(".row-divider-bottom")!.style.opacity = "1";
                            } else {
                              // First row in the group — nothing to borrow
                              // from in tbody, so reach into this table's
                              // own <thead> row instead.
                              const headerRow = row.closest("table")?.querySelector<HTMLElement>("thead tr");
                              if (headerRow) {
                                headerRow.style.borderBottomColor = "transparent";
                                headerRow.querySelector<HTMLElement>(".header-divider-bottom")!.style.opacity = "1";
                              }
                            }
                          }}
                          onMouseLeave={(e) => {
                            const row = e.currentTarget;
                            row.style.borderBottomColor = "#212124";
                            row.querySelector<HTMLElement>(".row-hover-fill")!.style.opacity = "0";
                            row.querySelector<HTMLElement>(".row-divider-bottom")!.style.opacity = "0";
                            const prev = row.previousElementSibling as HTMLElement | null;
                            if (prev) {
                              prev.style.borderBottomColor = "#212124";
                              prev.querySelector<HTMLElement>(".row-divider-bottom")!.style.opacity = "0";
                            } else {
                              const headerRow = row.closest("table")?.querySelector<HTMLElement>("thead tr");
                              if (headerRow) {
                                headerRow.style.borderBottomColor = "#2D2E30";
                                headerRow.querySelector<HTMLElement>(".header-divider-bottom")!.style.opacity = "0";
                              }
                            }
                          }}
                        >
                          <td style={{ padding: "8px", position: "relative" }}>
                            {/* Full-bleed hover highlight, decoupled from the
                                divider lines. A huge box-shadow spread on
                                the <tr> (the "usual" CSS trick for this)
                                rendered as a broken oversized block in
                                testing — box-shadow on table-row elements
                                isn't reliable. This absolutely-positioned
                                overlay, anchored to the row's own height
                                via this first cell's position:relative,
                                escapes the table's (narrower, capped) width
                                via large negative left/right insets — a
                                normal layout property, not a paint effect,
                                so it's reliable. The root container clips
                                it at the panel's true edges via an explicit
                                overflow-x-hidden (relying on overflow-y-
                                auto's implicit "other axis becomes auto"
                                behavior instead let the -9999px elements'
                                layout size make the page HORIZONTALLY
                                SCROLLABLE — clipped from view, but still
                                draggable into empty space).
                                Fill and divider are two independently-
                                toggled pieces (not one wrapper) because the
                                divider-bottom piece gets BORROWED by the
                                row below when IT is hovered (to widen the
                                seam above the hovered row without a second
                                competing line) — if they shared one
                                wrapper's opacity, borrowing it would wrongly
                                light up this row's own background fill
                                too. */}
                            <div
                              className="row-hover-fill"
                              // top/bottom -1, not 0: absolute insets land
                              // on the td's PADDING edge, but the collapsed
                              // border still reserves a 1px strip just
                              // outside that (even with its color set to
                              // transparent, the width isn't removed) — a
                              // 1px sliver of plain page background was
                              // showing through there. Extending by 1px
                              // overlaps into that reserved strip instead
                              // of stopping just short of it.
                              style={{ position: "absolute", top: -1, bottom: -1, left: -9999, right: -9999, background: "#121214", opacity: 0, transition: "opacity 100ms ease-out", pointerEvents: "none", zIndex: 0 }}
                            />
                            <div
                              className="row-divider-bottom"
                              // zIndex 2 for the same reason as the header's
                              // own divider — this line can get borrowed by
                              // the NEXT row (to widen the seam above IT),
                              // and that next row's fill extends 1px
                              // upward into this same spot.
                              style={{ position: "absolute", bottom: -1, left: -9999, right: -9999, height: 1, background: "#212124", opacity: 0, transition: "opacity 100ms ease-out", pointerEvents: "none", zIndex: 2 }}
                            />
                            <button
                              type="button"
                              onClick={() => setSelectedTaskId(task.id)}
                              className="flex items-center gap-2 transition-colors"
                              style={{ position: "relative", zIndex: 1, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                            >
                              <span
                                aria-hidden
                                style={{ width: 6, height: 6, borderRadius: "50%", background: meta.color, flexShrink: 0 }}
                              />
                              <span
                                className="text-[13px]"
                                style={{ color: "#E4E4E7" }}
                              >
                                {task.title}
                              </span>
                            </button>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                setPriorityAnchor(e.currentTarget);
                                setOpenPriorityTaskId((prev) => (prev === task.id ? null : task.id));
                              }}
                              className="flex items-center gap-1.5 transition-colors"
                              style={{
                                position: "relative",
                                zIndex: 1,
                                background: "transparent",
                                border: `1px solid ${openPriorityTaskId === task.id ? "#E4E4E7" : "transparent"}`,
                                borderRadius: 6,
                                padding: "4px 6px",
                                margin: "-4px -6px",
                                cursor: "pointer",
                              }}
                            >
                              <Flag
                                size={12}
                                color={task.priority ? PRIORITY_META[task.priority].color : "#3A3A3E"}
                                fill={task.priority ? PRIORITY_META[task.priority].color : "none"}
                              />
                              <span className="text-[13px]" style={{ color: task.priority ? "#E4E4E7" : "#3A3A3E" }}>
                                {task.priority ? PRIORITY_META[task.priority].label : "—"}
                              </span>
                            </button>
                            {openPriorityTaskId === task.id && (
                              <PriorityPopover
                                anchor={priorityAnchor}
                                value={task.priority}
                                onSelect={(priority) => updatePriority(task.id, priority)}
                                onClose={() => setOpenPriorityTaskId(null)}
                              />
                            )}
                          </td>
                          <td style={{ padding: "8px" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                setStatusAnchor(e.currentTarget);
                                setOpenStatusTaskId((prev) => (prev === task.id ? null : task.id));
                              }}
                              className="flex items-center gap-1.5 transition-colors"
                              style={{
                                position: "relative",
                                zIndex: 1,
                                background: "transparent",
                                border: `1px solid ${openStatusTaskId === task.id ? "#E4E4E7" : "transparent"}`,
                                borderRadius: 6,
                                padding: "4px 6px",
                                margin: "-4px -6px",
                                cursor: "pointer",
                              }}
                            >
                              <span
                                aria-hidden
                                style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_META[task.status].color, flexShrink: 0 }}
                              />
                              <span className="text-[13px]" style={{ color: "#E4E4E7" }}>
                                {STATUS_META[task.status].label}
                              </span>
                            </button>
                            {openStatusTaskId === task.id && (
                              <StatusPopover
                                anchor={statusAnchor}
                                value={task.done ? "complete" : task.status}
                                onSelect={(selection) => updateStatus(task.id, selection)}
                                onClose={() => setOpenStatusTaskId(null)}
                              />
                            )}
                          </td>
                          <td style={{ padding: "8px" }}>
                            <div className="flex items-center gap-1.5" style={{ position: "relative", zIndex: 1 }}>
                              <span style={{ fontSize: 13 }}>{task.pipeline.emoji}</span>
                              <span className="text-[13px] truncate" style={{ color: "#979393" }}>
                                {task.pipeline.name}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: "8px" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                setAssigneesAnchor(e.currentTarget);
                                setOpenAssigneesTaskId((prev) => (prev === task.id ? null : task.id));
                              }}
                              className="flex items-center transition-colors"
                              style={{
                                position: "relative",
                                zIndex: 1,
                                background: "transparent",
                                border: `1px solid ${openAssigneesTaskId === task.id ? "#E4E4E7" : "transparent"}`,
                                borderRadius: 6,
                                padding: "2px 4px",
                                margin: "-2px -4px -2px 4px",
                                cursor: "pointer",
                              }}
                            >
                              {task.assignees.length === 0 ? (
                                <span className="text-[13px]" style={{ color: "#3A3A3E" }}>—</span>
                              ) : (
                                sortAssigneesForViewer(task.assignees, currentUserId).map((a, i) => {
                                  const { text, bg } = getAvatarColorFromUserId(a.id);
                                  return (
                                    // Outer disc is a SOLID backing matching
                                    // the page background (#101010), not
                                    // just a border — see the same fix in
                                    // GlobalTaskDetailPanel.tsx for why a
                                    // plain border on overlapping avatars
                                    // lets translucent palette colors (see
                                    // AVATAR_PALETTE) bleed through.
                                    <div
                                      key={a.id}
                                      title={a.displayName ?? undefined}
                                      className="flex items-center justify-center rounded-full"
                                      style={{
                                        width: 28,
                                        height: 28,
                                        marginLeft: i === 0 ? 0 : -8,
                                        background: "#101010",
                                        flexShrink: 0,
                                      }}
                                    >
                                    {a.avatarUrl ? (
                                      <Image
                                        src={a.avatarUrl}
                                        alt=""
                                        width={22}
                                        height={22}
                                        unoptimized
                                        style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", display: "block" }}
                                      />
                                    ) : (
                                      <div
                                        className="flex items-center justify-center rounded-full text-[11px] font-medium"
                                        style={{
                                          width: 22,
                                          height: 22,
                                          background: bg,
                                          color: text,
                                        }}
                                      >
                                        {resolveInitial({ display_name: a.displayName })}
                                      </div>
                                    )}
                                    </div>
                                  );
                                })
                              )}
                            </button>
                            {openAssigneesTaskId === task.id && (
                              <AssigneesPopover
                                anchor={assigneesAnchor}
                                pipelineId={task.pipeline.id}
                                taskId={task.id}
                                currentAssignees={task.assignees}
                                onChange={(next) => updateAssignees(task.id, next)}
                                onClose={() => setOpenAssigneesTaskId(null)}
                              />
                            )}
                          </td>
                          <td style={{ padding: "8px" }}>
                            <button
                              type="button"
                              onClick={(e) => {
                                setDateAnchor(e.currentTarget);
                                setOpenDatePickerTaskId((prev) => (prev === task.id ? null : task.id));
                              }}
                              className="text-[13px] transition-colors"
                              style={{
                                position: "relative",
                                zIndex: 1,
                                background: "transparent",
                                border: "none",
                                padding: 0,
                                cursor: "pointer",
                                color: dueLabel ? (isOverdue ? "#F43F5E" : "#979393") : "#3A3A3E",
                              }}
                            >
                              {dueLabel || "Add date"}
                            </button>
                            {openDatePickerTaskId === task.id && (
                              <DueDatePopover
                                anchor={dateAnchor}
                                value={task.deadline}
                                onSelect={(deadline) => updateDeadline(task.id, deadline)}
                                onClose={() => setOpenDatePickerTaskId(null)}
                              />
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

      {selectedTask && (
        <GlobalTaskDetailPanel
          task={selectedTask}
          currentUserId={currentUserId}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={applyTaskPatch}
        />
      )}
    </div>
  );
}
