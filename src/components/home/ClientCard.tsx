"use client";

import { Building2, Lock, Trash2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { timeAgo } from "@/lib/format";
import type { Client } from "@/types/stages";

type Props = {
  client: Client;
  unreadTotal: number;
  onOpen: () => void;
  onDelete: () => void;
  canDelete: boolean;
  currentUserEmail: string;
};

export function ClientCard({
  client, unreadTotal, onOpen, onDelete, canDelete, currentUserEmail,
}: Props) {
  const currentStage = client.stages.find((s) => s.id === client.currentStage);
  const totalTasks = client.stages.reduce((a, s) => a + s.tasks.length, 0);
  const doneTasks = client.stages.reduce(
    (a, s) => a + s.tasks.filter((t) => t.done).length,
    0,
  );
  const taskProgress = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;
  const members = client.members || [];
  const isMember = members.some((m) => m.email === currentUserEmail);

  const visibleAvatars = members.slice(0, 4);
  const overflow = members.length - visibleAvatars.length;
  const emoji = client.emoji || "📋";

  return (
    <div
      onClick={onOpen}
      className="cursor-pointer relative group transition-colors"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        borderRadius: "12px",
        padding: "20px",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4A4A50")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#36363A")}
    >
      <div className="flex items-start gap-3 mb-5">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: "44px",
            height: "44px",
            background: "#212124",
            border: "1px solid #36363A",
            borderRadius: "10px",
            fontSize: "22px",
          }}
        >
          {emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[15px] truncate">{client.name}</div>
          {client.company && (
            <div
              className="flex items-center gap-1 mt-0.5 truncate text-[13px]"
              style={{ color: "#979393" }}
            >
              <Building2 size={11} className="flex-shrink-0" />
              <span className="truncate">{client.company}</span>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center">
          {members.length > 0 ? (
            <div className="flex -space-x-2">
              {visibleAvatars.map((m) => (
                <Avatar key={m.email} email={m.email} size={7} />
              ))}
              {overflow > 0 && (
                <div
                  className="rounded-full border-2 flex items-center justify-center font-semibold flex-shrink-0"
                  style={{
                    width: 28,
                    height: 28,
                    background: "#36363A",
                    color: "#E4E4E7",
                    borderColor: "#2C2C2F",
                    fontSize: 10,
                  }}
                  title={`+${overflow} more`}
                >
                  +{overflow}
                </div>
              )}
            </div>
          ) : isMember ? (
            <span
              className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
              style={{ background: "#36363A", color: "#979393" }}
            >
              <Lock size={10} /> Me
            </span>
          ) : null}
        </div>
      </div>

      <div className="mb-1">
        <div className="text-[12px] mb-1.5" style={{ color: "#979393" }}>
          Current stage
        </div>
        <div className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ background: currentStage?.color || "#979393" }}
          />
          <span className="text-[15px] font-semibold truncate">
            {currentStage?.name || "—"}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <div
          className="flex justify-between items-center text-[12px]"
          style={{ color: "#979393" }}
        >
          <span>Progress</span>
          <span>
            {doneTasks}/{totalTasks}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#949599" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${taskProgress}%`, background: "#15B981" }}
          />
        </div>
        <div
          className="flex items-center gap-2 pt-1 text-[12px]"
          style={{ color: "#979393" }}
        >
          <span>
            {doneTasks}/{totalTasks} task
          </span>
          <span>·</span>
          <span>{timeAgo(client.lastEdited || client.createdAt)}</span>
        </div>
      </div>

      {unreadTotal > 0 && (
        <div
          className="absolute top-3 right-3 min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center text-[10px] font-semibold pulse-dot"
          style={{ background: "#F43F5E", color: "white" }}
        >
          {unreadTotal > 9 ? "9+" : unreadTotal}
        </div>
      )}

      {canDelete && unreadTotal === 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete ${client.name}?`)) onDelete();
          }}
          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-zinc-800"
        >
          <Trash2 size={13} className="text-zinc-500" />
        </button>
      )}
    </div>
  );
}
