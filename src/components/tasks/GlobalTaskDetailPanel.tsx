"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X, Target, User, Calendar, Flag, ChevronRight, Upload, Link as LinkIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import { sortAssigneesForViewer } from "@/lib/sort-assignees";
import { TaskTabIcon } from "@/components/icons/TaskTabIcon";
import { DocEditor, type DocContent } from "@/components/documents/DocEditor";
import { DueDatePopover } from "@/components/tasks/DueDatePopover";
import { PriorityPopover } from "@/components/tasks/PriorityPopover";
import { StatusPopover, type StatusSelection } from "@/components/tasks/StatusPopover";
import { AssigneesPopover } from "@/components/tasks/AssigneesPopover";
import { TaskAttachmentsSection, type TaskAttachmentsSectionHandle } from "@/components/canvas/TaskDetailPanel";
import type { TaskAssignee, TaskRow } from "@/components/tasks/types";

/**
 * Task detail side panel for the global Task tab (Figma V2) — a Notion-
 * style page: breadcrumb, title, description, a Status/Assignees/Dates/
 * Priority property row (reusing the exact popovers already built for the
 * table cells), then a rich-text body (DocEditor, same engine as the doc
 * pages) autosaved to the new `tasks.body` column.
 *
 * Distinct from src/components/canvas/TaskDetailPanel.tsx (the panel used
 * inside a pipeline's board view) — that one's body is a plain single-line
 * description and it has checklist/attachments/notes sections this panel
 * doesn't. Sharing one component wasn't practical: the canvas panel reads
 * its member list + callbacks from PipelineCanvas's already-loaded state,
 * while this one is reached from the cross-project Task tab with no
 * canvas/member-list context loaded. If a third caller ever needs the
 * same shape, promote a shared core then — not before.
 *
 * Assignees has a real multi-select picker (AssigneesPopover) — scoped to
 * the task's own pipeline's agency members, same pool the canvas panel's
 * assignee picker uses. The per-line "+" (hover-only, one per block —
 * DocEditor's own feature, see BlockRow there) offers Banner (a real block
 * type now, so multiple banners can live anywhere in the body — solid
 * color + header text, no image, per Jordan) plus two extra items this
 * panel supplies: Upload file / Add link, which route into
 * TaskAttachmentsSection (exported from canvas/TaskDetailPanel.tsx) via
 * its imperative handle rather than duplicating that upload/link/delete/
 * preview logic. `tasks.banner` (an earlier single-slot design) is no
 * longer read or written — banners live in `tasks.body` blocks now. The
 * column itself is harmless to leave unused; not worth a migration to
 * drop it.
 *
 * NOT WIRED YET (flagged, not faked): there's no permission model on this
 * tab yet (unlike the canvas panel's canEditPipeline gating) — every field
 * here, including attachments, is editable by any workspace member who can
 * reach the Task tab at all.
 */

const PANEL_WIDTH = 560;

type Props = {
  task: TaskRow;
  currentUserId: string;
  onClose: () => void;
  onUpdate: (taskId: string, patch: Partial<TaskRow>) => void;
};

