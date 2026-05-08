"use client";

import { useState } from "react";
import {
  AlertCircle,
  Calendar,
  Check,
  FileText,
  LogOut,
  MessageCircle,
  Target,
} from "lucide-react";
import { StagesLogo } from "@/components/icons/StagesLogo";
import { Avatar } from "@/components/Avatar";
import { ClientPortalChat } from "./ClientPortalChat";
import { ClientPortalFiles } from "./ClientPortalFiles";
import { formatDeadline, getDeadlineColors, getDeadlineStatus, timeAgo } from "@/lib/format";
import type { Client, ClientSession, StageNote } from "@/types/stages";

type Props = {
  pipeline: Client;
  clientSession: ClientSession;
  onLogout: () => void;
  onSendChannelMessage: (channelId: string, text: string, mentions: string[]) => void;
  onToggleTask: (stageId: string, taskId: string) => void;
};

type PortalTab = "project" | "chat" | "files";

function normalizeNotes(notes: unknown): StageNote[] {
  if (!notes) return [];
  if (Array.isArray(notes)) return notes as StageNote[];
  return [];
}

export function ClientPortal({
  pipeline,
  clientSession,
  onLogout,
  onSendChannelMessage,
  onToggleTask,
}: Props) {
  const visibleStages = pipeline.stages.filter((s) => s.clientVisible);
  const currentStageIdx = pipeline.stages.findIndex((s) => s.id === pipeline.currentStage);
  const totalStages = pipeline.stages.length;
  const completedStages = pipeline.stages.filter((s) => s.completed).length;
  const overallProgress = totalStages > 0 ? (completedStages / totalStages) * 100 : 0;
  const isSubmitted = !!pipeline.submittedAt;

  const [portalTab, setPortalTab] = useState<PortalTab>("project");

  const allChannels = pipeline.channels || [];
  const myChannels = allChannels.filter((ch) =>
    (ch.memberEmails || []).includes(clientSession.email),
  );

  const currentStage = pipeline.stages[currentStageIdx];
  const currentStageId = currentStage?.id;
  const actionItems = currentStage
    ? currentStage.tasks.filter((t) => t.clientVisible && !t.done)
    : [];

  const status = isSubmitted
    ? { label: "Project complete", color: "#15B981", icon: "🎉" }
    : actionItems.length > 0
      ? { label: "Waiting on you", color: "#F59E0B", icon: "⏳" }
      : { label: "We're working on it", color: "#108CE9", icon: "🛠️" };

  const showChatTab = myChannels.length > 0;

  return (
    <div className="min-h-screen" style={{ background: "#212124", color: "#E4E4E7" }}>
      <header
        className="flex items-center justify-between"
        style={{
          background: "#121212",
          borderBottom: "1px solid #36363A",
          padding: "12px 20px",
          height: "64px",
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <StagesLogo size={28} />
          <div className="hidden sm:block">
            <div className="text-[12px]" style={{ color: "#979393" }}>
              Project portal
            </div>
            <div className="text-[14px] font-semibold leading-tight truncate">
              {pipeline.emoji || "📋"} {pipeline.name}
            </div>
          </div>
        </div>

        <div
          className="hidden md:flex items-center gap-1"
          style={{
            background: "#1A1A1C",
            border: "1px solid #36363A",
            borderRadius: "10px",
            padding: "3px",
          }}
        >
          <PortalTabBtn
            label="Project"
            icon={<Target size={13} strokeWidth={2.5} />}
            active={portalTab === "project"}
            onClick={() => setPortalTab("project")}
          />
          {showChatTab && (
            <PortalTabBtn
              label="Chat"
              icon={<MessageCircle size={13} strokeWidth={2.5} />}
              active={portalTab === "chat"}
              onClick={() => setPortalTab("chat")}
              badge={myChannels.length}
            />
          )}
          <PortalTabBtn
            label="Files"
            icon={<FileText size={13} strokeWidth={2.5} />}
            active={portalTab === "files"}
            onClick={() => setPortalTab("files")}
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="text-[12px] hidden md:block" style={{ color: "#979393" }}>
            {clientSession.email}
          </div>
          <button
            onClick={onLogout}
            className="btn-ghost"
            style={{ padding: "6px 12px", fontSize: "12px" }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </header>

      {portalTab === "chat" && showChatTab ? (
        <ClientPortalChat
          channels={myChannels}
          clientSession={clientSession}
          onSendChannelMessage={onSendChannelMessage}
        />
      ) : portalTab === "files" ? (
        <ClientPortalFiles pipeline={pipeline} />
      ) : (
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <section className="mb-8">
            <div
              className="text-[12px] uppercase tracking-wider mb-2"
              style={{ color: "#979393" }}
            >
              Welcome back
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold leading-tight mb-1">
              {pipeline.emoji || "📋"} {pipeline.name}
            </h1>
            {pipeline.company && (
              <div className="text-[14px] mb-5" style={{ color: "#979393" }}>
                {pipeline.company}
              </div>
            )}

            <div
              className="inline-flex items-center gap-2 mb-6"
              style={{
                background: status.color + "1A",
                border: `1px solid ${status.color}44`,
                borderRadius: "999px",
                padding: "8px 14px",
              }}
            >
              <span style={{ fontSize: "16px" }}>{status.icon}</span>
              <span
                className="text-[14px] font-semibold"
                style={{ color: status.color }}
              >
                {status.label}
              </span>
            </div>

            <div
              className="rounded-xl p-5"
              style={{ background: "#2C2C2F", border: "1px solid #36363A" }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-semibold">Project progress</div>
                <div className="text-[13px]" style={{ color: "#979393" }}>
                  {completedStages} of {totalStages} stages complete
                </div>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: "#36363A" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${overallProgress}%`,
                    background: "linear-gradient(90deg, #108CE9, #15B981)",
                  }}
                />
              </div>
            </div>
          </section>

          {actionItems.length > 0 && (
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle size={18} style={{ color: "#F59E0B" }} />
                <h2 className="text-[16px] font-semibold">Action required from you</h2>
                <span
                  className="text-[11px] px-2 py-0.5 rounded-full"
                  style={{
                    background: "#F59E0B22",
                    color: "#FBBF24",
                    border: "1px solid #F59E0B44",
                  }}
                >
                  {actionItems.length}
                </span>
              </div>
              <div className="space-y-2">
                {actionItems.map((task) => {
                  const dColors = getDeadlineColors(getDeadlineStatus(task.deadline));
                  return (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 rounded-lg p-3"
                      style={{
                        background: "#2C2C2F",
                        border: "1px solid #F59E0B33",
                      }}
                    >
                      <button
                        onClick={() => currentStageId && onToggleTask(currentStageId, task.id)}
                        className="w-5 h-5 rounded flex-shrink-0 mt-0.5 flex items-center justify-center transition-colors"
                        style={{
                          background: "#36363A",
                          border: "1.5px solid #4A4A50",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "#15B981";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "#4A4A50";
                        }}
                        title="Mark as done"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] leading-relaxed">{task.text}</div>
                        {task.deadline && (
                          <div className="mt-1.5">
                            <span
                              className="inline-flex items-center gap-1 rounded-full text-[11px]"
                              style={{
                                background: dColors.bg,
                                border: `1px solid ${dColors.border}`,
                                color: dColors.text,
                                padding: "2px 8px",
                                fontWeight: 500,
                              }}
                            >
                              <Calendar size={10} /> Due{" "}
                              {formatDeadline(task.deadline, { short: true })}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mb-8">
            <h2 className="text-[16px] font-semibold mb-4">Project journey</h2>
            {visibleStages.length === 0 ? (
              <div
                className="text-center py-12 rounded-lg text-[13px]"
                style={{
                  background: "#2C2C2F",
                  border: "1px dashed #36363A",
                  color: "#979393",
                }}
              >
                The agency hasn&apos;t shared any stages yet. Check back soon — they&apos;ll appear
                here as the project moves forward.
              </div>
            ) : (
              <div className="space-y-3">
                {visibleStages.map((stage, idx) => {
                  const isCurrent = stage.id === pipeline.currentStage;
                  const isComplete = stage.completed;
                  const visibleTasks = stage.tasks.filter((t) => t.clientVisible);
                  const visibleNotes = normalizeNotes(stage.notes).filter(
                    (n) => n.clientVisible,
                  );
                  const dColors = getDeadlineColors(getDeadlineStatus(stage.deadline));
                  return (
                    <div
                      key={stage.id}
                      className="rounded-xl overflow-hidden"
                      style={{
                        background: "#2C2C2F",
                        border: `1px solid ${isCurrent ? stage.color + "66" : "#36363A"}`,
                        boxShadow: isCurrent ? `0 0 0 3px ${stage.color}1A` : "none",
                      }}
                    >
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 font-semibold text-[13px]"
                            style={{
                              background: isComplete
                                ? stage.color
                                : isCurrent
                                  ? stage.color + "22"
                                  : "#212124",
                              color: isComplete ? "white" : isCurrent ? stage.color : "#979393",
                              border: `1px solid ${
                                isComplete || isCurrent ? stage.color + "66" : "#36363A"
                              }`,
                            }}
                          >
                            {isComplete ? <Check size={16} strokeWidth={3} /> : idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-[15px] font-semibold">{stage.name}</h3>
                              {isComplete && (
                                <span
                                  className="badge"
                                  style={{
                                    background: "#15B98122",
                                    color: "#34D399",
                                    borderColor: "#15B98144",
                                    padding: "2px 8px",
                                    fontSize: "10px",
                                  }}
                                >
                                  Complete
                                </span>
                              )}
                              {isCurrent && !isComplete && (
                                <span
                                  className="badge"
                                  style={{
                                    background: "#15B98122",
                                    color: "#34D399",
                                    borderColor: "#15B98144",
                                    padding: "2px 8px",
                                    fontSize: "10px",
                                  }}
                                >
                                  In progress
                                </span>
                              )}
                            </div>
                            {stage.description && (
                              <div
                                className="text-[13px] mt-1.5 leading-relaxed"
                                style={{ color: "#979393" }}
                              >
                                {stage.description}
                              </div>
                            )}
                            {stage.deadline && !isComplete && (
                              <div className="mt-2">
                                <span
                                  className="inline-flex items-center gap-1 rounded-full text-[11px]"
                                  style={{
                                    background: dColors.bg,
                                    border: `1px solid ${dColors.border}`,
                                    color: dColors.text,
                                    padding: "2px 8px",
                                    fontWeight: 500,
                                  }}
                                >
                                  <Calendar size={10} /> Due{" "}
                                  {formatDeadline(stage.deadline, { short: true })}
                                </span>
                              </div>
                            )}
                            {isComplete && stage.completedAt && (
                              <div
                                className="text-[12px] mt-2"
                                style={{ color: "#979393" }}
                              >
                                Completed {timeAgo(stage.completedAt)}
                              </div>
                            )}
                          </div>
                        </div>

                        {visibleTasks.length > 0 && (
                          <div className="mt-3 ml-12 space-y-1.5">
                            {visibleTasks.map((task) => (
                              <div key={task.id} className="flex items-center gap-2">
                                <button
                                  onClick={() => onToggleTask(stage.id, task.id)}
                                  className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                                  style={{
                                    background: task.done ? stage.color : "transparent",
                                    border: `1.5px solid ${
                                      task.done ? stage.color : "#4A4A50"
                                    }`,
                                    cursor: "pointer",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!task.done) e.currentTarget.style.borderColor = stage.color;
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!task.done) e.currentTarget.style.borderColor = "#4A4A50";
                                  }}
                                  title={task.done ? "Mark as not done" : "Mark as done"}
                                >
                                  {task.done && (
                                    <Check size={10} strokeWidth={3} color="white" />
                                  )}
                                </button>
                                <span
                                  className={`text-[13px] ${task.done ? "line-through" : ""}`}
                                  style={{ color: task.done ? "#71717A" : "#E4E4E7" }}
                                >
                                  {task.text}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {visibleNotes.length > 0 && (
                          <div className="mt-3 ml-12 space-y-2">
                            {visibleNotes.map((note) => (
                              <div
                                key={note.id}
                                className="rounded-lg p-3"
                                style={{
                                  background: "#1A1A1C",
                                  border: "1px solid #36363A",
                                }}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <Avatar email={note.author} size={5} />
                                  <span className="text-[12px] font-semibold">
                                    {note.author}
                                  </span>
                                  <span
                                    className="text-[11px]"
                                    style={{ color: "#979393" }}
                                  >
                                    {timeAgo(note.ts)}
                                  </span>
                                </div>
                                <div
                                  className="text-[13px] leading-relaxed whitespace-pre-wrap break-words"
                                  style={{ color: "#E4E4E7" }}
                                >
                                  {note.text}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="text-center pt-8 pb-4">
            <div className="flex justify-center mb-2 opacity-50">
              <StagesLogo size={20} />
            </div>
            <div className="text-[11px]" style={{ color: "#71717A" }}>
              Powered by Stages
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

function PortalTabBtn({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 transition-colors"
      style={{
        background: active ? "#108CE9" : "transparent",
        color: active ? "#FFFFFF" : "#979393",
        padding: "6px 14px",
        borderRadius: "7px",
        fontSize: "13px",
        fontWeight: 600,
        border: "none",
        cursor: "pointer",
      }}
    >
      {icon} {label}
      {badge != null && badge > 0 && (
        <span
          className="rounded-full text-[10px] font-bold flex items-center justify-center"
          style={{
            background: active ? "rgba(255,255,255,0.25)" : "#CE6A6C",
            color: "white",
            minWidth: "18px",
            height: "16px",
            padding: "0 5px",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
