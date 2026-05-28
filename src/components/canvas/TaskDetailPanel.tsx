"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Link as LinkIcon,
  Loader2,
  Maximize2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { DatePickerPopover } from "@/components/my-tasks/DatePickerPopover";
import { AddLinkModal } from "@/components/files/AddLinkModal";
import { FilePreview } from "@/components/files/FilePreview";
import { buildStoragePath } from "@/lib/build-storage-path";
import { resolveDisplayName } from "@/lib/display-name";
import { triggerFileDownload } from "@/lib/file-signed-url";
import { normalizeUrl } from "@/lib/normalize-url";
import { supabase } from "@/lib/supabase";
import type { ChromeMember } from "@/lib/canvas-chrome-data";
import type {
  FileItem,
  UploaderProfile,
} from "@/lib/pipeline-files-data";
import type {
  StageRaw,
  TaskRaw,
} from "@/app/w/(canvas)/[slug]/p/[pipeline-id]/page";

/**
 * Task detail side panel — Phase 4a step 6.
 *
 * Slide-in from the right (Notion-style). Opens when a task title is
 * clicked in NORMAL mode (edit-mode click stays as inline rename, per
 * the 5e behavior). Reads task + stage from the canvas's already-loaded
 * `tasksState` / `stagesState` — no round-trip on open. All field edits
 * are optimistic-with-revert via callbacks from `PipelineCanvas`, which
 * owns the canonical state. Closing the panel reveals a canvas already
 * reflecting the edits (no flash).
 *
 * Permission model (UI gates mirror RLS — see migrations
 * 20260521120000_tighten_member_task_update_to_assignee.sql +
 * 20260523120000_enforce_member_task_update_scope.sql):
 *
 *   * Title         — canEditPipeline || assignee === userId
 *   * Description   — canEditPipeline || assignee === userId
 *   * Deadline      — canEditPipeline || assignee === userId
 *   * Done checkbox — canEditPipeline || assignee === userId
 *   * Assignee      — canEditPipeline only
 *   * client_visible — canEditPipeline only
 *   * Delete task   — canEditPipeline only
 *   * +Add sibling  — canEditPipeline only
 *   * Checklist add/toggle/delete — canEditPipeline only (matches the
 *     checklist_items RLS — members aren't covered by the policy)
 *
 * What's STUBBED (not built in step 6):
 *   * Attachments section — layout reserved with a placeholder; files
 *     step ships the actual upload UX.
 *   * Activity feed — deferred (no schema yet for task-level activity).
 */

// Slightly wider than Notion's default to give the title + inline
// description more breathing room (Jordan's polish, 2026-05-22).
const PANEL_WIDTH = 500;

type Props = {
  task: TaskRaw;
  stage: StageRaw;
  pipelineId: string;
  pipelineName: string;
  members: ChromeMember[];
  canEditPipeline: boolean;
  currentUserId: string;
  onClose: () => void;
  onToggleDone: (taskId: string, nextDone: boolean) => void;
  onRenameTitle: (taskId: string, nextTitle: string) => void;
  onChangeDescription: (taskId: string, next: string | null) => void;
  onChangeAssignee: (taskId: string, nextAssigneeId: string | null) => void;
  onChangeDeadline: (taskId: string, nextDeadline: string | null) => void;
  onChangeClientVisible: (taskId: string, next: boolean) => void;
  onDeleteTask: (taskId: string) => void;
  /** Add a sibling task to the SAME stage. Reuses the existing canvas
   *  +Add task callback (which calls create_task RPC). */
  onAddSiblingTask: (stageId: string, title: string) => void;
};

