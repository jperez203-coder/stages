"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Calendar, Check, ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { COL_GAP, COL_WIDTH, HEADER_Y, colX } from "@/lib/constants";
import { formatDeadline, getDeadlineColors, getDeadlineStatus } from "@/lib/format";
import type { Client, TaskPosition } from "@/types/stages";

type DragState = {
  stageId: string;
  taskId: string;
  offsetX: number;
  offsetY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
};

type Props = {
  client: Client;
  editMode: boolean;
  zoom?: number;
  onOpenStage: (stageId: string) => void;
  onMoveToStage: (stageId: string) => void;
  onUpdateTaskPos: (stageId: string, taskId: string, pos: TaskPosition) => void;
  onRenameStage: (stageId: string, name: string) => void;
  onAddStage: () => void;
  onRemoveStage: (stageId: string) => void;
  onReorderStage: (stageId: string, delta: number) => void;
};

export function Canvas({
  client,
  editMode,
  zoom = 1,
  onOpenStage,
  onMoveToStage,
  onUpdateTaskPos,
  onRenameStage,
  onAddStage,
  onRemoveStage,
  onReorderStage,
}: Props) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  const defaultPos = (stageIndex: number, taskIndex: number): TaskPosition => ({
    x: colX(stageIndex) + 30,
    y: 280 + taskIndex * 62,
  });
  const getTaskPos = (stageIndex: number, taskIndex: number, task: { pos: TaskPosition | null }) =>
    task.pos && typeof task.pos.x === "number" ? task.pos : defaultPos(stageIndex, taskIndex);

  const allPositions = client.stages.flatMap((s, i) =>
    s.tasks.map((t, ti) => getTaskPos(i, ti, t)),
  );
  const maxX = Math.max(
    colX(client.stages.length - 1) + COL_WIDTH + 60,
    ...allPositions.map((p) => p.x + COL_WIDTH),
  );
  const maxY = Math.max(700, ...allPositions.map((p) => p.y + 100));

  const screenToCanvas = (e: PointerEvent | React.PointerEvent) => {
    const inner = canvasRef.current;
    if (!inner) return { x: 0, y: 0 };
    const rect = inner.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
  };

  const onPointerDown = (
    e: React.PointerEvent,
    stageId: string,
    taskId: string,
    currentX: number,
    currentY: number,
  ) => {
    if (editMode) return;
    e.preventDefault();
    e.stopPropagation();
    const { x: px, y: py } = screenToCanvas(e);
    setDrag({
      stageId,
      taskId,
      offsetX: px - currentX,
      offsetY: py - currentY,
      currentX,
      currentY,
      moved: false,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const { x: px, y: py } = screenToCanvas(e);
      setDrag((d) =>
        d
          ? {
              ...d,
              currentX: Math.max(0, px - d.offsetX),
              currentY: Math.max(0, py - d.offsetY),
              moved: true,
            }
          : null,
      );
    };
    const onUp = () =>
      setDrag((d) => {
        if (d?.moved) onUpdateTaskPos(d.stageId, d.taskId, { x: d.currentX, y: d.currentY });
        return null;
      });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, onUpdateTaskPos, zoom]);

  return (
    <div
      style={{
        width: maxX * zoom,
        minWidth: "100%",
        height: maxY * zoom,
        minHeight: "calc(100vh - 60px)",
        position: "relative",
      }}
    >
      <div
        ref={canvasRef}
        className="relative"
        style={{
          width: maxX,
          height: maxY,
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <svg className="absolute inset-0 pointer-events-none" width={maxX} height={maxY}>
          {client.stages.map((stage, i) => {
            const x = colX(i);
            const headerCenterX = x + COL_WIDTH / 2;
            const headerBottomY = HEADER_Y + 50;
            const elements: React.ReactNode[] = [];

            stage.tasks.forEach((task, ti) => {
              const isDragging = drag && drag.stageId === stage.id && drag.taskId === task.id;
              const taskPos = isDragging
                ? { x: drag!.currentX, y: drag!.currentY }
                : getTaskPos(i, ti, task);
              const taskCenterY = taskPos.y + 24;
              const sx = headerCenterX;
              const sy = headerBottomY;
              const ex = taskPos.x;
              const ey = taskCenterY;
              const midX = (sx + ex) / 2;
              const path = `M ${sx} ${sy} C ${sx} ${(sy + ey) / 2}, ${midX} ${ey}, ${ex} ${ey}`;
              elements.push(
                <g key={`hline-${stage.id}-${task.id}`}>
                  <path
                    d={path}
                    fill="none"
                    stroke={task.done ? stage.color : "#4A4A50"}
                    strokeWidth="1.5"
                    opacity={isDragging ? 0.6 : 1}
                  />
                  <circle cx={sx} cy={sy} r="3" fill={task.done ? stage.color : "#4A4A50"} />
                  <circle cx={ex} cy={ey} r="3" fill={task.done ? stage.color : "#4A4A50"} />
                </g>,
              );
            });

            if (i < client.stages.length - 1) {
              const nextStage = client.stages[i + 1];
              const isCT = stage.id === client.currentStage;
              const circleR = 16;
              const startCircleCenterX = x + circleR;
              const endCircleCenterX = colX(i + 1) + circleR;
              const circleCenterY = HEADER_Y + circleR;
              const sx = startCircleCenterX + circleR + 4;
              const ex = endCircleCenterX - circleR - 4;
              const sy = circleCenterY;
              const ey = circleCenterY;
              const path = `M ${sx} ${sy} L ${ex} ${ey}`;

              let connectorColor: string;
              let connectorDash: string;
              let connectorWidth: number;
              let gradientStops: { from: string; to: string } | null = null;
              if (stage.completed && nextStage.completed) {
                connectorColor = stage.color;
                connectorDash = "0";
                connectorWidth = 2;
              } else if (stage.completed && nextStage.id === client.currentStage) {
                connectorDash = "0";
                connectorWidth = 2;
                gradientStops = { from: stage.color, to: nextStage.color };
                connectorColor = `url(#grad-${stage.id})`;
              } else if (isCT) {
                connectorColor = stage.color;
                connectorDash = "6 5";
                connectorWidth = 2;
              } else if (stage.completed) {
                connectorColor = stage.color;
                connectorDash = "6 5";
                connectorWidth = 1.5;
              } else {
                connectorColor = "#36363A";
                connectorDash = "6 5";
                connectorWidth = 1.5;
              }

              elements.push(
                <g key={`connector-${stage.id}`}>
                  {gradientStops && (
                    <defs>
                      <linearGradient
                        id={`grad-${stage.id}`}
                        x1={sx}
                        y1={sy}
                        x2={ex}
                        y2={ey}
                        gradientUnits="userSpaceOnUse"
                      >
                        <stop offset="0%" stopColor={gradientStops.from} />
                        <stop offset="100%" stopColor={gradientStops.to} />
                      </linearGradient>
                    </defs>
                  )}
                  <path
                    d={path}
                    fill="none"
                    stroke={connectorColor}
                    strokeWidth={connectorWidth}
                    strokeDasharray={connectorDash}
                    strokeLinecap="round"
                  />
                  <circle
                    cx={sx}
                    cy={sy}
                    r="3"
                    fill={stage.completed || isCT ? stage.color : "#4A4A50"}
                  />
                  <circle
                    cx={ex}
                    cy={ey}
                    r="3"
                    fill={
                      nextStage.completed || nextStage.id === client.currentStage
                        ? nextStage.color
                        : "#4A4A50"
                    }
                  />
                </g>,
              );
            }
            return elements;
          })}
        </svg>

        {/* Stage headers */}
        {client.stages.map((stage, i) => {
          const x = colX(i);
          const isCurrent = stage.id === client.currentStage;
          const isCompleted = stage.completed;
          const isEditing = editingStageId === stage.id;
          return (
            <div
              key={`header-${stage.id}`}
              style={{ position: "absolute", left: x, top: HEADER_Y, width: COL_WIDTH }}
            >
              <div className="flex justify-between items-center mb-2">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold relative"
                  style={{
                    background: isCompleted || isCurrent ? stage.color : "#2C2C2F",
                    color: isCompleted || isCurrent ? "white" : "#A1A1AA",
                    border: `1px solid ${isCompleted || isCurrent ? stage.color : "#36363A"}`,
                  }}
                >
                  {isCompleted ? <Check size={14} strokeWidth={3} /> : i + 1}
                  {isCurrent && (
                    <span
                      className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
                      style={{ background: "#F43F5E", border: "2px solid #212124" }}
                    />
                  )}
                </div>

                {editMode && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onReorderStage(stage.id, -1)}
                      disabled={i === 0}
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      title="Move left"
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <button
                      onClick={() => onReorderStage(stage.id, 1)}
                      disabled={i === client.stages.length - 1}
                      className="icon-btn"
                      style={{ width: 28, height: 28 }}
                      title="Move right"
                    >
                      <ChevronLeft size={12} style={{ transform: "rotate(180deg)" }} />
                    </button>
                    {client.stages.length > 1 && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${stage.name}" and all its tasks?`))
                            onRemoveStage(stage.id);
                        }}
                        className="icon-btn"
                        style={{ width: 28, height: 28, color: "#F87171" }}
                        title="Delete stage"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div
                className="stage-node w-full px-4 py-3 text-left"
                style={{
                  borderColor: isCurrent ? stage.color : "#36363A",
                  borderWidth: isCurrent ? "1.5px" : "1px",
                  boxShadow: isCurrent ? `0 0 0 3px ${stage.color}1A` : "none",
                }}
              >
                {editMode && isEditing ? (
                  <input
                    autoFocus
                    defaultValue={stage.name}
                    onBlur={(e) => {
                      onRenameStage(stage.id, e.target.value || stage.name);
                      setEditingStageId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingStageId(null);
                    }}
                    className="stage-name-input font-semibold text-sm"
                  />
                ) : (
                  <div
                    onClick={(e) => {
                      if (editMode) {
                        e.stopPropagation();
                        setEditingStageId(stage.id);
                      } else onOpenStage(stage.id);
                    }}
                    onDoubleClick={() => !editMode && onMoveToStage(stage.id)}
                    className="font-semibold text-sm cursor-pointer flex items-center gap-1.5"
                    title={editMode ? "Click to rename" : "Click to view · Double-click to jump"}
                  >
                    {stage.name}
                    {editMode && <Pencil size={11} className="text-zinc-500" />}
                  </div>
                )}
                <div className="text-[12px] text-zinc-500 mt-1 flex items-center gap-2 flex-wrap">
                  <span>
                    Stage {i + 1} · {stage.tasks.filter((t) => t.done).length}/{stage.tasks.length}{" "}
                    tasks
                  </span>
                  {stage.deadline && !stage.completed && (() => {
                    const status = getDeadlineStatus(stage.deadline);
                    const colors = getDeadlineColors(status);
                    return (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full flex-shrink-0"
                        style={{
                          background: colors.bg,
                          color: colors.text,
                          border: `1px solid ${colors.border}`,
                          padding: "2px 6px",
                          fontSize: "10px",
                          fontWeight: 600,
                          lineHeight: 1,
                        }}
                        title={`Due ${formatDeadline(stage.deadline)}`}
                      >
                        {status === "overdue" ? <AlertCircle size={9} /> : <Calendar size={9} />}
                        <span>
                          {formatDeadline(stage.deadline, { short: true }).replace(/, .*/, "")}
                        </span>
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}

        {editMode && (
          <button
            onClick={onAddStage}
            className="absolute flex flex-col items-center justify-center gap-2 stage-node"
            style={{
              left: colX(client.stages.length),
              top: HEADER_Y + 40,
              width: COL_WIDTH,
              height: 80,
              borderStyle: "dashed",
              borderColor: "#108CE9",
              background: "#108CE908",
              cursor: "pointer",
            }}
          >
            <Plus size={20} style={{ color: "#3BA5EE" }} />
            <span className="text-[12px] font-medium" style={{ color: "#3BA5EE" }}>
              Add stage
            </span>
          </button>
        )}

        {/* Task cards */}
        {client.stages.map((stage, i) =>
          stage.tasks.map((task, ti) => {
            const isDragging = drag && drag.stageId === stage.id && drag.taskId === task.id;
            const pos = isDragging
              ? { x: drag!.currentX, y: drag!.currentY }
              : getTaskPos(i, ti, task);
            return (
              <div
                key={task.id}
                className={`stage-node ${editMode ? "" : "draggable"} absolute px-3 flex items-center gap-2 ${
                  isDragging ? "dragging" : ""
                }`}
                style={{
                  left: pos.x,
                  top: pos.y,
                  width: COL_WIDTH - 30,
                  height: 48,
                  borderColor: task.done ? stage.color + "66" : "#36363A",
                  background: task.done ? stage.color + "1A" : "#2C2C2F",
                  cursor: editMode ? "pointer" : undefined,
                }}
                onPointerDown={(e) => onPointerDown(e, stage.id, task.id, pos.x, pos.y)}
                onClick={() => {
                  if (!drag || !drag.moved) onOpenStage(stage.id);
                }}
              >
                <div
                  className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                  style={{
                    background: task.done ? stage.color : "transparent",
                    border: `1.5px solid ${task.done ? stage.color : "#36363A"}`,
                  }}
                >
                  {task.done && <Check size={10} strokeWidth={3} color="white" />}
                </div>
                <span
                  className={`text-[12px] truncate flex-1 min-w-0 ${task.done ? "line-through" : ""}`}
                  style={{ color: task.done ? "#979393" : "#E4E4E7" }}
                >
                  {task.text}
                </span>
                {task.deadline && !task.done && (() => {
                  const status = getDeadlineStatus(task.deadline);
                  const colors = getDeadlineColors(status);
                  return (
                    <span
                      className="inline-flex items-center gap-0.5 rounded-full flex-shrink-0"
                      style={{
                        background: colors.bg,
                        color: colors.text,
                        border: `1px solid ${colors.border}`,
                        padding: "2px 5px",
                        fontSize: "10px",
                        fontWeight: 600,
                        lineHeight: 1,
                      }}
                      title={`Due ${formatDeadline(task.deadline)}`}
                    >
                      {status === "overdue" ? <AlertCircle size={9} /> : <Calendar size={9} />}
                      <span>
                        {formatDeadline(task.deadline, { short: true }).replace(/, .*/, "")}
                      </span>
                    </span>
                  );
                })()}
              </div>
            );
          }),
        )}
      </div>

      {editMode && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-20 panel-card px-4 py-3 flex items-center gap-3 text-[13px]"
          style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}
        >
          <Pencil size={14} style={{ color: "#3BA5EE" }} />
          <span className="text-zinc-300">
            Edit mode · click a stage name to rename, use arrows to reorder
          </span>
        </div>
      )}
    </div>
  );
}
