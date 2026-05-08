"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ExternalLink,
  Link2,
  Lock,
  Maximize2,
  MessageCircle,
  MousePointer2,
  Pencil,
  Sparkles,
  UserPlus,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { Canvas } from "./Canvas";
import { ToolBtn } from "./ToolBtn";
import { Confetti } from "./Confetti";
import { CelebrationBanner } from "./CelebrationBanner";
import { PipelineMoreMenu } from "./PipelineMoreMenu";
import { ActivityView } from "./ActivityView";
import { MembersView } from "./MembersView";
import { LinksView } from "./LinksView";
import { InviteClientModal } from "./InviteClientModal";
import { ChatView } from "@/components/chat/ChatView";
import { timeAgo } from "@/lib/format";
import type {
  Client,
  ClientInvite,
  Session,
  TaskPosition,
  TeamInvite,
} from "@/types/stages";

export type BoardTab = "canvas" | "thread" | "activity" | "links" | "members";

type Props = {
  client: Client;
  session: Session;
  boardTab: BoardTab;
  setBoardTab: (t: BoardTab) => void;
  unread: { thread: number; members: number; activity: number };
  onBack: () => void;
  onOpenStage: (stageId: string) => void;
  onMoveToStage: (stageId: string) => void;
  onSubmitPipeline: () => void;
  onUpdateTaskPos: (stageId: string, taskId: string, pos: TaskPosition) => void;
  onShowInvite: () => void;
  onShowSaveTemplate: () => void;
  // Stage edit
  onRenameStage: (stageId: string, name: string) => void;
  onAddStage: () => void;
  onRemoveStage: (stageId: string) => void;
  onReorderStage: (stageId: string, delta: number) => void;
  // Members
  onRemoveMember: (email: string) => void;
  onPromoteToAdmin: (email: string) => void;
  onDemoteToMember: (email: string) => void;
  onToggleAdminCanSubmit: (email: string) => void;
  onToggleMemberCanCheckTasks: (email: string) => void;
  pendingInvites: (TeamInvite & { token: string })[];
  // Celebration
  hasSeenCelebration: boolean;
  onMarkCelebrationSeen: () => void;
  // Chat
  clientPortalEmail: string | null;
  onCreateChannel: (name: string, members: string[], isClient: boolean) => string | null;
  onAddChannelMember: (channelId: string, email: string) => void;
  onRemoveChannelMember: (channelId: string, email: string) => void;
  onSendChannelMessage: (
    channelId: string,
    text: string,
    mentions: string[],
    internal: boolean,
  ) => void;
  // Links
  onAddLink: (label: string, url: string) => void;
  onAddImage: (label: string, dataUrl: string, fileName: string, fileSize: number) => void;
  onToggleLinkClientVisible: (linkId: string) => void;
  onRemoveLink: (linkId: string) => void;
  // Client portal invites (modal owned internally by ClientBoard, matching prototype)
  clientInvitesForPipeline: (ClientInvite & { token: string })[];
  onInviteClientToPipeline: (email: string) => { token: string; link: string } | null;
  onRevokeClientInvite: (token: string) => void;
};