export function TaskDetailPanel({
  task,
  stage,
  pipelineId,
  pipelineName,
  members,
  canEditPipeline,
  currentUserId,
  onClose,
  onToggleDone,
  onRenameTitle,
  onChangeDescription,
  onChangeAssignee,
  onChangeDeadline,
  onChangeClientVisible,
  onDeleteTask,
  onAddSiblingTask,
}: Props) {
  const isAssignee = task.assignee_id === currentUserId;
  const canEditFields = canEditPipeline || isAssignee; // title/desc/deadline/done
  const canToggleDone = canEditFields;

  // ── Close handlers (Esc + outside click) ───────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Wheel containment ─────────────────────────────────────────────────
  //
  // PipelineCanvas mounts a NATIVE non-passive wheel listener on its
  // wrapper element that calls e.preventDefault() unconditionally (for
  // canvas pan semantics — see canvas useEffect at PipelineCanvas.tsx
  // ~L335). The TaskDetailPanel is rendered as a DOM child of that
  // wrapper, so wheel events anywhere on the panel bubble up, hit the
  // wrapper's listener, and have their default action (scrolling the
  // panel's overflow-y:auto body) cancelled. The result is the bug:
  // wheeling over the panel pans the canvas instead of scrolling the
  // panel.
  //
  // Fix: stop propagation at the panel's outer <aside> via a native
  // bubble-phase wheel listener (NOT a React onWheel — React 19
  // delegates onWheel at the root, which fires AFTER the wrapper's
  // listener, too late to stop it). We do NOT call preventDefault here
  // — only stopPropagation — so the browser's default scroll on the
  // body's overflow-y:auto proceeds as usual. The wrapper's listener
  // simply never sees the event.
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const stop = (e: WheelEvent) => {
      e.stopPropagation();
    };
    aside.addEventListener("wheel", stop, { passive: true });
    return () => aside.removeEventListener("wheel", stop);
  }, []);

  // ── Inline title rename state ──────────────────────────────────────────
  const [isRenamingTitle, setIsRenamingTitle] = useState(false);
  const [pendingTitle, setPendingTitle] = useState(task.title);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    // Re-seed pending title when the underlying task title changes from
    // outside (e.g. canvas inline-rename in edit mode landed an edit
    // while the panel was open, or optimistic revert after server reject).
    setPendingTitle(task.title);
  }, [task.title]);

  const startTitleRename = useCallback(() => {
    if (!canEditFields) return;
    setIsRenamingTitle(true);
    setPendingTitle(task.title);
    setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
  }, [canEditFields, task.title]);

  const submitTitleRename = useCallback(() => {
    const cleaned = pendingTitle.trim();
    if (!cleaned || cleaned === task.title) {
      setIsRenamingTitle(false);
      setPendingTitle(task.title);
      return;
    }
    onRenameTitle(task.id, cleaned);
    setIsRenamingTitle(false);
  }, [pendingTitle, task.title, task.id, onRenameTitle]);

  const cancelTitleRename = useCallback(() => {
    setIsRenamingTitle(false);
    setPendingTitle(task.title);
  }, [task.title]);

  // ── Description: inline-edit state (mirrors the title pattern) ─────────
  // Display mode: muted body text under the title (or "Add description…"
  // placeholder when empty + editable). Click flips to a textarea.
  // Enter commits; Shift+Enter inserts a newline (so multi-line is still
  // possible per the original spec). Esc cancels. Blur commits.
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [pendingDescription, setPendingDescription] = useState(
    task.description ?? "",
  );
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    setPendingDescription(task.description ?? "");
  }, [task.description]);

  const startDescriptionEdit = useCallback(() => {
    if (!canEditFields) return;
    setIsEditingDescription(true);
    setPendingDescription(task.description ?? "");
    setTimeout(() => {
      const el = descriptionTextareaRef.current;
      if (el) {
        el.focus();
        // Place cursor at end for natural "continue typing" flow.
        const end = el.value.length;
        el.setSelectionRange(end, end);
      }
    }, 0);
  }, [canEditFields, task.description]);

  const submitDescription = useCallback(() => {
    const current = task.description ?? "";
    // Don't trim — preserve whitespace inside; only normalize "empty after
    // trim → null" so an empty description doesn't leave a blank string in
    // the DB. Newlines within the text stay as the user entered them.
    const next = pendingDescription;
    const trimmed = next.trim();
    if ((trimmed || null) === (current.trim() || null)) {
      setIsEditingDescription(false);
      return;
    }
    onChangeDescription(task.id, trimmed ? next : null);
    setIsEditingDescription(false);
  }, [pendingDescription, task.description, task.id, onChangeDescription]);

  const cancelDescriptionEdit = useCallback(() => {
    setIsEditingDescription(false);
    setPendingDescription(task.description ?? "");
  }, [task.description]);

  // ── Assignee picker open state ─────────────────────────────────────────
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);

  // ── Deadline picker open state ─────────────────────────────────────────
  const [deadlinePickerOpen, setDeadlinePickerOpen] = useState(false);

  // ── +Add sibling task ──────────────────────────────────────────────────
  const [isAddingSibling, setIsAddingSibling] = useState(false);
  const [siblingTitle, setSiblingTitle] = useState("");
  const siblingInputRef = useRef<HTMLInputElement | null>(null);

  const startAddSibling = useCallback(() => {
    setIsAddingSibling(true);
    setSiblingTitle("");
    setTimeout(() => siblingInputRef.current?.focus(), 0);
  }, []);
  const submitAddSibling = useCallback(() => {
    const cleaned = siblingTitle.trim();
    if (!cleaned) {
      setIsAddingSibling(false);
      setSiblingTitle("");
      return;
    }
    onAddSiblingTask(stage.id, cleaned);
    setSiblingTitle("");
    siblingInputRef.current?.focus();
  }, [siblingTitle, stage.id, onAddSiblingTask]);
  const cancelAddSibling = useCallback(() => {
    setIsAddingSibling(false);
    setSiblingTitle("");
  }, []);

  // ── Delete confirm dialog ──────────────────────────────────────────────
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Resolve assignee for display ───────────────────────────────────────
  const assigneeMember = useMemo(
    () =>
      task.assignee_id
        ? members.find((m) => m.user.id === task.assignee_id) ?? null
        : null,
    [members, task.assignee_id],
  );

  return (
    <>
      {/* Dimming overlay — clicking it closes the panel. Stops short of
          the panel's left edge so the panel itself isn't dimmed. */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          right: PANEL_WIDTH,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(2px)",
          zIndex: 50,
          animation: "fadeIn 160ms ease-out",
        }}
      />

      {/* Panel */}
      <aside
        ref={asideRef}
        role="dialog"
        aria-label={`Task details: ${task.title}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: PANEL_WIDTH,
          background: "#1A1A1C",
          borderLeft: "1px solid #36363A",
          color: "#E4E4E7",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 220ms cubic-bezier(0.2, 0, 0, 1)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        {/* Inline keyframes — small enough to colocate; avoids a global
            stylesheet edit for one panel. */}
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
          @keyframes fadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        `}</style>

        {/* ── Header: breadcrumb + close ─────────────────────────────── */}
        <div
          style={{
            padding: "14px 16px 12px",
            borderBottom: "1px solid #2A2A2D",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Breadcrumb pipelineName={pipelineName} stageName={stage.name} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
              color: "rgba(255,255,255,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              transition: "background 120ms, color 120ms, border-color 120ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "white";
              e.currentTarget.style.borderColor = "#36363A";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255,255,255,0.6)";
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Scrollable body ──────────────────────────────────────────
            minHeight: 0 is the flexbox-column scroll fix — without it,
            the implicit min-content height of this flex item lets its
            children push the box taller than the parent <aside>, so
            overflowY never triggers and content below the fold becomes
            unreachable. Surfaces immediately once the attachments
            section grows past the viewport. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 18px 24px",
          }}
        >
          {/* Title + done checkbox row */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              marginBottom: 18,
            }}
          >
            <button
              type="button"
              disabled={!canToggleDone}
              onClick={() => onToggleDone(task.id, !task.done)}
              aria-label={task.done ? "Mark incomplete" : "Mark complete"}
              aria-pressed={task.done}
              style={{
                flexShrink: 0,
                marginTop: 4,
                width: 20,
                height: 20,
                borderRadius: 5,
                background: task.done ? "#15B981" : "transparent",
                border: `1.5px solid ${
                  task.done ? "#15B981" : "rgba(255,255,255,0.3)"
                }`,
                cursor: canToggleDone ? "pointer" : "not-allowed",
                opacity: canToggleDone ? 1 : 0.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                transition: "background 120ms, border-color 120ms",
              }}
            >
              {task.done && <Check size={13} color="white" strokeWidth={3} />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              {isRenamingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={pendingTitle}
                  onChange={(e) => setPendingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitTitleRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelTitleRename();
                    }
                  }}
                  onBlur={submitTitleRename}
                  maxLength={200}
                  style={{
                    width: "100%",
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid rgba(16,140,233,0.5)",
                    borderRadius: 6,
                    color: "white",
                    fontSize: 17,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    padding: "4px 8px",
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
              ) : (
                <h2
                  onClick={canEditFields ? startTitleRename : undefined}
                  style={{
                    margin: 0,
                    fontSize: 17,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    color: task.done ? "rgba(255,255,255,0.55)" : "white",
                    textDecoration: task.done ? "line-through" : "none",
                    cursor: canEditFields ? "text" : "default",
                    wordBreak: "break-word",
                    padding: "2px 0",
                  }}
                >
                  {task.title}
                </h2>
              )}

              {/* Inline description — sits directly under the title in the
                  same "card header" block. Mirrors the title's UX: click
                  to edit (canEditFields), Enter commits, Shift+Enter for a
                  newline (multi-line still supported per the spec), Esc
                  cancels, blur commits. No section label, no border in
                  display mode — reads as body copy beneath the title. */}
              <InlineDescription
                value={task.description}
                isEditing={isEditingDescription}
                pending={pendingDescription}
                canEdit={canEditFields}
                textareaRef={descriptionTextareaRef}
                onStartEdit={startDescriptionEdit}
                onChangePending={setPendingDescription}
                onSubmit={submitDescription}
                onCancel={cancelDescriptionEdit}
              />
            </div>
          </div>

          {/* Properties: Assignee + Deadline (2-column-ish stacked rows) */}
          <PanelFieldRow label="Assignee">
            <AssigneeField
              member={assigneeMember}
              canChange={canEditPipeline}
              onOpenPicker={() => setAssigneePickerOpen((v) => !v)}
              pickerOpen={assigneePickerOpen}
              members={members}
              currentAssigneeId={task.assignee_id}
              onPick={(id) => {
                setAssigneePickerOpen(false);
                onChangeAssignee(task.id, id);
              }}
              onClosePicker={() => setAssigneePickerOpen(false)}
            />
          </PanelFieldRow>

          <PanelFieldRow label="Deadline">
            <DeadlineField
              deadline={task.deadline}
              canChange={canEditFields}
              pickerOpen={deadlinePickerOpen}
              onOpenPicker={() => setDeadlinePickerOpen((v) => !v)}
              onClosePicker={() => setDeadlinePickerOpen(false)}
              onPick={(iso) => {
                setDeadlinePickerOpen(false);
                onChangeDeadline(task.id, iso);
              }}
            />
          </PanelFieldRow>

          {/* Checklist */}
          <PanelSection label="Checklist">
            <ChecklistSection
              taskId={task.id}
              canEdit={canEditPipeline}
              taskClientVisible={task.client_visible}
            />
          </PanelSection>

          {/* Stage notes (read-only display) */}
          <PanelSection label="Stage">
            <StageContextRow
              stageName={stage.name}
              stagePosition={stage.position}
            />
          </PanelSection>

          {/* Client visibility (owner/admin only) */}
          {canEditPipeline && (
            <PanelSection label="Visibility">
              <ClientVisibleToggle
                value={task.client_visible}
                onChange={(v) => onChangeClientVisible(task.id, v)}
              />
            </PanelSection>
          )}
          {!canEditPipeline && task.client_visible && (
            <PanelSection label="Visibility">
              <div
                style={{
                  fontSize: 12,
                  color: "rgba(255,255,255,0.55)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Eye size={13} /> Visible to client
              </div>
            </PanelSection>
          )}

          {/* Attachments — task-scoped pipeline_links rows. Mirrors the
              Files-tab upload/add-link/delete plumbing in FilesBody.tsx
              but filtered to this task and sets task_id on every
              insert. RLS is unaffected (gates are on pipeline_id). */}
          <PanelSection label="Attachments">
            <TaskAttachmentsSection
              pipelineId={pipelineId}
              taskId={task.id}
              canEdit={canEditPipeline}
              viewerId={currentUserId}
            />
          </PanelSection>

          {/* +Add sibling task — owner/admin only */}
          {canEditPipeline && (
            <PanelSection label={null}>
              {isAddingSibling ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(16,140,233,0.5)",
                    borderRadius: 8,
                  }}
                >
                  <input
                    ref={siblingInputRef}
                    type="text"
                    value={siblingTitle}
                    onChange={(e) => setSiblingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        submitAddSibling();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelAddSibling();
                      }
                    }}
                    onBlur={() => {
                      if (!siblingTitle.trim()) cancelAddSibling();
                    }}
                    placeholder="Task title…"
                    maxLength={200}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      color: "white",
                      fontSize: 13,
                      padding: 0,
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={startAddSibling}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    background: "transparent",
                    border: "1px dashed rgba(255,255,255,0.18)",
                    borderRadius: 8,
                    color: "rgba(255,255,255,0.55)",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 120ms, color 120ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                    e.currentTarget.style.color = "rgba(255,255,255,0.85)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.color = "rgba(255,255,255,0.55)";
                  }}
                >
                  <Plus size={13} />
                  Add another task to this stage
                </button>
              )}
            </PanelSection>
          )}
        </div>

        {/* ── Footer: delete (owner/admin) ───────────────────────────── */}
        {canEditPipeline && (
          <div
            style={{
              padding: "10px 14px",
              borderTop: "1px solid #2A2A2D",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              aria-label="Delete task"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 30,
                padding: "0 12px",
                borderRadius: 6,
                background: "transparent",
                border: "1px solid #36363A",
                color: "rgba(244,63,94,0.85)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: "background 120ms, color 120ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(244,63,94,0.12)";
                e.currentTarget.style.color = "#F43F5E";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "rgba(244,63,94,0.85)";
              }}
            >
              <Trash2 size={12} /> Delete task
            </button>
          </div>
        )}
      </aside>

      {showDeleteConfirm && (
        <DeleteTaskConfirmDialog
          taskTitle={task.title}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() => {
            setShowDeleteConfirm(false);
            onDeleteTask(task.id); // canvas closes the panel on success
          }}
        />
      )}
    </>
  );
}

