"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X, User, Calendar, Flag, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ProjectPickerIcon } from "@/components/icons/ProjectPickerIcon";
import { TaskTabIcon } from "@/components/icons/TaskTabIcon";
import { StatusPopover, type StatusSelection } from "@/components/tasks/StatusPopover";
import { DueDatePopover } from "@/components/tasks/DueDatePopover";
import { PriorityPopover } from "@/components/tasks/PriorityPopover";
import { AssigneesPopover } from "@/components/tasks/AssigneesPopover";
import { ProjectPicker, type ProjectPickerPipeline } from "@/components/tasks/ProjectPicker";
import { PRIORITY_META, STATUS_META } from "@/components/tasks/TaskListView";
import type { TaskAssignee, TaskRow } from "@/components/tasks/types";

/**
 * "+ Task" creation modal for the global Task tab (Figma V2). Matches the
 * reference screenshot: header, Select Project + Status row, Task Name,
 * description, an Assignee/Due date/Priority pill row, and a Create Task
 * footer button.
 *
 * Task Name is the only real requirement — per Jordan, everything else
 * (project included) is optional to click. But every `tasks` row still
 * requires a `stage_id` (not nullable) regardless of what the UI asks for,
 * so:
 *   - Project picked → target stage is that pipeline's `current_stage_id`
 *     (falling back to its earliest stage by position — see the
 *     defaultStageId computed in page.tsx). A project with literally no
 *     stages yet still blocks submit, since there's nowhere for that
 *     specific choice to go.
 *   - No project picked → get_or_create_unassigned_pipeline resolves (or
 *     lazily creates) a hidden, per-workspace "Unassigned" pipeline + one
 *     stage (20260910120000_unassigned_pipeline_for_tasks.sql) and targets
 *     that instead. TaskRow.pipeline.isSystem marks it so every display
 *     surface (this modal isn't one — it only shows real projects in the
 *     picker) hides the project badge for it, while functional consumers
 *     (attachments, RLS) still use its real pipeline_id.
 *
 * Assignee/Due date/Priority reuse the exact popovers built for the task
 * table/detail panel (controlled value + onSelect, no internal writes) —
 * only AssigneesPopover needed two small changes: an optional `taskId`
 * (it otherwise writes straight to task_assignees, which doesn't exist yet
 * for a task that hasn't been created) and a nullable `pipelineId` with a
 * `workspaceId` fallback (the hidden pipeline has no real memberships, so
 * assignable people there are the whole workspace team instead). Assignee
 * rows are inserted here, after the task itself is created via the
 * create_task RPC (the same RPC the pipeline canvas uses), then
 * priority/status/description are applied with plain updates — mirroring
 * how the rest of the Task tab already writes those columns.
 */

// Two-tone colors for the Status pill (label segment / chevron segment /
// dot), distinct from STATUS_META's plain text-label color used elsewhere
// in the Task tab — this button is a solid colored pill once a status is
// picked (Figma V2), not a neutral row with a colored dot.
const STATUS_BUTTON_META: Record<
  StatusSelection,
  { bg: string; chevronBg: string; dot: string }
> = {
  not_started: { bg: "#36363A", chevronBg: "#212123", dot: "#8E8A86" },
  in_progress: { bg: "#1176E2", chevronBg: "#105DB0", dot: "#8CC6FF" },
  complete: { bg: "#13B980", chevronBg: "#0E9164", dot: "#28F7B0" },
};

type Props = {
  pipelines: ProjectPickerPipeline[];
  workspaceId: string;
  onClose: () => void;
  onCreated: (task: TaskRow) => void;
};

