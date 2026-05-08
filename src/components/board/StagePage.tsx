"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  FileEdit,
  FileText,
  Lock,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ChecklistItem } from "./ChecklistItem";
import { DeadlinePill } from "./DeadlinePill";
import { timeAgo } from "@/lib/format";
import type { Client, Session, Stage, StageNote } from "@/types/stages";

type Props = {
  client: Client;
  stage: Stage;
  session: Session;
  isCurrent: boolean;
  onBack: () => void;
  onMarkComplete: () => void;
  onToggleTask: (taskId: string) => void;
  onAddTask: (text: string) => void;
  onRemoveTask: (taskId: string) => void;
  onSetTaskNote: (taskId: string, note: string) => void;
  onEditTaskText: (taskId: string, text: string) => void;
  onAddNote: (text: string) => void;
  onEditNote: (noteId: string, text: string) => void;
  onDeleteNote: (noteId: string) => void;
  onUpdateStageDescription: (description: string) => void;
  onSetStageDeadline: (deadline: number | null) => void;
  onSetTaskDeadline: (taskId: string, deadline: number | null) => void;
  onToggleStageClientVisible: () => void;
  onToggleTaskClientVisible: (taskId: string) => void;
  onToggleNoteClientVisible: (noteId: string) => void;
  onAddStageAttachment: (
    label: string,
    dataUrl: string,
    fileName: string,
    fileSize: number,
  ) => void;
  onToggleStageAttachmentClientVisible: (attachmentId: string) => void;
  onRemoveStageAttachment: (attachmentId: string) => void;
  onReorderTask: (taskId: string, newIndex: number) => void;
};

const ATT_MAX_BYTES = 3 * 1024 * 1024;

function formatBytes(b?: number): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeNotes(notes: unknown): StageNote[] {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes as StageNote[];
  return [];
}