export function GlobalTaskDetailPanel({ task, currentUserId, onClose, onUpdate }: Props) {
  const asideRef = useRef<HTMLElement | null>(null);
  const attachmentsRef = useRef<TaskAttachmentsSectionHandle | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Title inline edit ───────────────────────────────────────────────────
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [pendingTitle, setPendingTitle] = useState(task.title);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setPendingTitle(task.title), [task.title]);

  const commitTitle = () => {
    const cleaned = pendingTitle.trim();
    setIsEditingTitle(false);
    if (!cleaned || cleaned === task.title) {
      setPendingTitle(task.title);
      return;
    }
    onUpdate(task.id, { title: cleaned });
    void supabase.from("tasks").update({ title: cleaned }).eq("id", task.id).then(({ error }) => {
      if (error) console.error("[task-panel] title update failed:", error.message);
    });
  };

  // ── Description inline edit ─────────────────────────────────────────────
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [pendingDescription, setPendingDescription] = useState(task.description ?? "");
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setPendingDescription(task.description ?? ""), [task.description]);

  const commitDescription = () => {
    setIsEditingDescription(false);
    const trimmed = pendingDescription.trim();
    const next = trimmed || null;
    if (next === task.description) return;
    onUpdate(task.id, { description: next });
    void supabase.from("tasks").update({ description: next }).eq("id", task.id).then(({ error }) => {
      if (error) console.error("[task-panel] description update failed:", error.message);
    });
  };

  // ── Body (rich text, DocEditor — banners live in here as blocks now) ────
  const [body, setBody] = useState<DocContent | null>(null);
  useEffect(() => {
    let cancelled = false;
    setBody(null);
    void supabase
      .from("tasks")
      .select("body")
      .eq("id", task.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[task-panel] body fetch failed:", error.message);
          setBody({ blocks: [] });
          return;
        }
        const raw = (data?.body ?? {}) as Partial<DocContent>;
        setBody({ blocks: raw.blocks ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const bodySaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleBodyChange = (next: DocContent) => {
    setBody(next);
    if (bodySaveTimer.current) clearTimeout(bodySaveTimer.current);
    bodySaveTimer.current = setTimeout(async () => {
      const { error } = await supabase.from("tasks").update({ body: next }).eq("id", task.id);
      if (error) console.error("[task-panel] body save failed:", error.message);
    }, 800);
  };

  // ── Property popovers ────────────────────────────────────────────────────
  const [openPopover, setOpenPopover] = useState<"status" | "priority" | "date" | "assignees" | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const openWith = (which: "status" | "priority" | "date" | "assignees") => (e: React.MouseEvent<HTMLButtonElement>) => {
    setAnchor(e.currentTarget);
    setOpenPopover((prev) => (prev === which ? null : which));
  };

  const handleAssigneesChange = (next: TaskAssignee[]) => {
    onUpdate(task.id, { assignees: next });
  };

  const handleStatusSelect = (selection: StatusSelection) => {
    setOpenPopover(null);
    if (selection === "complete") {
      onUpdate(task.id, { done: true });
      void supabase.from("tasks").update({ done: true }).eq("id", task.id).then(({ error }) => {
        if (error) console.error("[task-panel] status update failed:", error.message);
      });
      onClose();
      return;
    }
    onUpdate(task.id, { status: selection, done: false });
    void supabase.from("tasks").update({ status: selection, done: false }).eq("id", task.id).then(({ error }) => {
      if (error) console.error("[task-panel] status update failed:", error.message);
    });
  };

  const handlePrioritySelect = (priority: TaskRow["priority"]) => {
    setOpenPopover(null);
    onUpdate(task.id, { priority });
    void supabase.from("tasks").update({ priority }).eq("id", task.id).then(({ error }) => {
      if (error) console.error("[task-panel] priority update failed:", error.message);
    });
  };

  const handleDateSelect = (deadline: string | null) => {
    setOpenPopover(null);
    onUpdate(task.id, { deadline });
    void supabase.from("tasks").update({ deadline }).eq("id", task.id).then(({ error }) => {
      if (error) console.error("[task-panel] deadline update failed:", error.message);
    });
  };

  const statusMeta = STATUS_DISPLAY[task.done ? "complete" : task.status];
  const dueLabel = task.deadline
    ? new Date(task.deadline).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
    : "No date";

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          right: PANEL_WIDTH,
          background: "rgba(0,0,0,0.35)",
          zIndex: 50,
          animation: "fadeIn 160ms ease-out",
        }}
      />
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
          background: "#0A0A0B",
          borderLeft: "1px solid #2D2E30",
          color: "#E4E4E7",
          zIndex: 51,
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 220ms cubic-bezier(0.2, 0, 0, 1)",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.4)",
        }}
      >
        <style>{`
          @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        `}</style>

        {/* Header: task icon / pipeline emoji + name */}
        <div
          style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid #212124",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
            <TaskTabIcon size={18} />
            <span className="text-[13px]" style={{ color: "#D4D4D8" }}>Task</span>
            <span style={{ color: "#52525B" }}>/</span>
            <span style={{ fontSize: 13 }}>{task.pipeline.emoji}</span>
            <span
              className="text-[13px] truncate"
              style={{ color: "#D4D4D8" }}
            >
              {task.pipeline.name}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="flex items-center justify-center transition-colors"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "transparent",
              border: "none",
              color: "#71717A",
              cursor: "pointer",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#E4E4E7")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#71717A")}
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 32px 40px" }}>
          {/* Title */}
          {isEditingTitle ? (
            <textarea
              ref={titleRef}
              autoFocus
              value={pendingTitle}
              onChange={(e) => setPendingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitle();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsEditingTitle(false);
                  setPendingTitle(task.title);
                }
              }}
              onBlur={commitTitle}
              rows={1}
              className="font-bold w-full outline-none resize-none"
              style={{
                background: "transparent",
                border: "none",
                color: "#FAFAFA",
                fontSize: 26,
                lineHeight: 1.3,
                padding: 0,
                fontFamily: "inherit",
              }}
            />
          ) : (
            <h1
              onClick={() => {
                setIsEditingTitle(true);
                setTimeout(() => titleRef.current?.focus(), 0);
              }}
              className="font-bold"
              style={{ fontSize: 26, lineHeight: 1.3, color: "#FAFAFA", margin: 0, cursor: "text" }}
            >
              {task.title}
            </h1>
          )}

          {/* Description */}
          {isEditingDescription ? (
            <textarea
              ref={descriptionRef}
              autoFocus
              value={pendingDescription}
              onChange={(e) => setPendingDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitDescription();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsEditingDescription(false);
                  setPendingDescription(task.description ?? "");
                }
              }}
              onBlur={commitDescription}
              placeholder="Add a description…"
              rows={Math.min(6, Math.max(2, (pendingDescription.match(/\n/g)?.length ?? 0) + 2))}
              className="w-full outline-none resize-none"
              style={{
                marginTop: 8,
                background: "transparent",
                border: "none",
                color: "#A1A1AA",
                fontSize: 14,
                lineHeight: 1.6,
                padding: 0,
                fontFamily: "inherit",
              }}
            />
          ) : (
            <p
              onClick={() => {
                setIsEditingDescription(true);
                setTimeout(() => descriptionRef.current?.focus(), 0);
              }}
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.6,
                color: task.description ? "#A1A1AA" : "#52525B",
                fontStyle: task.description ? "normal" : "italic",
                cursor: "text",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {task.description || "Add a description…"}
            </p>
          )}

          {/* Property row */}
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #212124" }}>
            <PropertyRow icon={<Target size={13} />} label="Status">
              <button
                type="button"
                onClick={openWith("status")}
                className="flex items-center transition-opacity"
                style={{
                  background: statusMeta.bg,
                  border: "none",
                  borderRadius: 6,
                  color: statusMeta.color,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                <span className="flex items-center gap-1.5" style={{ padding: "5px 10px" }}>
                  <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: statusMeta.color, flexShrink: 0 }} />
                  {statusMeta.label}
                </span>
                <span
                  className="flex items-center justify-center"
                  style={{ padding: "5px 6px", background: "rgba(0,0,0,0.15)", alignSelf: "stretch" }}
                >
                  <ChevronRight size={12} />
                </span>
              </button>
              {openPopover === "status" && (
                <StatusPopover
                  anchor={anchor}
                  value={task.done ? "complete" : task.status}
                  onSelect={handleStatusSelect}
                  onClose={() => setOpenPopover(null)}
                />
              )}
            </PropertyRow>

            <PropertyRow icon={<User size={13} />} label="Assignees">
              <PropertyValueButton onClick={openWith("assignees")}>
                {task.assignees.length === 0 ? (
                  <span className="text-[13px]" style={{ color: "#52525B" }}>Empty</span>
                ) : (
                  <div className="flex items-center">
                    {/* Outer disc is a SOLID backing colored to match the
                        panel background (#0A0A0B), not just a border —
                        several avatar palette colors are ~20% alpha (see
                        AVATAR_PALETTE in avatar-color.ts), so a plain thin
                        border let the previous avatar's color bleed
                        through the overlap. A wider opaque ring (3px, vs.
                        the first attempt's too-thin 1.5px) means the
                        overlap only ever eats into the ring, not the
                        neighboring avatar's colored fill, so the visible
                        stroke around each avatar stays a clean full arc. */}
                    {sortAssigneesForViewer(task.assignees, currentUserId).map((a, i) => {
                      const { text, bg } = getAvatarColorFromUserId(a.id);
                      return (
                        <div
                          key={a.id}
                          title={a.displayName ?? undefined}
                          className="flex items-center justify-center rounded-full"
                          style={{
                            width: 30,
                            height: 30,
                            marginLeft: i === 0 ? 0 : -8,
                            background: "#0A0A0B",
                            flexShrink: 0,
                          }}
                        >
                          {a.avatarUrl ? (
                            <Image
                              src={a.avatarUrl}
                              alt=""
                              width={24}
                              height={24}
                              unoptimized
                              style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover", display: "block" }}
                            />
                          ) : (
                            <div
                              className="flex items-center justify-center rounded-full text-[10px] font-medium"
                              style={{ width: 24, height: 24, background: bg, color: text }}
                            >
                              {resolveInitial({ display_name: a.displayName })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </PropertyValueButton>
              {openPopover === "assignees" && (
                <AssigneesPopover
                  anchor={anchor}
                  pipelineId={task.pipeline.id}
                  taskId={task.id}
                  currentAssignees={task.assignees}
                  onChange={handleAssigneesChange}
                  onClose={() => setOpenPopover(null)}
                />
              )}
            </PropertyRow>

            <PropertyRow icon={<Calendar size={13} />} label="Dates">
              <PropertyValueButton onClick={openWith("date")}>
                <div className="flex items-center gap-1.5">
                  {task.deadline && <Calendar size={13} color="#F43F5E" />}
                  <span className="text-[13px]" style={{ color: task.deadline ? "#E4E4E7" : "#52525B" }}>
                    {task.deadline ? dueLabel : "Empty"}
                  </span>
                </div>
              </PropertyValueButton>
              {openPopover === "date" && (
                <DueDatePopover
                  anchor={anchor}
                  value={task.deadline}
                  onSelect={handleDateSelect}
                  onClose={() => setOpenPopover(null)}
                />
              )}
            </PropertyRow>

            <PropertyRow icon={<Flag size={13} />} label="Priority" last>
              <PropertyValueButton onClick={openWith("priority")}>
                <div className="flex items-center gap-1.5">
                  {task.priority && (
                    <Flag size={13} color={PRIORITY_COLORS[task.priority]} fill={PRIORITY_COLORS[task.priority]} />
                  )}
                  <span className="text-[13px]" style={{ color: task.priority ? "#E4E4E7" : "#52525B" }}>
                    {task.priority ? PRIORITY_LABELS[task.priority] : "Empty"}
                  </span>
                </div>
              </PropertyValueButton>
              {openPopover === "priority" && (
                <PriorityPopover
                  anchor={anchor}
                  value={task.priority}
                  onSelect={handlePrioritySelect}
                  onClose={() => setOpenPopover(null)}
                />
              )}
            </PropertyRow>
          </div>

          {/* Divider between the property row and the body content */}
          <div style={{ marginTop: 16, borderTop: "1px solid #212124" }} />

          {/* Rich-text body — the per-line "+" (hover, one per block) and
              Banner support both live inside DocEditor itself now; this
              panel only supplies the two extra menu items that aren't
              content-block concerns. */}
          <div style={{ marginTop: 16 }}>
            {body && (
              <DocEditor
                content={body}
                onChange={handleBodyChange}
                placeholder="Write, press '/' for commands"
                extraPlusMenuItems={[
                  { label: "Upload file", icon: Upload, onSelect: () => attachmentsRef.current?.triggerUpload() },
                  { label: "Add link", icon: LinkIcon, onSelect: () => attachmentsRef.current?.triggerAddLink() },
                ]}
              />
            )}
          </div>

          {/* Attachments — files/links added via the menu above land here,
              reusing the exact same upload/add-link/delete/preview code
              the pipeline board's task panel already has. */}
          <div style={{ marginTop: 20 }}>
            <div className="text-[11px] mb-2" style={{ color: "#71717A", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Attachments
            </div>
            <TaskAttachmentsSection
              ref={attachmentsRef}
              pipelineId={task.pipeline.id}
              taskId={task.id}
              canEdit
              viewerId={currentUserId}
            />
          </div>
        </div>
      </aside>
    </>
  );
}

const STATUS_DISPLAY: Record<"not_started" | "in_progress" | "complete", { label: string; color: string; bg: string }> = {
  not_started: { label: "Not started", color: "#D4D4D8", bg: "#26262A" },
  in_progress: { label: "In progress", color: "#FFFFFF", bg: "#108CE9" },
  complete: { label: "Complete", color: "#FFFFFF", bg: "#15B981" },
};

const PRIORITY_COLORS: Record<NonNullable<TaskRow["priority"]>, string> = {
  urgent: "#F43F5E",
  high: "#F59E0B",
  normal: "#108CE9",
  low: "#71717A",
};

const PRIORITY_LABELS: Record<NonNullable<TaskRow["priority"]>, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

function PropertyRow({
  icon,
  label,
  children,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center"
      style={{ padding: "7px 0", marginBottom: last ? 0 : 0 }}
    >
      <div className="flex items-center gap-2" style={{ width: 110, flexShrink: 0, color: "#71717A" }}>
        {icon}
        <span className="text-[13px]">{label}</span>
      </div>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Shared hover affordance for an "empty"-capable property value — a
 *  full-width box that shows a subtle gray background on hover so it
 *  reads as clickable, matching the Figma spec's "Empty" property state. */
function PropertyValueButton({
  onClick,
  children,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="transition-colors"
      style={{
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderRadius: 6,
        padding: "5px 8px",
        margin: "0 -8px",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#1C1C1F")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}