export function CreateTaskModal({ pipelines, workspaceId, onClose, onCreated }: Props) {
  // Always starts unselected — even with exactly one project, Jordan wants
  // the picker to require an explicit choice rather than defaulting.
  const [projectId, setProjectId] = useState<string | null>(null);
  // Popover anchors are stored as state (set from the button's own
  // onClick via e.currentTarget), not read from a ref during render — the
  // established pattern in this codebase (see TaskListView's
  // assigneesAnchor/dateAnchor/priorityAnchor/statusAnchor) that avoids
  // the "don't access ref.current during render" rule.
  const [projectAnchor, setProjectAnchor] = useState<HTMLButtonElement | null>(null);

  const [status, setStatus] = useState<StatusSelection>("not_started");
  const [statusAnchor, setStatusAnchor] = useState<HTMLButtonElement | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [assigneeAnchor, setAssigneeAnchor] = useState<HTMLButtonElement | null>(null);

  const [deadline, setDeadline] = useState<string | null>(null);
  const [dateAnchor, setDateAnchor] = useState<HTMLButtonElement | null>(null);

  const [priority, setPriority] = useState<TaskRow["priority"]>(null);
  const [priorityAnchor, setPriorityAnchor] = useState<HTMLButtonElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only one popover open at a time — opening any of them closes the rest,
  // matching how a single Select/dropdown group normally behaves.
  const closeAllPopovers = () => {
    setProjectAnchor(null);
    setStatusAnchor(null);
    setAssigneeAnchor(null);
    setDateAnchor(null);
    setPriorityAnchor(null);
  };

  const selectedProject = pipelines.find((p) => p.id === projectId) ?? null;
  // Task Name is the only real requirement — project is optional (a task
  // created without one lands on the hidden per-workspace "Unassigned"
  // pipeline, resolved lazily below, and never shows a project badge).
  // A project that HAS been picked but genuinely has no stages yet still
  // blocks submit, since there's nowhere for that specific choice to go.
  const canSubmit =
    (!selectedProject || !!selectedProject.defaultStageId) &&
    title.trim().length > 0 &&
    !submitting;

  const handleSubmit = async () => {
    if (selectedProject && !selectedProject.defaultStageId) return;
    const cleanedTitle = title.trim();
    if (!cleanedTitle) return;

    setSubmitting(true);
    setError(null);

    let stageId = selectedProject?.defaultStageId ?? null;
    let unassignedPipelineId: string | null = null;
    if (!stageId) {
      const { data: unassignedRows, error: unassignedError } = await supabase.rpc(
        "get_or_create_unassigned_pipeline",
        { p_workspace_id: workspaceId },
      );
      const row = (Array.isArray(unassignedRows) ? unassignedRows[0] : unassignedRows) as
        | { pipeline_id: string; stage_id: string }
        | undefined;
      if (unassignedError || !row) {
        console.error(
          "[create-task] get_or_create_unassigned_pipeline failed:",
          unassignedError?.message,
        );
        setError(unassignedError?.message ?? "Couldn't create the task.");
        setSubmitting(false);
        return;
      }
      stageId = row.stage_id;
      unassignedPipelineId = row.pipeline_id;
    }

    const { data, error: createError } = await supabase.rpc("create_task", {
      stage_id: stageId,
      title: cleanedTitle,
      deadline,
    });

    if (createError || !data) {
      console.error("[create-task] create_task RPC failed:", createError?.message);
      setError(createError?.message ?? "Couldn't create the task.");
      setSubmitting(false);
      return;
    }

    type CreateResult = { id: string; created_at: string };
    const result = data as CreateResult;
    const taskId = result.id;

    const patch: Record<string, unknown> = {};
    if (description.trim()) patch.description = description.trim();
    if (priority) patch.priority = priority;
    if (status !== "not_started") patch.status = status === "complete" ? "not_started" : status;
    if (status === "complete") patch.done = true;

    if (Object.keys(patch).length > 0) {
      const { error: patchError } = await supabase.from("tasks").update(patch).eq("id", taskId);
      if (patchError) {
        console.error("[create-task] follow-up update failed:", patchError.message);
      }
    }

    if (assignees.length > 0) {
      const { error: assigneeError } = await supabase
        .from("task_assignees")
        .insert(assignees.map((a) => ({ task_id: taskId, user_id: a.id })));
      if (assigneeError) {
        console.error("[create-task] assignee insert failed:", assigneeError.message);
      }
    }

    setSubmitting(false);
    onCreated({
      id: taskId,
      title: cleanedTitle,
      description: description.trim() || null,
      deadline,
      priority,
      status: status === "complete" ? "not_started" : status,
      done: status === "complete",
      createdAt: result.created_at,
      pipeline: selectedProject
        ? {
            id: selectedProject.id,
            name: selectedProject.name,
            emoji: selectedProject.emoji ?? "📋",
            isSystem: false,
          }
        : {
            id: unassignedPipelineId!,
            name: "Unassigned",
            emoji: "📋",
            isSystem: true,
          },
      assignees,
    });
  };

  const statusMeta =
    status === "complete"
      ? { label: "Complete", color: "#15B981" }
      : STATUS_META[status];
  const statusButtonMeta = STATUS_BUTTON_META[status];
  const priorityMeta = priority ? PRIORITY_META[priority] : null;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fade-in"
      style={{
        position: "fixed",
        inset: 0,
        // Below the shared task popovers (Assignee/Due date/Priority/
        // Status all use zIndex 60) so those still render on top of this
        // modal instead of underneath it — see ProjectPicker below for
        // the same reasoning applied to this modal's own project list.
        zIndex: 50,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label="Create task"
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 64px)",
          background: "#1A1A1A",
          border: "1px solid #36363A",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: "16px 20px", borderBottom: "1px solid #2D2E30" }}
        >
          <div className="flex items-center gap-2">
            <TaskTabIcon size={22} />
            <span className="text-[16px] font-semibold" style={{ color: "#E4E4E7" }}>
              Task
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center rounded-full transition-colors"
            style={{ width: 28, height: 28, background: "#2C2C2F", border: "none", color: "#979393", cursor: "pointer" }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: "16px 20px", overflowY: "auto" }}>
          {/* Select Project + Status */}
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={(e) => {
                const wasOpen = !!projectAnchor;
                closeAllPopovers();
                if (!wasOpen) setProjectAnchor(e.currentTarget);
              }}
              className="flex items-center gap-1.5 rounded-lg transition-colors"
              style={{ padding: "4px 8px", background: "#111111", border: "none", color: "#E4E4E7", cursor: "pointer" }}
            >
              {selectedProject?.emoji ? (
                <span style={{ fontSize: 13, lineHeight: 1 }}>{selectedProject.emoji}</span>
              ) : (
                <ProjectPickerIcon size={14} />
              )}
              <span className="text-[13px] font-medium">
                {selectedProject ? selectedProject.name : "Select Project"}
              </span>
              <ChevronDown size={13} style={{ color: "#E4E4E7" }} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                const wasOpen = !!statusAnchor;
                closeAllPopovers();
                if (!wasOpen) setStatusAnchor(e.currentTarget);
              }}
              className="flex items-stretch rounded-lg overflow-hidden transition-colors"
              style={{ border: "none", cursor: "pointer" }}
            >
              <span className="flex items-center gap-1.5" style={{ padding: "4px 8px", background: statusButtonMeta.bg }}>
                <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: statusButtonMeta.dot, flexShrink: 0 }} />
                <span className="text-[13px] font-medium" style={{ color: "white" }}>{statusMeta.label}</span>
              </span>
              <span className="flex items-center justify-center" style={{ padding: "4px 6px", background: statusButtonMeta.chevronBg }}>
                <ChevronRight size={12} style={{ color: "white" }} />
              </span>
            </button>
          </div>

          {projectAnchor && (
            <ProjectPicker
              anchor={projectAnchor}
              pipelines={pipelines}
              selectedId={projectId}
              onSelect={(id) => {
                // Assignees are scoped to the previously selected
                // pipeline's members — clear them on a project change so
                // a stale pick from a different pipeline can't linger.
                if (id !== projectId) setAssignees([]);
                setProjectId(id);
                setProjectAnchor(null);
              }}
              onClose={() => setProjectAnchor(null)}
            />
          )}
          {statusAnchor && (
            <StatusPopover
              anchor={statusAnchor}
              value={status}
              onSelect={(selection) => {
                setStatus(selection);
                setStatusAnchor(null);
              }}
              onClose={() => setStatusAnchor(null)}
            />
          )}

          {/* Task Name */}
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task Name"
            className="w-full outline-none mb-3"
            style={{ background: "transparent", border: "none", color: "#E4E4E7", fontSize: 22, fontWeight: 600 }}
          />

          {/* Description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description"
            rows={3}
            className="w-full outline-none resize-none mb-4"
            style={{ background: "transparent", border: "none", color: "#979393", fontSize: 14 }}
          />

          {/* Assignee / Due date / Priority */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={(e) => {
                const wasOpen = !!assigneeAnchor;
                closeAllPopovers();
                if (!wasOpen) setAssigneeAnchor(e.currentTarget);
              }}
              className="flex items-center gap-1.5 rounded-lg transition-colors"
              style={{
                padding: "4px 8px",
                background: "#111111",
                border: "none",
                color: assignees.length ? "#E4E4E7" : "#979393",
                cursor: "pointer",
              }}
            >
              <User size={13} />
              <span className="text-[13px]">
                {assignees.length === 0
                  ? "Assignee"
                  : assignees.length === 1
                    ? (assignees[0].displayName ?? "1 assignee")
                    : `${assignees.length} assignees`}
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                const wasOpen = !!dateAnchor;
                closeAllPopovers();
                if (!wasOpen) setDateAnchor(e.currentTarget);
              }}
              className="flex items-center gap-1.5 rounded-lg transition-colors"
              style={{ padding: "4px 8px", background: "#111111", border: "none", color: deadline ? "#E4E4E7" : "#979393", cursor: "pointer" }}
            >
              <Calendar size={13} />
              <span className="text-[13px]">
                {deadline
                  ? new Date(deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                  : "Due date"}
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                const wasOpen = !!priorityAnchor;
                closeAllPopovers();
                if (!wasOpen) setPriorityAnchor(e.currentTarget);
              }}
              className="flex items-center gap-1.5 rounded-lg transition-colors"
              style={{ padding: "4px 8px", background: "#111111", border: "none", color: priorityMeta ? priorityMeta.color : "#979393", cursor: "pointer" }}
            >
              <Flag size={13} />
              <span className="text-[13px]">{priorityMeta ? priorityMeta.label : "Priority"}</span>
            </button>
          </div>

          {selectedProject && !selectedProject.defaultStageId && (
            <div className="text-[12px] mt-3" style={{ color: "#F43F5E" }}>
              This project has no stages yet — add one before creating a task here.
            </div>
          )}
          {error && (
            <div className="text-[12px] mt-3" style={{ color: "#F43F5E" }}>
              {error}
            </div>
          )}

          {assigneeAnchor && (
            <AssigneesPopover
              anchor={assigneeAnchor}
              pipelineId={selectedProject?.id ?? null}
              workspaceId={workspaceId}
              currentAssignees={assignees}
              onChange={setAssignees}
              onClose={() => setAssigneeAnchor(null)}
            />
          )}
          {dateAnchor && (
            <DueDatePopover
              anchor={dateAnchor}
              value={deadline}
              onSelect={(next) => {
                setDeadline(next);
                setDateAnchor(null);
              }}
              onClose={() => setDateAnchor(null)}
            />
          )}
          {priorityAnchor && (
            <PriorityPopover
              anchor={priorityAnchor}
              value={priority}
              onSelect={(next) => {
                setPriority(next);
                setPriorityAnchor(null);
              }}
              onClose={() => setPriorityAnchor(null)}
            />
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end flex-shrink-0"
          style={{ padding: "14px 20px", borderTop: "1px solid #2D2E30" }}
        >
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="rounded-lg font-medium text-white transition-colors"
            style={{
              padding: "8px 18px",
              background: "#108CE9",
              border: "none",
              fontSize: 14,
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "Creating…" : "Create Task"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

