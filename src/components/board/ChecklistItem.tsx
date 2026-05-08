"use client";

import { useEffect, useState } from "react";
import {
  Calendar,
  Check,
  ExternalLink,
  FileText,
  GripVertical,
  Lock,
  Trash2,
} from "lucide-react";
import { formatDeadline } from "@/lib/format";
import { DeadlinePill } from "./DeadlinePill";
import type { Task } from "@/types/stages";

type Props = {
  task: Task;
  stageColor: string;
  expanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onExpand: () => void;
  onSetNote: (note: string) => void;
  onSetDeadline: ((deadline: number | null) => void) | null;
  onToggleClientVisible: (() => void) | null;
  /** Phase 2 addition — inline rename of the task text. Owners + admins only. */
  onEditText: ((text: string) => void) | null;
  canEdit?: boolean;
  // drag props
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOverItem?: () => void;
  onDropItem?: () => void;
};

export function ChecklistItem({
  task,
  stageColor,
  expanded,
  onToggle,
  onRemove,
  onExpand,
  onSetNote,
  onSetDeadline,
  onToggleClientVisible,
  onEditText,
  canEdit = true,
  draggable = false,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragEnd,
  onDragOverItem,
  onDropItem,
}: Props) {
  const [noteDraft, setNoteDraft] = useState(task.note || "");
  const [noteSaved, setNoteSaved] = useState(false);
  const [grabbing, setGrabbing] = useState(false);

  // Inline task-name editing (Phase 2 addition).
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(task.text);

  const hasNote = (task.note || "").trim().length > 0;
  const canEditName = canEdit && !!onEditText;

  useEffect(() => {
    setNoteDraft(task.note || "");
    setNoteSaved(false);
  }, [task.id, task.note]);

  useEffect(() => {
    if (!editingName) setNameDraft(task.text);
  }, [task.text, editingName]);

  const isNoteDirty = noteDraft !== (task.note || "");

  const saveNote = () => {
    onSetNote(noteDraft);
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1500);
  };

  const startEditName = () => {
    if (!canEditName) return;
    setNameDraft(task.text);
    setEditingName(true);
  };
  const commitNameEdit = () => {
    if (!canEditName) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== task.text) onEditText!(trimmed);
    setEditingName(false);
  };
  const cancelNameEdit = () => {
    setNameDraft(task.text);
    setEditingName(false);
  };

  // Drag-and-drop handlers — only active when grabbing the handle.
  const handleNativeDragStart = (e: React.DragEvent) => {
    if (!grabbing || !draggable) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);
    onDragStart?.();
  };
  const handleNativeDragEnd = () => {
    setGrabbing(false);
    onDragEnd?.();
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!draggable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onDragOverItem?.();
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!draggable) return;
    e.preventDefault();
    onDropItem?.();
  };

  return (
    <div
      draggable={draggable && grabbing}
      onDragStart={handleNativeDragStart}
      onDragEnd={handleNativeDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="stage-node transition-all relative"
      style={{
        borderColor: isDragOver
          ? "#108CE9"
          : task.done
            ? stageColor + "55"
            : "#36363A",
        background: task.done ? stageColor + "0A" : "#2C2C2F",
        opacity: isDragging ? 0.4 : 1,
        boxShadow: isDragOver ? "0 0 0 2px #108CE933" : "none",
      }}
    >
      {isDragOver && (
        <div
          className="absolute left-0 right-0 -top-1 pointer-events-none"
          style={{ height: "2px", background: "#108CE9", borderRadius: "1px" }}
        />
      )}
      <div className="flex items-start gap-2 p-3 group">
        {draggable && (
          <button
            onMouseDown={() => setGrabbing(true)}
            onMouseUp={() => setGrabbing(false)}
            onMouseLeave={() => setGrabbing(false)}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0 mt-1"
            style={{
              background: "transparent",
              border: "none",
              cursor: grabbing ? "grabbing" : "grab",
              color: "#979393",
              padding: "2px",
              marginLeft: "-4px",
            }}
            title="Drag to reorder"
          >
            <GripVertical size={14} />
          </button>
        )}
        <button
          onClick={onToggle}
          className={`check-box mt-0.5 ${task.done ? "checked" : ""}`}
        >
          {task.done && <Check size={11} strokeWidth={3} color="white" />}
        </button>
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitNameEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitNameEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelNameEdit();
                }
              }}
              className={`stage-name-input text-[14px] leading-relaxed ${
                task.done ? "line-through text-zinc-500" : "text-zinc-200"
              }`}
            />
          ) : (
            <div
              className={`text-[14px] leading-relaxed cursor-pointer ${
                task.done ? "line-through text-zinc-500" : "text-zinc-200"
              }`}
              onClick={canEditName ? startEditName : onExpand}
              title={canEditName ? "Click to edit" : ""}
            >
              {task.text}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {(task.deadline || canEdit) && !task.done && onSetDeadline && (
              <DeadlinePill
                deadline={task.deadline}
                onChange={onSetDeadline}
                canEdit={canEdit}
                size="sm"
                emptyLabel="Add deadline"
              />
            )}
            {task.done && task.deadline && (
              <span
                className="inline-flex items-center gap-1 rounded-full text-[11px] px-2 py-0.5"
                style={{
                  background: "#36363A",
                  color: "#71717A",
                  border: "1px solid #4A4A50",
                }}
              >
                <Calendar size={10} /> {formatDeadline(task.deadline, { short: true })}
              </span>
            )}
            {canEdit && onToggleClientVisible && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleClientVisible();
                }}
                className="inline-flex items-center gap-1 rounded-full transition-colors"
                style={{
                  background: task.clientVisible ? "#108CE91A" : "transparent",
                  border: `1px solid ${task.clientVisible ? "#108CE966" : "#36363A"}`,
                  color: task.clientVisible ? "#7EC2F4" : "#71717A",
                  padding: "3px 8px",
                  fontSize: "11px",
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                title={
                  task.clientVisible
                    ? "Visible to client — click to hide"
                    : "Hidden from client — click to share"
                }
              >
                {task.clientVisible ? <ExternalLink size={10} /> : <Lock size={10} />}
                <span>{task.clientVisible ? "Client" : "Internal"}</span>
              </button>
            )}
            {hasNote && !expanded && (
              <div
                className="text-[12px] text-zinc-500 line-clamp-1 cursor-pointer flex items-center gap-1"
                onClick={onExpand}
              >
                <FileText size={10} />
                <span className="truncate max-w-[220px]">{task.note}</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onExpand}
            className="opacity-60 hover:opacity-100 transition-opacity p-1.5 rounded"
            title={expanded ? "Hide note" : hasNote ? "View note" : "Add note"}
          >
            <FileText
              size={13}
              className={hasNote ? "" : "text-zinc-500"}
              style={hasNote ? { color: "#3BA5EE" } : undefined}
            />
          </button>
          {canEdit && (
            <button
              onClick={onRemove}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded text-zinc-500 hover:text-rose-400"
              title="Remove task"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          className="border-t border-zinc-800 p-3 fade-in"
          style={{ background: "#1A1A1C" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] text-zinc-400 flex items-center gap-1.5">
              <FileText size={12} /> Note for this item
            </div>
            {noteSaved && (
              <span className="text-[11px] text-emerald-400 flex items-center gap-1 fade-in">
                <Check size={10} strokeWidth={3} /> Saved
              </span>
            )}
          </div>
          <textarea
            autoFocus={!hasNote}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (isNoteDirty) saveNote();
              }
            }}
            placeholder="Quick note for this checklist item…"
            className="field min-h-[80px] resize-y leading-relaxed mb-2"
            style={{ fontSize: "13px" }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-zinc-500">
              {isNoteDirty ? "Unsaved" : hasNote ? "Saved" : "No note yet"}
            </div>
            <div className="flex items-center gap-1.5">
              {hasNote && (
                <button
                  onClick={() => {
                    setNoteDraft("");
                    onSetNote("");
                  }}
                  className="btn-ghost"
                  style={{ padding: "6px 10px", fontSize: "12px" }}
                >
                  <Trash2 size={11} /> Clear
                </button>
              )}
              <button
                onClick={saveNote}
                disabled={!isNoteDirty}
                className="btn-primary"
                style={{ padding: "6px 12px", fontSize: "12px" }}
              >
                <Check size={11} strokeWidth={2.5} /> Save note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
