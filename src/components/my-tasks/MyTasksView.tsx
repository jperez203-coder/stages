"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  bucketForDeadline,
  bucketMatchesChip,
  type Bucket,
  type Chip,
} from "@/lib/task-buckets";
import type { TaskWithMeta, PipelineLite } from "./types";
import { TaskRow } from "./TaskRow";
import { QuickAddRow } from "./QuickAddRow";

/**
 * /w/[slug]/my-tasks view. Phase 4a step 4.
 *
 * Owns all task list state. Initial data comes from the server page;
 * mutations (toggle complete, change deadline, quick-add) update the
 * local list optimistically. Bucket + filter logic stays client-side
 * so chip / search / hide-completed don't refetch.
 *
 * Pill color treatment is BUCKET-colored here (urgency-first), in
 * contrast to the dashboard's PIPELINE-colored pills (context-first).
 * Surface-dependent treatment locked 2026-05-20 — pipeline identity is
 * already carried in this row's subtitle (emoji + name + stage), so
 * moving urgency onto the pill loses nothing and creates clean visual
 * rhythm with the bucket-section colors above each row.
 */

type Props = {
  workspaceSlug: string;
  tasks: TaskWithMeta[];
  pipelines: PipelineLite[];
  lastActivePipelineId: string | null;
  currentUserId: string;
  taskFetchError: string | null;
};

type SectionDef = {
  bucket: Bucket;
  label: string;
  dotColor: string;
  dateLabel?: string;
};