export function ClientBoard({
  client,
  session,
  boardTab,
  setBoardTab,
  unread,
  onBack,
  onOpenStage,
  onMoveToStage,
  onSubmitPipeline,
  onUpdateTaskPos,
  onShowInvite,
  onShowSaveTemplate,
  onRenameStage,
  onAddStage,
  onRemoveStage,
  onReorderStage,
  onRemoveMember,
  onPromoteToAdmin,
  onDemoteToMember,
  onToggleAdminCanSubmit,
  onToggleMemberCanCheckTasks,
  pendingInvites,
  hasSeenCelebration,
  onMarkCelebrationSeen,
  clientPortalEmail,
  onCreateChannel,
  onAddChannelMember,
  onRemoveChannelMember,
  onSendChannelMessage,
  onAddLink,
  onAddImage,
  onToggleLinkClientVisible,
  onRemoveLink,
  clientInvitesForPipeline,
  onInviteClientToPipeline,
  onRevokeClientInvite,
}: Props) {
  const completedCount = client.stages.filter((s) => s.completed).length;
  const currentIdx = client.stages.findIndex((s) => s.id === client.currentStage);
  const isOnLastStage = currentIdx === client.stages.length - 1;
  const currentStage = client.stages[currentIdx];
  const allCurrentTasksDone =
    currentStage && currentStage.tasks.length > 0 && currentStage.tasks.every((t) => t.done);
  const isOwner = session.role === "owner" && client.ownerEmail === session.email;
  const myMember = (client.members || []).find((m) => m.email === session.email);
  const isAdmin = myMember?.role === "admin";
  const canSubmitFinal = isOwner || (isAdmin && !!myMember?.canSubmit);
  const isSubmitted = !!client.submittedAt;
  const canSubmit =
    isOnLastStage && (allCurrentTasksDone || currentStage?.completed) && !isSubmitted;

  const [editMode, setEditMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showCelebration, setShowCelebration] = useState(false);
  const [confettiActive, setConfettiActive] = useState(false);
  // Client portal invite modal — local to the board, matching the prototype.
  const [showClientInviteModal, setShowClientInviteModal] = useState(false);

  const ZOOM_MIN = 0.4;
  const ZOOM_MAX = 1.6;
  const ZOOM_STEP = 0.15;
  const handleZoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const handleZoomReset = () => setZoom(1);

  useEffect(() => {
    if (isSubmitted && !hasSeenCelebration) {
      setShowCelebration(true);
      setConfettiActive(true);
      onMarkCelebrationSeen();
      const t = setTimeout(() => setConfettiActive(false), 4500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSubmitted, hasSeenCelebration]);

  const handleSubmit = () => {
    if (!isOwner || !canSubmit) return;
    onSubmitPipeline();
    setShowCelebration(true);
    setConfettiActive(true);
    onMarkCelebrationSeen();
    setTimeout(() => setConfettiActive(false), 4500);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#212124" }}>
      <header
        className="border-b flex items-center sticky top-0 z-30"
        style={{
          background: "#121212",
          borderColor: "#36363A",
          paddingLeft: "16px",
          paddingRight: "16px",
          paddingTop: "12px",
          paddingBottom: "12px",
          gap: "12px",
          height: "64px",
        }}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
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

          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: "36px",
              height: "36px",
              background: "#2C2C2F",
              border: "1px solid #36363A",
              borderRadius: "8px",
              fontSize: "18px",
            }}
          >
            {client.emoji || "📋"}
          </div>

          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight truncate">{client.name}</div>
            <div className="text-[12px] mt-0.5 truncate" style={{ color: "#979393" }}>
              Last edited {timeAgo(client.lastEdited || client.createdAt)} · {completedCount}/
              {client.stages.length} completed
              {client.company && <> · {client.company}</>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {(client.members || []).length > 0 && (
            <div className="flex -space-x-2 mr-1">
              {(client.members || []).slice(0, 3).map((m) => (
                <Avatar key={m.email} email={m.email} size={7} />
              ))}
              {(client.members || []).length > 3 && (
                <div
                  className="rounded-full border-2 flex items-center justify-center font-semibold flex-shrink-0"
                  style={{
                    width: 28,
                    height: 28,
                    background: "#36363A",
                    color: "#E4E4E7",
                    borderColor: "#121212",
                    fontSize: 10,
                  }}
                >
                  +{(client.members || []).length - 3}
                </div>
              )}
            </div>
          )}

          {boardTab === "canvas" && isOwner && (
            <button
              onClick={() => setEditMode(!editMode)}
              className="flex items-center gap-2 transition-colors"
              style={{
                background: editMode ? "#108CE9" : "#2C2C2F",
                color: editMode ? "white" : "#E4E4E7",
                border: `1px solid ${editMode ? "#108CE9" : "#36363A"}`,
                borderRadius: "8px",
                padding: "0 14px",
                height: "36px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (!editMode) e.currentTarget.style.background = "#36363A";
              }}
              onMouseLeave={(e) => {
                if (!editMode) e.currentTarget.style.background = "#2C2C2F";
              }}
            >
              <Pencil size={13} />{" "}
              <span className="hidden sm:inline">{editMode ? "Done editing" : "Edit pipeline"}</span>
            </button>
          )}

          {isOwner && <PipelineMoreMenu onSaveAsTemplate={onShowSaveTemplate} />}

          {isSubmitted ? (
            <div
              className="flex items-center gap-2 flex-shrink-0"
              style={{
                background: "#15B98122",
                color: "#34D399",
                border: "1px solid #15B98144",
                borderRadius: "8px",
                padding: "0 14px",
                height: "36px",
                fontSize: "13px",
                fontWeight: 500,
              }}
              title={`Submitted by ${client.submittedBy} ${
                client.submittedAt ? timeAgo(client.submittedAt) : ""
              }`}
            >
              <CheckCircle2 size={14} strokeWidth={2.5} />{" "}
              <span className="hidden sm:inline">Submitted</span>
            </div>
          ) : canSubmit && canSubmitFinal ? (
            <button
              onClick={handleSubmit}
              className="flex items-center gap-2 transition-all flex-shrink-0 relative overflow-hidden"
              style={{
                background: "linear-gradient(135deg, #108CE9 0%, #8B5CF6 100%)",
                color: "white",
                border: "1px solid #3BA5EE",
                borderRadius: "8px",
                padding: "0 16px",
                height: "36px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 0 0 3px rgba(59,165,238,0.18)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 0 0 4px rgba(59,165,238,0.28)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(59,165,238,0.18)";
              }}
            >
              <Sparkles size={14} strokeWidth={2.5} />{" "}
              <span className="hidden sm:inline">Submit pipeline</span>
              <span className="sm:hidden">Submit</span>
            </button>
          ) : canSubmit && !canSubmitFinal ? (
            <div
              className="flex items-center gap-2 flex-shrink-0"
              style={{
                background: "#36363A",
                color: "#A1A1AA",
                border: "1px solid #4A4A50",
                borderRadius: "8px",
                padding: "0 14px",
                height: "36px",
                fontSize: "13px",
                fontWeight: 500,
              }}
              title="Only the owner (or an admin granted permission) can submit the final pipeline."
            >
              <Lock size={14} strokeWidth={2.5} />{" "}
              <span className="hidden sm:inline">Awaiting owner submit</span>
            </div>
          ) : null}
        </div>
      </header>

      {showCelebration && isSubmitted && (
        <CelebrationBanner client={client} onDismiss={() => setShowCelebration(false)} />
      )}

      {confettiActive && <Confetti />}

      <div className="flex-1 flex">
        <aside
          className="border-r flex flex-col items-center py-4 gap-1.5 flex-shrink-0"
          style={{ background: "#121212", borderColor: "#36363A", width: "56px" }}
        >
          <ToolBtn
            icon={<MousePointer2 size={15} />}
            label="Pipeline"
            active={boardTab === "canvas"}
            onClick={() => setBoardTab("canvas")}
          />
          <ToolBtn
            icon={<MessageCircle size={15} />}
            label="Chat"
            active={boardTab === "thread"}
            onClick={() => setBoardTab("thread")}
            dot={unread.thread > 0}
            count={unread.thread}
          />
          <ToolBtn
            icon={<Activity size={15} />}
            label="Activity"
            active={boardTab === "activity"}
            onClick={() => setBoardTab("activity")}
            dot={unread.activity > 0}
            count={unread.activity}
          />
          <ToolBtn
            icon={<Link2 size={15} />}
            label="Links"
            active={boardTab === "links"}
            onClick={() => setBoardTab("links")}
            count={(client.links || []).length}
          />
          <ToolBtn
            icon={<Users size={15} />}
            label="Members"
            active={boardTab === "members"}
            onClick={() => setBoardTab("members")}
            dot={unread.members > 0}
            count={(client.members || []).length}
          />
          {isOwner && (
            <>
              <div className="w-7 h-px my-1" style={{ background: "#36363A" }} />
              <ToolBtn icon={<UserPlus size={15} />} label="Invite team" onClick={onShowInvite} />
              <ToolBtn
                icon={<ExternalLink size={15} />}
                label="Invite client to portal"
                onClick={() => setShowClientInviteModal(true)}
                count={clientInvitesForPipeline.length}
              />
            </>
          )}
        </aside>

        <main className="flex-1 dotted-grid relative overflow-auto scrollbar-thin">
          {boardTab === "canvas" && (
            <Canvas
              client={client}
              editMode={editMode}
              zoom={zoom}
              onOpenStage={onOpenStage}
              onMoveToStage={onMoveToStage}
              onUpdateTaskPos={onUpdateTaskPos}
              onRenameStage={onRenameStage}
              onAddStage={onAddStage}
              onRemoveStage={onRemoveStage}
              onReorderStage={onReorderStage}
            />
          )}
          {boardTab === "thread" && (
            <ChatView
              client={client}
              session={session}
              clientPortalEmail={clientPortalEmail}
              onCreateChannel={onCreateChannel}
              onAddChannelMember={onAddChannelMember}
              onRemoveChannelMember={onRemoveChannelMember}
              onSendChannelMessage={onSendChannelMessage}
            />
          )}
          {boardTab === "activity" && <ActivityView client={client} />}
          {boardTab === "links" && (
            <LinksView
              client={client}
              session={session}
              onAddLink={onAddLink}
              onAddImage={onAddImage}
              onToggleLinkClientVisible={onToggleLinkClientVisible}
              onRemoveLink={onRemoveLink}
            />
          )}
          {boardTab === "members" && (
            <MembersView
              client={client}
              session={session}
              pendingInvites={pendingInvites}
              onShowInvite={onShowInvite}
              onRemoveMember={onRemoveMember}
              onPromoteToAdmin={onPromoteToAdmin}
              onDemoteToMember={onDemoteToMember}
              onToggleAdminCanSubmit={onToggleAdminCanSubmit}
              onToggleMemberCanCheckTasks={onToggleMemberCanCheckTasks}
              isOwner={isOwner}
            />
          )}
          {boardTab === "canvas" && (
            <div className="fixed bottom-5 right-5 flex flex-col gap-1.5 z-20 items-end">
              <button
                onClick={handleZoomIn}
                disabled={zoom >= ZOOM_MAX}
                className="icon-btn"
                title="Zoom in"
                style={{
                  opacity: zoom >= ZOOM_MAX ? 0.4 : 1,
                  cursor: zoom >= ZOOM_MAX ? "not-allowed" : "pointer",
                }}
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={handleZoomOut}
                disabled={zoom <= ZOOM_MIN}
                className="icon-btn"
                title="Zoom out"
                style={{
                  opacity: zoom <= ZOOM_MIN ? 0.4 : 1,
                  cursor: zoom <= ZOOM_MIN ? "not-allowed" : "pointer",
                }}
              >
                <ZoomOut size={14} />
              </button>
              <button onClick={handleZoomReset} className="icon-btn" title="Reset zoom (100%)">
                <Maximize2 size={14} />
              </button>
              <div
                onClick={handleZoomReset}
                className="text-[11px] font-mono px-2 py-1 rounded select-none cursor-pointer"
                style={{
                  background: "#2C2C2F",
                  border: "1px solid #36363A",
                  color: "#A1A1AA",
                  minWidth: "44px",
                  textAlign: "center",
                }}
                title="Click to reset"
              >
                {Math.round(zoom * 100)}%
              </div>
            </div>
          )}
        </main>
      </div>

      {showClientInviteModal && (
        <InviteClientModal
          pipeline={client}
          existingInvites={clientInvitesForPipeline}
          onInvite={onInviteClientToPipeline}
          onRevoke={onRevokeClientInvite}
          onClose={() => setShowClientInviteModal(false)}
        />
      )}
    </div>
  );
}