// ─── Small layout primitives ──────────────────────────────────────────────

function Breadcrumb({
  pipelineName,
  stageName,
}: {
  pipelineName: string;
  stageName: string;
}) {
  return (
    <div
      style={{
        fontSize: 12,
        color: "rgba(255,255,255,0.55)",
        display: "flex",
        alignItems: "center",
        gap: 4,
        flex: 1,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "45%",
        }}
      >
        {pipelineName}
      </span>
      <ChevronRight size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
      <span
        style={{
          color: "rgba(255,255,255,0.85)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: 500,
        }}
      >
        {stageName}
      </span>
    </div>
  );
}

// ─── Inline description (sits under the title, no section label) ─────────

/**
 * Description rendered as body copy directly under the title. Display
 * mode: muted multi-line text (preserves user's newlines via
 * white-space: pre-wrap), or a placeholder when empty + editable.
 * Click → textarea (auto-sized via rows but resizable). Enter commits
 * (preventDefault on the keydown); Shift+Enter inserts a newline so
 * multi-line is still possible. Esc cancels. Blur commits.
 *
 * When the user can't edit:
 *   * Has a description → render as plain muted text (not clickable)
 *   * Empty             → render nothing (no "No description" stub)
 */
function InlineDescription({
  value,
  isEditing,
  pending,
  canEdit,
  textareaRef,
  onStartEdit,
  onChangePending,
  onSubmit,
  onCancel,
}: {
  value: string | null;
  isEditing: boolean;
  pending: string;
  canEdit: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onStartEdit: () => void;
  onChangePending: (next: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={pending}
        onChange={(e) => onChangePending(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            // Enter commits — matches the title's pattern. Shift+Enter
            // lets the textarea insert a newline naturally (no
            // preventDefault, default behavior).
            e.preventDefault();
            onSubmit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onSubmit}
        placeholder="Add a description…"
        rows={Math.min(8, Math.max(2, (pending.match(/\n/g)?.length ?? 0) + 2))}
        style={{
          width: "100%",
          marginTop: 4,
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(16,140,233,0.5)",
          borderRadius: 6,
          color: "rgba(255,255,255,0.85)",
          fontSize: 13,
          lineHeight: 1.5,
          padding: "6px 8px",
          outline: "none",
          fontFamily: "inherit",
          resize: "vertical",
        }}
      />
    );
  }

  const trimmed = value?.trim();
  if (trimmed) {
    return (
      <div
        onClick={canEdit ? onStartEdit : undefined}
        style={{
          marginTop: 4,
          fontSize: 13,
          lineHeight: 1.5,
          color: "rgba(255,255,255,0.7)",
          // Preserve user-entered newlines.
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          cursor: canEdit ? "text" : "default",
          padding: "2px 0",
        }}
      >
        {value}
      </div>
    );
  }

  // Empty + editable → "Add description…" placeholder. Empty + read-only →
  // render nothing (clean panel).
  if (!canEdit) return null;
  return (
    <div
      onClick={onStartEdit}
      style={{
        marginTop: 4,
        fontSize: 13,
        lineHeight: 1.5,
        color: "rgba(255,255,255,0.35)",
        fontStyle: "italic",
        cursor: "text",
        padding: "2px 0",
        transition: "color 120ms",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.color = "rgba(255,255,255,0.55)")
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.color = "rgba(255,255,255,0.35)")
      }
    >
      Add a description…
    </div>
  );
}

function PanelFieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 0",
      }}
    >
      <div
        style={{
          width: 90,
          flexShrink: 0,
          fontSize: 12,
          fontWeight: 500,
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function PanelSection({
  label,
  children,
}: {
  label: string | null;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 20 }}>
      {label !== null && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 8,
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Assignee field + picker popover ──────────────────────────────────────

function AssigneeField({
  member,
  canChange,
  pickerOpen,
  onOpenPicker,
  onClosePicker,
  members,
  currentAssigneeId,
  onPick,
}: {
  member: ChromeMember | null;
  canChange: boolean;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  members: ChromeMember[];
  currentAssigneeId: string | null;
  onPick: (id: string | null) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Outside click / Esc to close.
  useEffect(() => {
    if (!pickerOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        onClosePicker();
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [pickerOpen, onClosePicker]);

  // Filter to ASSIGNABLE members (agency-side: owner/admin/member). Clients
  // can't be assigned to tasks — they don't do the work.
  const assignable = useMemo(
    () => members.filter((m) => m.role !== "client"),
    [members],
  );

  // member === null → no assignee → null → "Unassigned" (handled by
  // the `?? "Unassigned"` below). A member with neither name nor email
  // also resolves to "Unassigned" via whenMissing, matching the prior
  // local helper's null-terminal behavior. (Unreachable in practice —
  // every member row carries an email.)
  const displayName = member
    ? resolveDisplayName(member.user, { whenMissing: "Unassigned" })
    : null;

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={!canChange}
        onClick={onOpenPicker}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px",
          background: canChange ? "rgba(255,255,255,0.04)" : "transparent",
          border: `1px solid ${canChange ? "#36363A" : "transparent"}`,
          borderRadius: 6,
          color: "white",
          cursor: canChange ? "pointer" : "default",
          fontSize: 13,
          textAlign: "left",
          transition: "background 120ms, border-color 120ms",
        }}
        onMouseEnter={(e) => {
          if (canChange)
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        }}
        onMouseLeave={(e) => {
          if (canChange)
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        }}
      >
        {member ? (
          <UserAvatar user={member.user} size={22} />
        ) : (
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: 5,
              background: "rgba(255,255,255,0.06)",
              border: "1px dashed rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.4)",
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            ?
          </div>
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: member ? "white" : "rgba(255,255,255,0.55)",
          }}
        >
          {displayName ?? "Unassigned"}
        </span>
      </button>

      {pickerOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 60,
            background: "#212124",
            border: "1px solid #36363A",
            borderRadius: 8,
            padding: 4,
            maxHeight: 260,
            overflowY: "auto",
            boxShadow: "0 12px 32px rgba(0,0,0,0.5)",
          }}
        >
          {/* Unassign row */}
          <PickerRow
            selected={currentAssigneeId === null}
            onClick={() => onPick(null)}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                background: "rgba(255,255,255,0.06)",
                border: "1px dashed rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.4)",
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              ?
            </div>
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }}>
              Unassigned
            </span>
          </PickerRow>

          {assignable.length === 0 && (
            <div
              style={{
                padding: "10px 12px",
                fontSize: 12,
                color: "rgba(255,255,255,0.5)",
                fontStyle: "italic",
              }}
            >
              No assignable members.
            </div>
          )}

          {assignable.map((m) => (
            <PickerRow
              key={m.user.id}
              selected={currentAssigneeId === m.user.id}
              onClick={() => onPick(m.user.id)}
            >
              <UserAvatar user={m.user} size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: "white",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {resolveDisplayName(m.user, { whenMissing: "Pending member" })}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "rgba(255,255,255,0.45)",
                    textTransform: "capitalize",
                  }}
                >
                  {m.role}
                </div>
              </div>
              {currentAssigneeId === m.user.id && (
                <Check size={14} color="#108CE9" />
              )}
            </PickerRow>
          ))}
        </div>
      )}
    </div>
  );
}

function PickerRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 8px",
        background: selected ? "rgba(16,140,233,0.12)" : "transparent",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        textAlign: "left",
        color: "white",
      }}
      onMouseEnter={(e) => {
        if (!selected)
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

// ─── Deadline field (reuses DatePickerPopover) ────────────────────────────

function DeadlineField({
  deadline,
  canChange,
  pickerOpen,
  onOpenPicker,
  onClosePicker,
  onPick,
}: {
  deadline: string | null;
  canChange: boolean;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  onPick: (iso: string | null) => void;
}) {
  const label = deadline ? formatDeadline(deadline) : "No deadline";
  // Anchor ref for DatePickerPopover. The popover renders via Portal +
  // position:fixed (so it escapes the task panel's scroll container) and
  // uses this ref to position itself.
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        disabled={!canChange}
        onClick={onOpenPicker}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          padding: "5px 10px",
          background: canChange ? "rgba(255,255,255,0.04)" : "transparent",
          border: `1px solid ${canChange ? "#36363A" : "transparent"}`,
          borderRadius: 6,
          color: deadline ? "white" : "rgba(255,255,255,0.55)",
          fontSize: 13,
          cursor: canChange ? "pointer" : "default",
          textAlign: "left",
          transition: "background 120ms",
        }}
        onMouseEnter={(e) => {
          if (canChange)
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
        }}
        onMouseLeave={(e) => {
          if (canChange)
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
        }}
      >
        {label}
      </button>
      {pickerOpen && (
        <DatePickerPopover
          anchor={buttonRef.current}
          currentDeadline={deadline}
          onSelect={onPick}
          onClose={onClosePicker}
        />
      )}
    </div>
  );
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  if (dayDiff === -1) return "Yesterday";
  if (dayDiff < -1) return `${Math.abs(dayDiff)} days overdue`;
  if (dayDiff < 7) return `In ${dayDiff} days`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

// ─── Stage context (read-only) ────────────────────────────────────────────

function StageContextRow({
  stageName,
  stagePosition,
}: {
  stageName: string;
  stagePosition: number;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid #2A2A2D",
        borderRadius: 6,
        fontSize: 13,
        color: "rgba(255,255,255,0.75)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.45)",
          marginBottom: 2,
        }}
      >
        Stage {stagePosition}
      </div>
      <div style={{ color: "white", fontWeight: 500 }}>{stageName}</div>
      <div
        style={{
          marginTop: 6,
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          fontStyle: "italic",
        }}
      >
        Stage notes are edited in pipeline edit mode.
      </div>
    </div>
  );
}

// ─── Client-visible toggle (owner/admin) ──────────────────────────────────

function ClientVisibleToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: value ? "rgba(16,140,233,0.1)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${value ? "#108CE9" : "#36363A"}`,
        borderRadius: 6,
        color: value ? "#108CE9" : "rgba(255,255,255,0.75)",
        cursor: "pointer",
        fontSize: 13,
        textAlign: "left",
        transition: "background 120ms, border-color 120ms, color 120ms",
      }}
    >
      {value ? <Eye size={14} /> : <EyeOff size={14} />}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>
          {value ? "Visible to client" : "Hidden from client"}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            marginTop: 2,
          }}
        >
          {value
            ? "This task shows up in the client portal."
            : "Only your team can see this task."}
        </div>
      </div>
      <Toggle on={value} />
    </button>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <div
      style={{
        width: 28,
        height: 16,
        borderRadius: 8,
        background: on ? "#108CE9" : "rgba(255,255,255,0.15)",
        position: "relative",
        transition: "background 120ms",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 2,
          left: on ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: "white",
          transition: "left 120ms",
        }}
      />
    </div>
  );
}