const DATE_FMT_FULL = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export function MyTasksView({
  workspaceSlug,
  tasks: initialTasks,
  pipelines,
  lastActivePipelineId,
  currentUserId,
  taskFetchError,
}: Props) {
  // ── State ───────────────────────────────────────────────────────────────
  const [tasks, setTasks] = useState<TaskWithMeta[]>(initialTasks);
  const [activeChip, setActiveChip] = useState<Chip>("all");
  const [search, setSearch] = useState("");
  const [hideCompleted, setHideCompleted] = useState(false);
  const quickAddInputRef = useRef<HTMLInputElement | null>(null);

  // ⌘N (or Ctrl+N on non-Mac) focuses the quick-add input from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        quickAddInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Section definitions ────────────────────────────────────────────────
  const now = useMemo(() => new Date(), []);
  const sections = useMemo<SectionDef[]>(() => {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return [
      // Overdue rendered only when there's at least one overdue task — see
      // the render branch below.
      { bucket: "overdue", label: "Overdue", dotColor: "#DF1E5A" },
      {
        bucket: "today",
        label: "Today",
        dotColor: "#DF1E5A",
        dateLabel: DATE_FMT_FULL.format(now),
      },
      {
        bucket: "tomorrow",
        label: "Tomorrow",
        dotColor: "#E273C1",
        dateLabel: DATE_FMT_FULL.format(tomorrow),
      },
      { bucket: "thisWeek", label: "This week", dotColor: "#21B159" },
      { bucket: "later", label: "Later", dotColor: "#6B6B6B" },
      { bucket: "noDate", label: "No date", dotColor: "#6B6B6B" },
    ];
  }, [now]);

  // ── Derived: per-task bucket + filtered view ──────────────────────────
  const taskBuckets = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const t of tasks) {
      const deadlineMs = t.deadline ? new Date(t.deadline).getTime() : null;
      map.set(t.id, bucketForDeadline(deadlineMs, now));
    }
    return map;
  }, [tasks, now]);

  // Search + hide-completed applied first, then chip filter on top.
  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (hideCompleted && t.done) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      const bucket = taskBuckets.get(t.id) ?? "noDate";
      return bucketMatchesChip(bucket, activeChip);
    });
  }, [tasks, search, hideCompleted, activeChip, taskBuckets]);

  // Group filtered tasks by bucket. Within each bucket, incomplete first
  // (sorted by deadline asc / no-date by createdAt desc), completed last.
  const tasksByBucket = useMemo(() => {
    const groups = new Map<Bucket, TaskWithMeta[]>();
    for (const t of visibleTasks) {
      const bucket = taskBuckets.get(t.id) ?? "noDate";
      const list = groups.get(bucket) ?? [];
      list.push(t);
      groups.set(bucket, list);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => {
        // Completed sink to the bottom of the same bucket
        if (a.done !== b.done) return a.done ? 1 : -1;
        // Both incomplete: deadline asc (nulls last), then createdAt desc
        if (a.deadline && b.deadline) {
          return (
            new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
          );
        }
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
    }
    return groups;
  }, [visibleTasks, taskBuckets]);

  // ── Counts (used by header + chip labels) ─────────────────────────────
  // The header count pill uses ALL tasks (including completed) per spec.
  // The chip counts respect hideCompleted + search but NOT the active
  // chip itself (so chips don't dim themselves to zero when clicked).
  const totalCount = tasks.length;

  const chipCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const counts: Record<Chip, number> = {
      all: 0,
      today: 0,
      thisWeek: 0,
      later: 0,
      noDate: 0,
    };
    for (const t of tasks) {
      if (hideCompleted && t.done) continue;
      if (q && !t.title.toLowerCase().includes(q)) continue;
      const bucket = taskBuckets.get(t.id) ?? "noDate";
      counts.all += 1;
      if (bucketMatchesChip(bucket, "today")) counts.today += 1;
      if (bucketMatchesChip(bucket, "thisWeek")) counts.thisWeek += 1;
      if (bucketMatchesChip(bucket, "later")) counts.later += 1;
      if (bucketMatchesChip(bucket, "noDate")) counts.noDate += 1;
    }
    return counts;
  }, [tasks, taskBuckets, hideCompleted, search]);

  // ── Mutations ──────────────────────────────────────────────────────────
  // Optimistic updates: mutate local state immediately, then UPDATE the
  // DB. Reverting on error is a Phase 4b polish — for now, if the DB
  // write fails, console.error + leave the UI in its optimistic state
  // (next page load will resync).

  const toggleComplete = useCallback(
    async (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const nextDone = !task.done;
      const nextCompletedAt = nextDone ? new Date().toISOString() : null;

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, done: nextDone, completedAt: nextCompletedAt }
            : t,
        ),
      );

      const { error } = await supabase
        .from("tasks")
        .update({ done: nextDone })
        .eq("id", taskId);

      // The set_task_completion_metadata trigger writes completed_at/by
      // server-side when `done` flips; we set completedAt locally too so
      // the UI doesn't wait for a refetch.
      if (error) {
        console.error(
          "[my-tasks] toggleComplete failed; UI is now optimistically ahead of DB:",
          error.message,
        );
      }
    },
    [tasks],
  );

  const updateDeadline = useCallback(
    async (taskId: string, deadline: string | null) => {
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, deadline } : t)),
      );

      const { error } = await supabase
        .from("tasks")
        .update({ deadline })
        .eq("id", taskId);

      if (error) {
        console.error(
          "[my-tasks] updateDeadline failed; UI is optimistically ahead of DB:",
          error.message,
        );
      }
    },
    [],
  );

  const addTask = useCallback(
    async (stageId: string, title: string) => {
      const { data, error } = await supabase.rpc("create_task", {
        stage_id: stageId,
        title,
      });
      if (error || !data) {
        console.error("[my-tasks] create_task failed:", error?.message);
        return;
      }
      // RPC returns the new task. Reconstruct the TaskWithMeta with
      // stage + pipeline info pulled from the pipelines/stages we
      // already have (so we don't need an extra fetch). The new task
      // is unassigned-deadline → lands in the No date bucket.
      type CreateResult = {
        id: string;
        stage_id: string;
        title: string;
        position: number;
        assignee_id: string;
        deadline: string | null;
        created_at: string;
      };
      const result = data as CreateResult;

      // We need stage + pipeline metadata for the local row render. The
      // server page passed us `pipelines` (with currentStageId) but not
      // the full stage list with names/colors. Quick path: fetch the
      // stage row we just used. One-row read; not a waterfall since it
      // only fires once on quick-add commit.
      const { data: stageRow } = await supabase
        .from("stages")
        .select(
          `id, name, color, position, pipeline_id,
           pipeline:pipelines!stages_pipeline_id_fkey!inner(id, name, emoji)`,
        )
        .eq("id", result.stage_id)
        .single();

      if (!stageRow) {
        console.warn(
          "[my-tasks] couldn't hydrate new task — refresh to see it",
        );
        return;
      }
      const pipelineJoin = Array.isArray(stageRow.pipeline)
        ? stageRow.pipeline[0]
        : stageRow.pipeline;

      const newTask: TaskWithMeta = {
        id: result.id,
        title: result.title,
        deadline: result.deadline,
        completedAt: null,
        done: false,
        createdAt: result.created_at,
        stage: {
          id: stageRow.id,
          name: stageRow.name,
          color: stageRow.color,
          position: stageRow.position,
          pipelineId: stageRow.pipeline_id,
          pipelineName: pipelineJoin?.name ?? "",
          pipelineEmoji: pipelineJoin?.emoji ?? null,
        },
      };

      setTasks((prev) => [newTask, ...prev]);
    },
    [],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  const hasAnyTasks = tasks.length > 0;

  return (
    <div className="dotted-grid min-h-full px-6 sm:px-12 py-6">
      <div className="max-w-[1600px] mx-auto">
        {/* Header row */}
        <header className="flex items-center gap-3 mb-6">
          <Link
            href={`/w/${workspaceSlug}`}
            className="flex items-center justify-center flex-shrink-0 transition-colors"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: "#212124",
              border: "1px solid #36363A",
              color: "rgba(255,255,255,0.7)",
            }}
            aria-label="Back to workspace"
          >
            <ArrowLeft size={16} />
          </Link>
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
              <h1 className="text-[24px] font-semibold text-white">
                My tasks
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
                {totalCount} total
              </span>
            </div>
            <p
              className="text-[13px] mt-0.5"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              Everything assigned to you across pipelines.
            </p>
          </div>

          {/* Right side: search + hide-completed toggle */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div
              className="flex items-center gap-2"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                padding: "8px 12px",
                width: 240,
              }}
            >
              <Search
                size={14}
                style={{ color: "rgba(255,255,255,0.5)" }}
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks"
                className="flex-1 bg-transparent border-none outline-none text-[13px] text-white placeholder-zinc-500"
                aria-label="Search tasks"
              />
            </div>
            <label
              className="flex items-center gap-2 text-[13px] cursor-pointer select-none"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              <input
                type="checkbox"
                checked={hideCompleted}
                onChange={(e) => setHideCompleted(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              Hide completed
            </label>
          </div>
        </header>

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <FilterChip
            label="All"
            count={chipCounts.all}
            active={activeChip === "all"}
            onClick={() => setActiveChip("all")}
          />
          <FilterChip
            label="Today"
            count={chipCounts.today}
            active={activeChip === "today"}
            onClick={() => setActiveChip("today")}
          />
          <FilterChip
            label="This week"
            count={chipCounts.thisWeek}
            active={activeChip === "thisWeek"}
            onClick={() => setActiveChip("thisWeek")}
          />
          <FilterChip
            label="Later"
            count={chipCounts.later}
            active={activeChip === "later"}
            onClick={() => setActiveChip("later")}
          />
          <FilterChip
            label="No date"
            count={chipCounts.noDate}
            active={activeChip === "noDate"}
            onClick={() => setActiveChip("noDate")}
          />
        </div>

        {/* Error banner — surfaced if the task fetch failed at SSR. */}
        {taskFetchError && (
          <div
            className="mb-4 p-3 rounded-lg flex items-start gap-2 text-[13px]"
            style={{
              background: "rgba(223,30,90,0.08)",
              border: "1px solid rgba(223,30,90,0.35)",
              color: "#DF1E5A",
            }}
          >
            Couldn&apos;t load tasks — refresh to try again. ({taskFetchError})
          </div>
        )}

        {/* Empty state: zero tasks at all (no filter applied) */}
        {!hasAnyTasks && !taskFetchError && (
          <div
            className="rounded-2xl flex flex-col items-center text-center mb-6"
            style={{
              background: "#2C2C2F",
              border: "1px solid #36363A",
              padding: "48px 24px",
            }}
          >
            <span
              aria-hidden
              style={{ fontSize: 40, lineHeight: 1, marginBottom: 12 }}
            >
              👍
            </span>
            <p
              className="text-[13px] max-w-[420px]"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              no tasks assigned to you yet. ask a teammate to assign you
              something, or add one yourself.
            </p>
          </div>
        )}

        {/* Sections — Overdue only renders when it has tasks */}
        {hasAnyTasks && (
          <div className="space-y-8">
            {sections.map((sec) => {
              const list = tasksByBucket.get(sec.bucket) ?? [];
              if (list.length === 0) return null;
              if (sec.bucket === "overdue" && list.length === 0) return null;
              return (
                <section key={sec.bucket}>
                  <header
                    className="flex items-baseline gap-2 mb-3"
                    style={{ paddingLeft: 4 }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: sec.dotColor,
                        flexShrink: 0,
                        alignSelf: "center",
                      }}
                    />
                    <h2 className="text-[15px] font-medium text-white">
                      {sec.label}
                    </h2>
                    {sec.dateLabel && (
                      <span
                        className="text-[13px]"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                      >
                        {sec.dateLabel}
                      </span>
                    )}
                    <span className="flex-1" />
                    <span
                      className="text-[13px]"
                      style={{ color: "rgba(255,255,255,0.5)" }}
                    >
                      {list.length}
                    </span>
                  </header>
                  <div
                    className="rounded-xl overflow-hidden"
                    style={{
                      background: "#2C2C2F",
                      border: "1px solid #36363A",
                    }}
                  >
                    {list.map((task, idx) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        bucket={taskBuckets.get(task.id) ?? "noDate"}
                        isLast={idx === list.length - 1}
                        onToggleComplete={toggleComplete}
                        onDeadlineChange={updateDeadline}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {/* Quick add row */}
        <div className="mt-8">
          <QuickAddRow
            pipelines={pipelines}
            lastActivePipelineId={lastActivePipelineId}
            inputRef={quickAddInputRef}
            onCreate={addTask}
          />
        </div>

        {/* currentUserId kept in scope for future per-row author checks
            (e.g., showing "you" in subtitle for tasks created by self). */}
        <span className="sr-only">{currentUserId}</span>
      </div>
    </div>
  );
}

// ─── Filter chip ─────────────────────────────────────────────────────────

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] font-medium transition-colors"
      style={{
        background: active ? "#108CE9" : "rgba(255,255,255,0.04)",
        color: active ? "white" : "rgba(255,255,255,0.7)",
        border: active ? "1px solid #108CE9" : "1px solid rgba(255,255,255,0.08)",
        padding: "6px 14px",
        borderRadius: 999,
        cursor: "pointer",
      }}
    >
      {label}{" "}
      <span
        style={{
          opacity: 0.85,
          marginLeft: 4,
        }}
      >
        {count}
      </span>
    </button>
  );
}