export function StagePage({
  client,
  stage,
  session,
  isCurrent,
  onBack,
  onMarkComplete,
  onToggleTask,
  onAddTask,
  onRemoveTask,
  onSetTaskNote,
  onEditTaskText,
  onAddNote,
  onEditNote,
  onDeleteNote,
  onUpdateStageDescription,
  onSetStageDeadline,
  onSetTaskDeadline,
  onToggleStageClientVisible,
  onToggleTaskClientVisible,
  onToggleNoteClientVisible,
  onAddStageAttachment,
  onToggleStageAttachmentClientVisible,
  onRemoveStageAttachment,
  onReorderTask,
}: Props) {
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descDraft, setDescDraft] = useState(stage.description || "");
  const [attDragActive, setAttDragActive] = useState(false);
  const [attError, setAttError] = useState("");
  const [attPreview, setAttPreview] = useState<{
    label: string;
    dataUrl: string;
    fileName?: string;
    fileSize?: number;
    addedBy: string;
  } | null>(null);
  const attFileInputRef = useRef<HTMLInputElement | null>(null);

  const completedTasks = stage.tasks.filter((t) => t.done).length;
  const sortedNotes = [...normalizeNotes(stage.notes)].sort((a, b) => b.ts - a.ts);

  const myMember = (client.members || []).find((m) => m.email === session.email);
  const isAdminMember = myMember?.role === "admin";
  const canEditDescription =
    client.ownerEmail === session.email || isAdminMember;

  const stageAttachments = stage.attachments || [];

  useEffect(() => {
    setNewNote("");
    setEditingNoteId(null);
    setEditDraft("");
    setExpandedTaskId(null);
    setEditingDescription(false);
    setDescDraft(stage.description || "");
  }, [stage.id, stage.description]);

  const submitTask = () => {
    if (newTask.trim()) {
      onAddTask(newTask);
      setNewTask("");
    }
  };
  const submitNote = () => {
    if (newNote.trim()) {
      onAddNote(newNote);
      setNewNote("");
    }
  };
  const startEditing = (note: StageNote) => {
    setEditingNoteId(note.id);
    setEditDraft(note.text);
  };
  const commitEdit = () => {
    if (editingNoteId && editDraft.trim()) {
      onEditNote(editingNoteId, editDraft);
    }
    setEditingNoteId(null);
    setEditDraft("");
  };
  const cancelEdit = () => {
    setEditingNoteId(null);
    setEditDraft("");
  };

  const startEditDescription = () => {
    if (!canEditDescription) return;
    setDescDraft(stage.description || "");
    setEditingDescription(true);
  };
  const commitDescription = () => {
    const trimmed = descDraft.trim();
    if (trimmed !== (stage.description || "")) {
      onUpdateStageDescription(trimmed);
    }
    setEditingDescription(false);
  };
  const cancelDescription = () => {
    setDescDraft(stage.description || "");
    setEditingDescription(false);
  };

  const handleAttFiles = async (files: FileList | null) => {
    setAttError("");
    if (!files) return;
    const arr = Array.from(files);
    for (const file of arr) {
      if (!file.type.startsWith("image/")) {
        setAttError(`Only images are supported in this MVP — ${file.name} skipped.`);
        continue;
      }
      if (file.size > ATT_MAX_BYTES) {
        setAttError(`${file.name} is larger than 3 MB and was skipped.`);
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        onAddStageAttachment(
          file.name.replace(/\.[^.]+$/, ""),
          dataUrl,
          file.name,
          file.size,
        );
      } catch {
        setAttError(`Failed to read ${file.name}.`);
      }
    }
  };

  const onAttDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setAttDragActive(false);
    handleAttFiles(e.dataTransfer.files);
  };
  const onAttDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setAttDragActive(true);
  };
  const onAttDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setAttDragActive(false);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#212124" }}>
      <header
        className="border-b flex items-center sticky top-0 z-30 relative overflow-hidden"
        style={{
          background: "#121212",
          borderColor: "#36363A",
          paddingLeft: "16px",
          paddingRight: "16px",
          paddingTop: "12px",
          paddingBottom: "12px",
          gap: "12px",
          minHeight: "64px",
        }}
      >
        <div
          className="absolute inset-0 opacity-20 pointer-events-none"
          style={{ background: `linear-gradient(180deg, ${stage.color}22, transparent)` }}
        />
        <div className="flex items-center gap-3 min-w-0 flex-1 relative">
          <button
            onClick={onBack}
            className="flex items-center justify-center transition-colors flex-shrink-0"
            style={{
              width: "36px",
              height: "36px",
              background: "#2C2C2F",
              border: "1px solid #36363A",
              borderRadius: "8px",
              color: "#A1A1AA",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#36363A";
              e.currentTarget.style.color = "#E4E4E7";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#2C2C2F";
              e.currentTarget.style.color = "#A1A1AA";
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] mt-0.5 truncate" style={{ color: "#979393" }}>
              {client.name}
              {client.company && <> · {client.company}</>}
              {" · back to pipeline"}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-semibold leading-tight truncate">
                {client.emoji || "📋"} {stage.name}
              </h1>
              {stage.completed ? (
                <span
                  className="badge"
                  style={{ background: "#15B98122", borderColor: "#15B98144", color: "#34D399" }}
                >
                  ✓ Complete
                </span>
              ) : isCurrent ? (
                <span
                  className="badge"
                  style={{
                    background: stage.color + "22",
                    borderColor: stage.color + "44",
                    color: stage.color,
                  }}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                    style={{ background: stage.color }}
                  />
                  Active
                </span>
              ) : (
                <span className="badge text-zinc-500">Upcoming</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 relative">
          {isCurrent && !stage.completed && (
            <button
              onClick={() => {
                onMarkComplete();
                onBack();
              }}
              className="flex items-center gap-2 transition-colors"
              style={{
                background: "#15B981",
                color: "white",
                border: "1px solid #15B981",
                borderRadius: "8px",
                padding: "0 14px",
                height: "36px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#0FA771";
                e.currentTarget.style.borderColor = "#0FA771";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#15B981";
                e.currentTarget.style.borderColor = "#15B981";
              }}
            >
              <CheckCircle2 size={14} strokeWidth={2.5} />{" "}
              <span className="hidden sm:inline">Mark complete &amp; advance</span>
              <span className="sm:hidden">Complete</span>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto p-4 sm:p-8">
          <div className="mb-8 pb-6 border-b border-zinc-800">
            <div className="flex items-start gap-4">
              <div
                className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 text-lg font-bold"
                style={{
                  background: stage.color + "22",
                  color: stage.color,
                  border: `1px solid ${stage.color}44`,
                }}
              >
                {stage.completed ? (
                  <Check size={24} strokeWidth={3} />
                ) : (
                  client.stages.findIndex((s) => s.id === stage.id) + 1
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-3xl font-semibold leading-tight">{stage.name}</h2>

                {editingDescription ? (
                  <div className="mt-2">
                    <textarea
                      autoFocus
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      onBlur={commitDescription}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          commitDescription();
                        } else if (e.key === "Escape") {
                          cancelDescription();
                        }
                      }}
                      placeholder="Add a brief description for this stage…"
                      className="w-full leading-relaxed resize-none"
                      style={{
                        background: "#1A1A1C",
                        border: `1px solid ${stage.color}66`,
                        borderRadius: "8px",
                        padding: "10px 12px",
                        color: "#E4E4E7",
                        fontSize: "14px",
                        outline: "none",
                        minHeight: "60px",
                      }}
                    />
                    <div className="text-[11px] mt-1" style={{ color: "#979393" }}>
                      Enter to save · Shift+Enter for new line · Esc to cancel
                    </div>
                  </div>
                ) : stage.description ? (
                  <div
                    onClick={canEditDescription ? startEditDescription : undefined}
                    className={`mt-2 leading-relaxed text-[14px] ${
                      canEditDescription
                        ? "cursor-text rounded-md transition-colors px-2 py-1 -mx-2"
                        : ""
                    }`}
                    style={{ color: "#979393" }}
                    onMouseEnter={(e) => {
                      if (canEditDescription) e.currentTarget.style.background = "#2C2C2F";
                    }}
                    onMouseLeave={(e) => {
                      if (canEditDescription) e.currentTarget.style.background = "transparent";
                    }}
                    title={canEditDescription ? "Click to edit" : ""}
                  >
                    {stage.description}
                  </div>
                ) : canEditDescription ? (
                  <button
                    onClick={startEditDescription}
                    className="flex items-center gap-1.5 mt-2 text-[13px] transition-colors px-2 py-1 -mx-2 rounded-md"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#71717A",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "#A1A1AA";
                      e.currentTarget.style.background = "#2C2C2F";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "#71717A";
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <Plus size={12} strokeWidth={2.5} /> Add a description
                  </button>
                ) : null}

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <div className="text-[13px] text-zinc-500">
                    {completedTasks} of {stage.tasks.length} tasks complete
                    {stage.completedAt && <> · finished {timeAgo(stage.completedAt)}</>}
                  </div>
                  {(stage.deadline || canEditDescription) && !stage.completed && (
                    <>
                      <span className="text-[13px]" style={{ color: "#36363A" }}>
                        ·
                      </span>
                      <DeadlinePill
                        deadline={stage.deadline}
                        onChange={(d) => onSetStageDeadline(d)}
                        canEdit={canEditDescription}
                        size="md"
                        emptyLabel="Add deadline"
                      />
                    </>
                  )}
                  {canEditDescription && (
                    <>
                      <span className="text-[13px]" style={{ color: "#36363A" }}>
                        ·
                      </span>
                      <button
                        onClick={onToggleStageClientVisible}
                        className="inline-flex items-center gap-1.5 rounded-full transition-colors"
                        style={{
                          background: stage.clientVisible ? "#108CE91A" : "transparent",
                          border: `1px solid ${stage.clientVisible ? "#108CE966" : "#36363A"}`,
                          color: stage.clientVisible ? "#7EC2F4" : "#71717A",
                          padding: "5px 10px",
                          fontSize: "12px",
                          fontWeight: 500,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                        title={
                          stage.clientVisible
                            ? "Visible to client — click to hide"
                            : "Hidden from client — click to share"
                        }
                      >
                        {stage.clientVisible ? <ExternalLink size={11} /> : <Lock size={11} />}
                        <span>{stage.clientVisible ? "Visible to client" : "Internal only"}</span>
                      </button>
                    </>
                  )}
                </div>
                <div
                  className="h-1.5 rounded-full overflow-hidden mt-3"
                  style={{ background: "#36363A" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width:
                        stage.tasks.length > 0
                          ? `${(completedTasks / stage.tasks.length) * 100}%`
                          : "0%",
                      background: `linear-gradient(90deg, ${stage.color}, ${stage.color}CC)`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <section className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={18} className="text-zinc-400" />
                <h3 className="text-[16px] font-semibold">Checklist</h3>
              </div>
              <div className="text-[13px] text-zinc-500">
                {completedTasks}/{stage.tasks.length}
              </div>
            </div>

            <div className="space-y-2">
              {stage.tasks.map((task) => (
                <ChecklistItem
                  key={task.id}
                  task={task}
                  stageColor={stage.color}
                  expanded={expandedTaskId === task.id}
                  onToggle={() => onToggleTask(task.id)}
                  onRemove={() => onRemoveTask(task.id)}
                  onExpand={() =>
                    setExpandedTaskId(expandedTaskId === task.id ? null : task.id)
                  }
                  onSetNote={(note) => onSetTaskNote(task.id, note)}
                  onSetDeadline={
                    onSetTaskDeadline ? (deadline) => onSetTaskDeadline(task.id, deadline) : null
                  }
                  onToggleClientVisible={
                    onToggleTaskClientVisible ? () => onToggleTaskClientVisible(task.id) : null
                  }
                  onEditText={
                    onEditTaskText ? (text) => onEditTaskText(task.id, text) : null
                  }
                  canEdit={canEditDescription}
                  isDragging={draggingTaskId === task.id}
                  isDragOver={dragOverTaskId === task.id && draggingTaskId !== task.id}
                  draggable={canEditDescription && !!onReorderTask}
                  onDragStart={() => setDraggingTaskId(task.id)}
                  onDragEnd={() => {
                    setDraggingTaskId(null);
                    setDragOverTaskId(null);
                  }}
                  onDragOverItem={() => setDragOverTaskId(task.id)}
                  onDropItem={() => {
                    if (!draggingTaskId || draggingTaskId === task.id || !onReorderTask) {
                      setDragOverTaskId(null);
                      return;
                    }
                    const toIdx = stage.tasks.findIndex((t) => t.id === task.id);
                    onReorderTask(draggingTaskId, toIdx);
                    setDraggingTaskId(null);
                    setDragOverTaskId(null);
                  }}
                />
              ))}
              {stage.tasks.length === 0 && (
                <div className="panel-card p-6 text-center text-[13px] text-zinc-500">
                  No tasks yet. Add one below.
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitTask()}
                placeholder="Add a checklist item…"
                className="field flex-1"
              />
              <button
                onClick={submitTask}
                disabled={!newTask.trim()}
                className="btn-primary"
              >
                <Plus size={15} strokeWidth={2.5} /> Add
              </button>
            </div>
          </section>

          {onAddStageAttachment && (
            <section className="mb-10">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <FileText size={18} className="text-zinc-400" />
                  <h3 className="text-[16px] font-semibold">Files</h3>
                  {stageAttachments.length > 0 && (
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full"
                      style={{ background: "#36363A", color: "#A1A1AA" }}
                    >
                      {stageAttachments.length}
                    </span>
                  )}
                </div>
                <span className="text-[12px]" style={{ color: "#979393" }}>
                  Also visible in the pipeline&rsquo;s Files tab.
                </span>
              </div>

              {canEditDescription && (
                <div
                  onDrop={onAttDrop}
                  onDragOver={onAttDragOver}
                  onDragLeave={onAttDragLeave}
                  onClick={() => attFileInputRef.current?.click()}
                  className="rounded-xl text-center transition-all cursor-pointer mb-3"
                  style={{
                    border: `2px dashed ${attDragActive ? "#108CE9" : "#36363A"}`,
                    background: attDragActive ? "#108CE91A" : "#1A1A1C",
                    padding: "20px",
                  }}
                >
                  <div
                    className="mx-auto mb-2 flex items-center justify-center"
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      background: attDragActive ? "#108CE933" : "#2C2C2F",
                      border: `1px solid ${attDragActive ? "#108CE966" : "#36363A"}`,
                    }}
                  >
                    <Plus
                      size={18}
                      style={{ color: attDragActive ? "#7EC2F4" : "#979393" }}
                      strokeWidth={2.5}
                    />
                  </div>
                  <div className="text-[13px] font-semibold mb-0.5">
                    {attDragActive ? "Drop image here" : "Drag & drop an image"}
                  </div>
                  <div className="text-[11px]" style={{ color: "#979393" }}>
                    or <span style={{ color: "#7EC2F4", textDecoration: "underline" }}>click to browse</span>
                    {" "}· PNG, JPG, GIF, WebP · up to 3 MB
                  </div>
                  <input
                    ref={attFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleAttFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
              )}

              {attError && (
                <div
                  className="rounded-lg px-3 py-2 mb-3 text-[12px] flex items-start gap-2"
                  style={{
                    background: "#F4335E1A",
                    border: "1px solid #F4335E66",
                    color: "#F87171",
                  }}
                >
                  <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                  <span className="flex-1">{attError}</span>
                  <button
                    onClick={() => setAttError("")}
                    className="opacity-60 hover:opacity-100"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {stageAttachments.length === 0 ? (
                !canEditDescription && (
                  <div
                    className="text-center py-6 rounded-lg text-[13px]"
                    style={{
                      background: "#2C2C2F",
                      border: "1px dashed #36363A",
                      color: "#979393",
                    }}
                  >
                    No files attached to this stage yet.
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  {stageAttachments.map((att) => (
                    <div
                      key={att.id}
                      className="rounded-lg p-3 flex items-center gap-3 group transition-colors"
                      style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A4A50")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#36363A")}
                    >
                      <button
                        onClick={() => setAttPreview(att)}
                        className="flex-shrink-0 overflow-hidden rounded-lg"
                        style={{
                          width: "48px",
                          height: "48px",
                          background: "#1A1A1C",
                          border: "1px solid #36363A",
                          cursor: "zoom-in",
                        }}
                        title="Preview"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={att.dataUrl}
                          alt={att.label}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold truncate">{att.label}</div>
                        <div className="text-[11px] truncate" style={{ color: "#979393" }}>
                          {att.fileName}
                          {att.fileSize ? " · " + formatBytes(att.fileSize) : ""}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: "#71717A" }}>
                          Added by {att.addedBy} · {timeAgo(att.ts)}
                        </div>
                      </div>
                      {canEditDescription && onToggleStageAttachmentClientVisible && (
                        <button
                          onClick={() => onToggleStageAttachmentClientVisible(att.id)}
                          className="inline-flex items-center gap-1 rounded-full transition-colors flex-shrink-0"
                          style={{
                            background: att.clientVisible ? "#108CE91A" : "transparent",
                            border: `1px solid ${att.clientVisible ? "#108CE966" : "#36363A"}`,
                            color: att.clientVisible ? "#7EC2F4" : "#71717A",
                            padding: "3px 8px",
                            fontSize: "11px",
                            fontWeight: 500,
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                          title={
                            att.clientVisible
                              ? "Visible to client — click to hide"
                              : "Internal — click to share with client"
                          }
                        >
                          {att.clientVisible ? <ExternalLink size={10} /> : <Lock size={10} />}
                          <span>{att.clientVisible ? "Client" : "Internal"}</span>
                        </button>
                      )}
                      <button
                        onClick={() => setAttPreview(att)}
                        className="icon-btn"
                        title="Preview"
                      >
                        <ZoomIn size={13} />
                      </button>
                      {(canEditDescription || att.addedBy === session.email) &&
                        onRemoveStageAttachment && (
                          <button
                            onClick={() => {
                              if (confirm(`Remove "${att.label}"?`))
                                onRemoveStageAttachment(att.id);
                            }}
                            className="icon-btn opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ color: "#F87171" }}
                            title="Remove"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                    </div>
                  ))}
                </div>
              )}

              {attPreview && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center fade-in p-4"
                  style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
                  onClick={() => setAttPreview(null)}
                >
                  <button
                    onClick={() => setAttPreview(null)}
                    className="icon-btn absolute"
                    style={{ top: "16px", right: "16px", width: 36, height: 36 }}
                  >
                    <X size={16} />
                  </button>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="max-w-[90vw] max-h-[85vh] flex flex-col items-center gap-3"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attPreview.dataUrl}
                      alt={attPreview.label}
                      style={{
                        maxWidth: "100%",
                        maxHeight: "75vh",
                        objectFit: "contain",
                        borderRadius: "8px",
                      }}
                    />
                    <div className="text-[13px] font-semibold">{attPreview.label}</div>
                    <div className="text-[11px]" style={{ color: "#979393" }}>
                      {attPreview.fileName} · {formatBytes(attPreview.fileSize)} · added by {attPreview.addedBy}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="mb-10">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <FileEdit size={18} className="text-zinc-400" />
                <h3 className="text-[16px] font-semibold">Stage notes</h3>
                {sortedNotes.length > 0 && (
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full"
                    style={{ background: "#36363A", color: "#A1A1AA" }}
                  >
                    {sortedNotes.length}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2 mb-5 items-start">
              <Avatar email={session.email || "you"} size={7} />
              <div className="flex-1">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitNote();
                    }
                  }}
                  placeholder="Add a note about this stage… (Enter to post · Shift+Enter for new line)"
                  className="field min-h-[80px] resize-y leading-relaxed"
                />
                <div className="flex items-center justify-between mt-2">
                  <div className="text-[11px]" style={{ color: "#979393" }}>
                    {newNote.trim()
                      ? "Press Enter to post · Shift+Enter for new line"
                      : "Posting as " + (session.email || "you")}
                  </div>
                  <button
                    onClick={submitNote}
                    disabled={!newNote.trim()}
                    className="btn-primary"
                  >
                    <Send size={12} strokeWidth={2.5} /> Post Note
                  </button>
                </div>
              </div>
            </div>

            {sortedNotes.length > 0 ? (
              <div className="space-y-3">
                {sortedNotes.map((note) => {
                  const isMine = note.author === session.email;
                  const isEditing = editingNoteId === note.id;
                  return (
                    <div
                      key={note.id}
                      className="rounded-lg p-3 group transition-colors"
                      style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
                    >
                      <div className="flex items-start gap-2.5">
                        <Avatar email={note.author} size={7} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-semibold">{note.author}</span>
                            {isMine && (
                              <span
                                className="text-[10px] px-1.5 py-px rounded"
                                style={{ background: "#108CE91A", color: "#7EC2F4" }}
                              >
                                You
                              </span>
                            )}
                            <span className="text-[11px]" style={{ color: "#979393" }}>
                              {timeAgo(note.ts)}
                              {note.editedAt && note.editedAt !== note.ts ? " · edited" : ""}
                            </span>
                          </div>

                          {isEditing ? (
                            <div className="mt-2">
                              <textarea
                                autoFocus
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    commitEdit();
                                  } else if (e.key === "Escape") {
                                    cancelEdit();
                                  }
                                }}
                                className="field min-h-[60px] resize-y leading-relaxed text-[13px]"
                              />
                              <div className="flex justify-end gap-2 mt-2">
                                <button
                                  onClick={cancelEdit}
                                  className="btn-ghost"
                                  style={{ padding: "6px 10px", fontSize: "12px" }}
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={commitEdit}
                                  disabled={!editDraft.trim()}
                                  className="btn-primary"
                                  style={{ padding: "6px 10px", fontSize: "12px" }}
                                >
                                  <Check size={11} strokeWidth={2.5} /> Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              className="text-[13px] leading-relaxed mt-1 whitespace-pre-wrap break-words"
                              style={{ color: "#E4E4E7" }}
                            >
                              {note.text}
                            </div>
                          )}
                        </div>

                        {isMine && !isEditing && (
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            {onToggleNoteClientVisible && (
                              <button
                                onClick={() => onToggleNoteClientVisible(note.id)}
                                className="p-1.5 rounded transition-colors"
                                style={{
                                  background: note.clientVisible ? "#108CE91A" : "transparent",
                                  color: note.clientVisible ? "#7EC2F4" : "#979393",
                                  border: "none",
                                  cursor: "pointer",
                                }}
                                onMouseEnter={(e) => {
                                  if (!note.clientVisible) {
                                    e.currentTarget.style.background = "#36363A";
                                    e.currentTarget.style.color = "#E4E4E7";
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!note.clientVisible) {
                                    e.currentTarget.style.background = "transparent";
                                    e.currentTarget.style.color = "#979393";
                                  }
                                }}
                                title={
                                  note.clientVisible
                                    ? "Visible to client — click to hide"
                                    : "Hidden from client — click to share"
                                }
                              >
                                {note.clientVisible ? (
                                  <ExternalLink size={11} />
                                ) : (
                                  <Lock size={11} />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => startEditing(note)}
                              className="p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100"
                              style={{
                                background: "transparent",
                                color: "#979393",
                                border: "none",
                                cursor: "pointer",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "#36363A";
                                e.currentTarget.style.color = "#E4E4E7";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                                e.currentTarget.style.color = "#979393";
                              }}
                              title="Edit"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm("Delete this note?")) onDeleteNote(note.id);
                              }}
                              className="p-1.5 rounded transition-colors opacity-0 group-hover:opacity-100"
                              style={{
                                background: "transparent",
                                color: "#979393",
                                border: "none",
                                cursor: "pointer",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "#36363A";
                                e.currentTarget.style.color = "#F87171";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                                e.currentTarget.style.color = "#979393";
                              }}
                              title="Delete"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="text-center py-6 rounded-lg text-[13px]"
                style={{ background: "#2C2C2F", border: "1px dashed #36363A", color: "#979393" }}
              >
                No notes yet — add the first one above.
              </div>
            )}
          </section>

          {isCurrent && !stage.completed && (
            <div
              className="panel-card p-5 flex items-center gap-4 flex-wrap"
              style={{ background: stage.color + "0F", borderColor: stage.color + "44" }}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: stage.color + "22", color: stage.color }}
              >
                <CheckCircle2 size={18} />
              </div>
              <div className="flex-1 min-w-[220px]">
                <div className="text-[14px] font-semibold">
                  {stage.tasks.length === 0
                    ? `Add tasks to ${stage.name} to get started`
                    : completedTasks === stage.tasks.length
                      ? `${stage.name} is complete — advancing to the next stage…`
                      : `${stage.tasks.length - completedTasks} task${
                          stage.tasks.length - completedTasks === 1 ? "" : "s"
                        } remaining`}
                </div>
                <div className="text-[13px] text-zinc-500">
                  Stages advance automatically when all their tasks are checked off.
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