// ─── Task attachments section ─────────────────────────────────────────────
//
// Mirrors the Files-tab plumbing in FilesBody.tsx: optimistic upload +
// reconcile, optimistic add-link, optimistic delete with revert, drag
// + drop, FilePreview modal dispatch for image/pdf, signed-URL
// download for everything else. The only meaningful difference is that
// every INSERT carries `task_id: taskId` so the row is task-scoped
// (the Files tab still surfaces these rows with a "from: <task>" badge
// via the joined task_title — see pipeline-files-data.ts).
//
// We do NOT re-export the FilesBody implementation as a shared hook;
// the upload/add-link/delete code is short enough that direct copy
// keeps both surfaces readable, and a shared abstraction would have to
// re-thread modal state through props for negligible win. If a third
// caller appears, then promote.

type TaskAttachmentItem = FileItem & { status?: "uploading" };
type TaskAttachmentPreview = { type: "image" | "pdf"; row: FileItem } | null;
type TaskAttachmentDelete = { id: string; label: string } | null;

function TaskAttachmentsSection({
  pipelineId,
  taskId,
  canEdit,
  viewerId,
}: {
  pipelineId: string;
  taskId: string;
  /** Upload + add-link affordances gated on can_edit_pipeline (admin/
   *  owner). Per-row delete + visibility toggle additionally allow
   *  the row's own uploader — same rule the Files tab uses, matching
   *  the pipeline_links RLS UPDATE/DELETE policy. */
  canEdit: boolean;
  viewerId: string;
}) {
  const [files, setFiles] = useState<TaskAttachmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [showAddLink, setShowAddLink] = useState(false);
  const [showDelete, setShowDelete] = useState<TaskAttachmentDelete>(null);
  const [preview, setPreview] = useState<TaskAttachmentPreview>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  // Same SELECT shape as FilesBody — keeps the row shape compatible
  // with FileCard without re-mapping. task_title stays null for rows
  // in this surface: every row here belongs to THIS task, so the badge
  // would be redundant noise (it only earns its keep on the Files tab
  // where rows are mixed pipeline- and task-scoped).
  const SELECT_COLS =
    "id, kind, label, url, storage_path, file_name, file_size, mime_type, client_visible, added_by, added_at, task_id";

  // ── Lazy fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    void (async () => {
      const { data, error: fetchErr } = await supabase
        .from("pipeline_links")
        .select(SELECT_COLS)
        .eq("pipeline_id", pipelineId)
        .eq("task_id", taskId)
        .order("added_at", { ascending: false });

      if (cancelled) return;
      if (fetchErr) {
        console.error("[task-attachments] fetch failed:", fetchErr);
        setFetchError("Couldn't load attachments.");
        setLoading(false);
        return;
      }

      const rawRows = (data ?? []) as Array<
        Omit<FileItem, "added_by_profile" | "task_title">
      >;

      // Batch uploader profiles — same two-query pattern fetchPipeline-
      // Files uses (added_by → auth.users not profiles, so PostgREST
      // nested join returns nothing).
      const uploaderIds = Array.from(
        new Set(
          rawRows
            .map((r) => r.added_by)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const profilesRes = uploaderIds.length
        ? await supabase
            .from("profiles")
            .select("id, display_name, avatar_url, email")
            .in("id", uploaderIds)
        : { data: [], error: null };
      if (cancelled) return;
      if (profilesRes.error) {
        console.error(
          "[task-attachments] profile fetch failed (uploader avatars will fall back):",
          profilesRes.error,
        );
      }
      const profileById = new Map<string, UploaderProfile>();
      for (const p of (profilesRes.data ?? []) as UploaderProfile[]) {
        profileById.set(p.id, p);
      }

      const items: TaskAttachmentItem[] = rawRows.map((r) => ({
        ...r,
        added_by_profile: r.added_by
          ? (profileById.get(r.added_by) ?? null)
          : null,
        task_title: null,
      }));
      setFiles(items);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [pipelineId, taskId]);

  // ── Upload (single file) — extracted so file-picker AND drop handler share it.
  const uploadFile = useCallback(
    async (file: File) => {
      setInlineError(null);
      const storagePath = buildStoragePath(pipelineId, file.name);
      const tempId = crypto.randomUUID();
      const mimeType = file.type || null;

      const optimistic: TaskAttachmentItem = {
        id: tempId,
        kind: "file",
        label: null,
        url: null,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: mimeType,
        client_visible: false,
        added_by: viewerId,
        added_by_profile: null,
        added_at: new Date().toISOString(),
        task_id: taskId,
        task_title: null,
        status: "uploading",
      };
      setFiles((prev) => [optimistic, ...prev]);

      const { error: uploadErr } = await supabase
        .storage
        .from("pipeline_files")
        .upload(storagePath, file, {
          contentType: file.type || undefined,
          upsert: false,
        });

      if (uploadErr) {
        console.error("[task-attachments] storage upload failed:", uploadErr);
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Upload failed. Try again.");
        return;
      }

      const { data: row, error: insertErr } = await supabase
        .from("pipeline_links")
        .insert({
          pipeline_id: pipelineId,
          task_id: taskId,
          kind: "file",
          label: null,
          storage_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: mimeType,
          added_by: viewerId,
          client_visible: false,
        })
        .select(SELECT_COLS)
        .single();

      if (insertErr || !row) {
        console.error("[task-attachments] metadata insert failed:", insertErr);
        const { error: cleanupErr } = await supabase
          .storage
          .from("pipeline_files")
          .remove([storagePath]);
        if (cleanupErr) {
          console.error(
            "[task-attachments] orphan cleanup ALSO failed — invisible bytes left in bucket:",
            cleanupErr,
          );
        }
        setFiles((prev) => prev.filter((f) => f.id !== tempId));
        setInlineError("Couldn't save attachment. Try again.");
        return;
      }

      const enriched: FileItem = {
        ...(row as Omit<FileItem, "added_by_profile" | "task_title">),
        added_by_profile: null,
        task_title: null,
      };
      setFiles((prev) => prev.map((f) => (f.id === tempId ? enriched : f)));
    },
    [pipelineId, taskId, viewerId],
  );

  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";
      void uploadFile(file);
    },
    [uploadFile],
  );

  // ── Drag-and-drop ─────────────────────────────────────────────────────
  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!canEdit) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current += 1;
      setDragActive(true);
    },
    [canEdit],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
    },
    [canEdit],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!canEdit) return;
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setDragActive(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length === 0) return;
      for (const file of dropped) {
        void uploadFile(file);
      }
    },
    [canEdit, uploadFile],
  );

  // ── Add link ─────────────────────────────────────────────────────────
  const handleAddLink = useCallback(
    async (label: string, url: string) => {
      const { data: row, error } = await supabase
        .from("pipeline_links")
        .insert({
          pipeline_id: pipelineId,
          task_id: taskId,
          kind: "url",
          label,
          url,
          added_by: viewerId,
          client_visible: false,
        })
        .select(SELECT_COLS)
        .single();

      if (error || !row) {
        console.error("[task-attachments] add link failed:", error);
        throw new Error(error?.message ?? "Insert failed");
      }

      const enriched: FileItem = {
        ...(row as Omit<FileItem, "added_by_profile" | "task_title">),
        added_by_profile: null,
        task_title: null,
      };
      setFiles((prev) => [enriched, ...prev]);
      setShowAddLink(false);
    },
    [pipelineId, taskId, viewerId],
  );

  // ── Toggle visibility ───────────────────────────────────────────────
  const handleToggleVisibility = useCallback(
    async (id: string, next: boolean) => {
      const snapshot = files;
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, client_visible: next } : f)),
      );
      const { error } = await supabase
        .from("pipeline_links")
        .update({ client_visible: next })
        .eq("id", id);
      if (error) {
        console.error("[task-attachments] toggle visibility failed:", error);
        setFiles(snapshot);
        setInlineError("Couldn't change visibility. Try again.");
      }
    },
    [files],
  );

  // ── Delete (after confirm) ──────────────────────────────────────────
  // Same metadata-first → storage-after order FilesBody uses; same
  // privacy-safe-orphan-on-failure trade-off.
  const handleDelete = useCallback(
    async (id: string) => {
      const row = files.find((f) => f.id === id);
      if (!row) {
        setShowDelete(null);
        return;
      }
      const snapshot = files;
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setShowDelete(null);

      const { error: metaErr } = await supabase
        .from("pipeline_links")
        .delete()
        .eq("id", id);
      if (metaErr) {
        console.error("[task-attachments] metadata delete failed:", metaErr);
        setFiles(snapshot);
        setInlineError("Couldn't delete. Try again.");
        return;
      }

      if (row.kind === "file" && row.storage_path) {
        const { error: storageErr } = await supabase
          .storage
          .from("pipeline_files")
          .remove([row.storage_path]);
        if (storageErr) {
          console.error(
            "[task-attachments] storage delete failed — orphan left in bucket:",
            storageErr,
          );
        }
      }
    },
    [files],
  );

  // ── Row dispatch (preview / download / open) ────────────────────────
  const handleRowClick = useCallback(async (row: FileItem) => {
    if (row.kind === "url") {
      const target = row.url ? normalizeUrl(row.url) : null;
      if (target) {
        window.open(target, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (!row.storage_path) return;
    const mime = row.mime_type ?? "";
    if (mime.startsWith("image/")) {
      setPreview({ type: "image", row });
      return;
    }
    if (mime === "application/pdf") {
      setPreview({ type: "pdf", row });
      return;
    }
    const { error } = await triggerFileDownload(
      row.storage_path,
      row.file_name,
    );
    if (error) {
      setInlineError("Couldn't download. Try again.");
    }
  }, []);

  const handleDownload = useCallback(async (row: FileItem) => {
    if (row.kind !== "file" || !row.storage_path) return;
    const { error } = await triggerFileDownload(
      row.storage_path,
      row.file_name,
    );
    if (error) {
      setInlineError("Couldn't download. Try again.");
    }
  }, []);

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Action row — Upload + Add link buttons. canEdit hides the
          whole row for view-only roles (matching FilesBody). */}
      {canEdit && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={panelAttachmentBtnStyle}
          >
            <Upload size={12} />
            Upload
          </button>
          <button
            type="button"
            onClick={() => setShowAddLink(true)}
            style={panelAttachmentBtnStyle}
          >
            <LinkIcon size={12} />
            Add link
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFilePick}
            style={{ display: "none" }}
          />
        </div>
      )}

      {/* Inline error — fetch failures + upload/add/delete failures. */}
      {(inlineError || fetchError) && (
        <div
          role="alert"
          style={{
            padding: "8px 10px",
            background: "rgba(244,63,94,0.08)",
            border: "1px solid rgba(244,63,94,0.3)",
            borderRadius: 6,
            fontSize: 12,
            color: "#F43F5E",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>{inlineError ?? fetchError}</span>
          {inlineError && (
            <button
              type="button"
              onClick={() => setInlineError(null)}
              aria-label="Dismiss error"
              style={{
                background: "transparent",
                border: "none",
                color: "#F43F5E",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* List / empty / loading — drag-drop attaches here so drops land
          on the same container that shows the cards, mirroring FilesBody. */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          position: "relative",
          minHeight: 64,
          padding: 4,
          border: `1.5px dashed ${dragActive ? "#108CE9" : "transparent"}`,
          borderRadius: 8,
          transition: "border-color 120ms ease-out, background 120ms ease-out",
          background: dragActive ? "rgba(16,140,233,0.04)" : "transparent",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {loading ? (
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              padding: "8px 4px",
            }}
          >
            Loading…
          </div>
        ) : files.length === 0 ? (
          <div
            style={{
              padding: "12px 10px",
              background: "rgba(255,255,255,0.02)",
              border: "1px dashed rgba(255,255,255,0.12)",
              borderRadius: 6,
              fontSize: 12,
              color: "rgba(255,255,255,0.45)",
              textAlign: "center",
            }}
          >
            {canEdit
              ? "Drop a file here, or use Upload / Add link."
              : "No attachments yet."}
          </div>
        ) : (
          files.map((row) => (
            <TaskAttachmentRow
              key={row.id}
              row={row}
              canEdit={canEdit || row.added_by === viewerId}
              onToggleVisibility={handleToggleVisibility}
              onRequestDelete={(id) => {
                const r = files.find((f) => f.id === id);
                const label = r?.label ?? r?.file_name ?? "this item";
                setShowDelete({ id, label });
              }}
              onClick={handleRowClick}
              onDownload={handleDownload}
            />
          ))
        )}

        {dragActive && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 5,
            }}
          >
            <div
              style={{
                padding: "8px 14px",
                background: "rgba(16,140,233,0.18)",
                border: "1px solid #108CE9",
                borderRadius: 999,
                color: "#108CE9",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Drop to upload
            </div>
          </div>
        )}
      </div>

      {/* Modals — scoped to this section so the panel root stays
          untouched. AddLinkModal + FilePreview are imported from
          components/files; DeleteConfirm is local because the Files
          tab's version is also section-scoped and not exported. */}
      {showAddLink && (
        <AddLinkModal
          onCancel={() => setShowAddLink(false)}
          onSave={handleAddLink}
        />
      )}
      {showDelete && (
        <TaskAttachmentDeleteConfirm
          label={showDelete.label}
          onCancel={() => setShowDelete(null)}
          onConfirm={() => void handleDelete(showDelete.id)}
        />
      )}
      {preview && (
        <FilePreview
          type={preview.type}
          row={preview.row}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// Compact attachment row used INSIDE the task panel only. Same data
// model as FileCard but no preview thumbnail — the row is one line
// (icon · title · type · action buttons) so a task with many
// attachments doesn't blow the panel out vertically. The Files tab
// keeps the full preview-forward FileCard layout unchanged.
//
// Primary action button (leftmost of the cluster) adapts to the row
// type so the affordance reads correctly at a glance:
//   * Previewable file (image / pdf) → Maximize2 (opens FilePreview)
//   * Other file types               → Download (signed-URL trigger)
//   * URL                            → ExternalLink (opens new tab)
// All three route through the SAME onClick/onDownload dispatchers the
// panel already owns, so the row body click + button click produce the
// same outcome.
//
// We deliberately do not reuse the green Eye icon for "open preview"
// even though the user described it as "eye/preview button" — that
// would clash with the existing Eye / EyeOff visibility toggle that
// also lives in the action cluster. Maximize2 reads as "expand"
// without colliding visually with the visibility affordance.
function TaskAttachmentRow({
  row,
  canEdit,
  onToggleVisibility,
  onRequestDelete,
  onClick,
  onDownload,
}: {
  row: TaskAttachmentItem;
  /** Combined gate — true for pipeline editors AND for the row's own
   *  uploader (matching the pipeline_links UPDATE/DELETE RLS). Controls
   *  visibility toggle + trash button. */
  canEdit: boolean;
  onToggleVisibility: (id: string, next: boolean) => void;
  onRequestDelete: (id: string) => void;
  onClick: (row: FileItem) => void;
  onDownload: (row: FileItem) => void;
}) {
  const isUploading = row.status === "uploading";
  const mime = row.mime_type ?? "";
  const isImage = row.kind === "file" && mime.startsWith("image/");
  const isPdf = row.kind === "file" && mime === "application/pdf";
  const isPreviewable = isImage || isPdf;

  const iconSrc = pickRowIcon(row);
  const displayLabel =
    row.label?.trim() ||
    row.file_name ||
    (row.kind === "url" ? row.url : null) ||
    "Untitled";
  const typeText = rowTypeLabel(row);

  return (
    <div
      onClick={() => {
        if (!isUploading) onClick(row);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: "#212124",
        border: "1px solid #2A2A2D",
        borderRadius: 6,
        cursor: isUploading ? "wait" : "pointer",
        opacity: isUploading ? 0.7 : 1,
        transition: "border-color 120ms ease-out, background 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!isUploading) e.currentTarget.style.borderColor = "#3A3A3E";
      }}
      onMouseLeave={(e) => {
        if (!isUploading) e.currentTarget.style.borderColor = "#2A2A2D";
      }}
    >
      <Image
        src={iconSrc}
        alt=""
        width={22}
        height={22}
        style={{ flexShrink: 0 }}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        <span
          title={displayLabel}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "white",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.3,
          }}
        >
          {displayLabel}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "rgba(255,255,255,0.5)",
            lineHeight: 1.2,
          }}
        >
          {typeText}
        </span>
      </div>

      {isUploading ? (
        <Loader2
          size={16}
          color="rgba(255,255,255,0.6)"
          style={{
            flexShrink: 0,
            animation: "taskAttachmentSpin 1s linear infinite",
          }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Non-previewable files use the explicit download helper
              // (signed-URL + anchor click). Previewable files + URLs
              // both dispatch through onClick which routes correctly.
              if (row.kind === "file" && !isPreviewable) {
                onDownload(row);
              } else {
                onClick(row);
              }
            }}
            aria-label={
              row.kind === "url"
                ? `Open "${displayLabel}" in new tab`
                : isPreviewable
                  ? `Preview "${displayLabel}"`
                  : `Download "${displayLabel}"`
            }
            title={
              row.kind === "url"
                ? "Open"
                : isPreviewable
                  ? "Preview"
                  : "Download"
            }
            style={rowIconBtnStyle(false)}
          >
            {row.kind === "url" ? (
              <ExternalLink size={13} color="rgba(255,255,255,0.65)" />
            ) : isPreviewable ? (
              <Maximize2 size={13} color="rgba(255,255,255,0.65)" />
            ) : (
              <Download size={13} color="rgba(255,255,255,0.65)" />
            )}
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(row.id, !row.client_visible);
              }}
              aria-label={
                row.client_visible
                  ? `Hide "${displayLabel}" from client`
                  : `Show "${displayLabel}" to client`
              }
              aria-pressed={row.client_visible}
              title={
                row.client_visible ? "Visible to client" : "Hidden from client"
              }
              style={rowIconBtnStyle(row.client_visible)}
            >
              {row.client_visible ? (
                <Eye size={13} color="#15B981" />
              ) : (
                <EyeOff size={13} color="rgba(255,255,255,0.45)" />
              )}
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete(row.id);
              }}
              aria-label={`Delete "${displayLabel}"`}
              title="Delete"
              style={rowIconBtnStyle(false)}
            >
              <Trash2 size={13} color="rgba(255,255,255,0.55)" />
            </button>
          )}
        </div>
      )}

      {/* Spinner keyframes scoped to this component — small enough to
          colocate; avoids touching globals.css for one icon. */}
      <style>{`
        @keyframes taskAttachmentSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function pickRowIcon(row: FileItem): string {
  if (row.kind === "url") return "/icons/file-link.svg";
  const mime = row.mime_type ?? "";
  if (mime.startsWith("image/")) return "/icons/file-image.svg";
  if (mime === "application/pdf") return "/icons/file-pdf.svg";
  if (mime.startsWith("video/")) return "/icons/file-video.svg";
  return "/icons/file-pdf.svg";
}

function rowTypeLabel(row: FileItem): string {
  if (row.kind === "url") return "Link";
  const mime = row.mime_type ?? "";
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("video/")) return "Video";
  const fn = row.file_name ?? "";
  const dotIdx = fn.lastIndexOf(".");
  if (dotIdx > 0) {
    const ext = fn.slice(dotIdx + 1).toUpperCase();
    if (ext.length > 0 && ext.length <= 6) return ext;
  }
  return "File";
}

function rowIconBtnStyle(active: boolean): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 5,
    background: active ? "rgba(21,185,129,0.10)" : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? "rgba(21,185,129,0.25)" : "#36363A"}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
    transition: "background 120ms ease-out, border-color 120ms ease-out",
  };
}

function TaskAttachmentDeleteConfirm({
  label,
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      role="dialog"
      aria-label="Confirm delete"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 380,
          background: "#1A1A1C",
          border: "1px solid #36363A",
          borderRadius: 12,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: "white",
            lineHeight: 1.5,
          }}
        >
          Delete <strong>&ldquo;{label}&rdquo;</strong>? This can&rsquo;t be
          undone.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              ...panelAttachmentBtnStyle,
              padding: "8px 14px",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              background: "#F43F5E",
              border: "1px solid #F43F5E",
              borderRadius: 8,
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

const panelAttachmentBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid #36363A",
  borderRadius: 6,
  color: "rgba(255,255,255,0.85)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  transition: "background 120ms ease-out, border-color 120ms ease-out",
};

// ─── Checklist subsection (lazy-fetches checklist_items) ──────────────────

type ChecklistItemRaw = {
  id: string;
  task_id: string;
  title: string;
  position: number;
  client_visible: boolean;
  completed_at: string | null;
  completed_by: string | null;
};

function ChecklistSection({
  taskId,
  canEdit,
  taskClientVisible,
}: {
  taskId: string;
  canEdit: boolean;
  /** Parent task's client_visible — inherited by new items via the
   *  inherit_checklist_item_client_visible trigger. We don't need to
   *  send it explicitly on INSERT, but it informs UX copy. */
  taskClientVisible: boolean;
}) {
  const [items, setItems] = useState<ChecklistItemRaw[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [pendingItemTitle, setPendingItemTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);

  // Fetch checklist for the active task. Re-fetches when taskId changes
  // (panel switched to a different task without unmounting).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void supabase
      .from("checklist_items")
      .select(
        "id, task_id, title, position, client_visible, completed_at, completed_by",
      )
      .eq("task_id", taskId)
      .order("position", { ascending: true })
      .then((res) => {
        if (cancelled) return;
        if (res.error) {
          setError(res.error.message);
          setItems([]);
        } else {
          setItems((res.data ?? []) as ChecklistItemRaw[]);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const startAdd = useCallback(() => {
    if (!canEdit) return;
    setIsAdding(true);
    setPendingItemTitle("");
    setTimeout(() => addInputRef.current?.focus(), 0);
  }, [canEdit]);

  const submitAdd = useCallback(async () => {
    const cleaned = pendingItemTitle.trim();
    if (!cleaned) {
      setIsAdding(false);
      setPendingItemTitle("");
      return;
    }
    const maxPos = items.reduce((m, i) => Math.max(m, i.position), 0);
    // Optimistic with a temp id; replace with real id on success.
    const tempId = `tmp-${Date.now()}`;
    const optimistic: ChecklistItemRaw = {
      id: tempId,
      task_id: taskId,
      title: cleaned,
      position: maxPos + 1,
      client_visible: taskClientVisible,
      completed_at: null,
      completed_by: null,
    };
    setItems((prev) => [...prev, optimistic]);
    setPendingItemTitle("");
    addInputRef.current?.focus();

    const { data, error: insertError } = await supabase
      .from("checklist_items")
      .insert({
        task_id: taskId,
        title: cleaned,
        position: maxPos + 1,
        // Don't send client_visible — inherit_checklist_item_client_visible
        // trigger fires BEFORE INSERT and inherits from the parent task.
        // (NOT NULL column has no default; the trigger provides the value.)
      })
      .select(
        "id, task_id, title, position, client_visible, completed_at, completed_by",
      )
      .single();

    if (insertError || !data) {
      console.error(
        "[panel 6] checklist insert failed; reverting:",
        insertError?.message,
      );
      setItems((prev) => prev.filter((i) => i.id !== tempId));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.id === tempId ? (data as ChecklistItemRaw) : i)),
    );
  }, [pendingItemTitle, items, taskId, taskClientVisible]);

  const cancelAdd = useCallback(() => {
    setIsAdding(false);
    setPendingItemTitle("");
  }, []);

  const toggleItem = useCallback(
    async (id: string, nextCompleted: boolean) => {
      if (!canEdit) return;
      let prev: ChecklistItemRaw | undefined;
      setItems((items) =>
        items.map((i) => {
          if (i.id !== id) return i;
          prev = i;
          return {
            ...i,
            completed_at: nextCompleted ? new Date().toISOString() : null,
          };
        }),
      );

      const { error: updateError } = await supabase
        .from("checklist_items")
        .update({
          completed_at: nextCompleted ? new Date().toISOString() : null,
        })
        .eq("id", id);

      if (updateError) {
        console.error(
          "[panel 6] checklist toggle failed; reverting:",
          updateError.message,
        );
        if (prev) {
          setItems((items) => items.map((i) => (i.id === id ? prev! : i)));
        }
      }
    },
    [canEdit],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      if (!canEdit) return;
      let removed: ChecklistItemRaw | undefined;
      setItems((items) => {
        removed = items.find((i) => i.id === id);
        return items.filter((i) => i.id !== id);
      });

      const { error: deleteError } = await supabase
        .from("checklist_items")
        .delete()
        .eq("id", id);

      if (deleteError) {
        console.error(
          "[panel 6] checklist delete failed; reverting:",
          deleteError.message,
        );
        if (removed) {
          setItems((items) =>
            [...items, removed!].sort((a, b) => a.position - b.position),
          );
        }
      }
    },
    [canEdit],
  );

  if (loading) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.45)",
          padding: "8px 4px",
        }}
      >
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontSize: 12, color: "#F43F5E", padding: "8px 4px" }}>
        Couldn&apos;t load checklist: {error}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* CSS-only hover reveal for the per-row delete X. The previous
          inline-style approach attached opacity:0→1 on the BUTTON's
          own mouseEnter — but with opacity:0 by default the user
          couldn't see the button to know to hover it. CSS scoped to
          row hover (or button focus, for keyboard users) is the
          correct pattern here. */}
      <style>{`
        [data-checklist-row]:hover [data-checklist-delete],
        [data-checklist-delete]:focus-visible {
          opacity: 1 !important;
        }
      `}</style>

      {items.length === 0 && !isAdding && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.4)",
            fontStyle: "italic",
            padding: "4px 0",
          }}
        >
          No checklist items yet.
        </div>
      )}

      {items.map((item) => {
        const completed = !!item.completed_at;
        return (
          <div
            key={item.id}
            data-checklist-row
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 6px",
              borderRadius: 5,
              transition: "background 120ms",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.03)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => toggleItem(item.id, !completed)}
              aria-label={completed ? "Mark item incomplete" : "Mark item complete"}
              aria-pressed={completed}
              style={{
                flexShrink: 0,
                width: 15,
                height: 15,
                borderRadius: 4,
                background: completed ? "#15B981" : "transparent",
                border: `1.5px solid ${
                  completed ? "#15B981" : "rgba(255,255,255,0.25)"
                }`,
                cursor: canEdit ? "pointer" : "not-allowed",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: canEdit ? 1 : 0.5,
              }}
            >
              {completed && (
                <Check size={10} color="white" strokeWidth={3} />
              )}
            </button>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                color: completed
                  ? "rgba(255,255,255,0.5)"
                  : "rgba(255,255,255,0.85)",
                textDecoration: completed ? "line-through" : "none",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.title}
            </span>
            {canEdit && (
              <button
                type="button"
                data-checklist-delete
                onClick={() => deleteItem(item.id)}
                aria-label={`Delete checklist item ${item.title}`}
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: "transparent",
                  border: "none",
                  color: "rgba(255,255,255,0.45)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  // Hidden by default; visible via the row-hover CSS rule
                  // at the top of the section (or on keyboard focus).
                  opacity: 0,
                  transition: "opacity 120ms, color 120ms, background 120ms",
                }}
                // Button-level mouseEnter keeps the destructive-red color
                // change so the user sees they're about to delete (not
                // just hovering the row). Opacity is owned by the CSS
                // rule now — we only manage color here.
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#F43F5E";
                  e.currentTarget.style.background = "rgba(244,63,94,0.12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "rgba(255,255,255,0.45)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}

      {canEdit && (
        <>
          {isAdding ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 6px",
                marginTop: 2,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(16,140,233,0.4)",
                borderRadius: 5,
              }}
            >
              <div
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: 4,
                  border: "1.5px solid rgba(255,255,255,0.2)",
                  flexShrink: 0,
                }}
              />
              <input
                ref={addInputRef}
                type="text"
                value={pendingItemTitle}
                onChange={(e) => setPendingItemTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitAdd();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelAdd();
                  }
                }}
                onBlur={() => {
                  if (!pendingItemTitle.trim()) cancelAdd();
                }}
                placeholder="Checklist item…"
                maxLength={200}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  color: "white",
                  fontSize: 13,
                  padding: 0,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={startAdd}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 6px",
                marginTop: 2,
                background: "transparent",
                border: "none",
                color: "rgba(255,255,255,0.45)",
                fontSize: 13,
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                transition: "color 120ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "rgba(255,255,255,0.85)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "rgba(255,255,255,0.45)";
              }}
            >
              <Plus size={13} />
              Add item
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Delete-task confirm dialog ───────────────────────────────────────────

function DeleteTaskConfirmDialog({
  taskTitle,
  onCancel,
  onConfirm,
}: {
  taskTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel-card"
        style={{
          width: "100%",
          maxWidth: 420,
          padding: 24,
        }}
      >
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "#E4E4E7",
            margin: "0 0 8px",
          }}
        >
          Delete task?
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "#979393",
            lineHeight: 1.5,
            margin: "0 0 20px",
          }}
        >
          This will delete &ldquo;{taskTitle}&rdquo; and its checklist items.
          This can&apos;t be undone.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid #36363A",
              color: "#E4E4E7",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 8,
              background: "#F43F5E",
              border: "1px solid #F43F5E",
              color: "white",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
