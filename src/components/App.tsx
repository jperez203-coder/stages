"use client";

import { StagesLogo } from "@/components/icons/StagesLogo";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { InviteAcceptScreen } from "@/components/auth/InviteAcceptScreen";
import { ClientPortalAcceptScreen } from "@/components/auth/ClientPortalAcceptScreen";
import { Toast } from "@/components/Toast";
import { ClientList } from "@/components/home/ClientList";
import { NewClientModal } from "@/components/home/NewClientModal";
import { NewWorkspaceModal } from "@/components/home/NewWorkspaceModal";
import { ClientBoard } from "@/components/board/ClientBoard";
import type { BoardTab } from "@/components/board/ClientBoard";
import { StagePage } from "@/components/board/StagePage";
import { InviteModal } from "@/components/board/InviteModal";
import { SaveTemplateModal } from "@/components/board/SaveTemplateModal";
import { ClientPortal } from "@/components/portal/ClientPortal";
import { useAppState } from "@/hooks/useAppState";

export function App() {
  const app = useAppState();

  if (app.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <StagesLogo size={48} />
          <div className="flex items-center gap-2 text-zinc-500 text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            Loading Stages
          </div>
        </div>
      </div>
    );
  }

  // ─── CLIENT PORTAL ROUTES ─────────────────────────────────────────────
  if (app.pendingClientPortalInvite && !app.clientSession) {
    return (
      <ClientPortalAcceptScreen
        invite={app.pendingClientPortalInvite}
        pipeline={app.clients.find((c) => c.id === app.pendingClientPortalInvite!.clientId)}
        onAccept={app.acceptClientPortalInvite}
        onDecline={() => {
          app.setPendingClientPortalInvite(null);
          try {
            const u = new URL(window.location.href);
            u.searchParams.delete("clientInvite");
            window.history.replaceState({}, "", u.toString());
          } catch {}
        }}
      />
    );
  }

  if (app.clientSession && app.clientPipeline) {
    return (
      <ClientPortal
        pipeline={app.clientPipeline}
        clientSession={app.clientSession}
        onLogout={app.handleClientLogout}
        onSendChannelMessage={(channelId, text, mentions) =>
          app.sendClientChannelMessage(channelId, text, mentions)
        }
        onToggleTask={(stageId, taskId) => app.clientToggleTask(stageId, taskId)}
      />
    );
  }

  if (app.clientSession && !app.clientPipeline) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="panel-card p-8 max-w-md text-center">
          <div className="text-2xl mb-2">⚠️</div>
          <h2 className="text-lg font-semibold mb-2">Pipeline unavailable</h2>
          <p className="text-[13px] mb-4" style={{ color: "#979393" }}>
            This project may have been removed or your access revoked. Please contact the agency.
          </p>
          <button onClick={app.handleClientLogout} className="btn-ghost">Sign out</button>
        </div>
      </div>
    );
  }

  // ─── AGENCY-SIDE ROUTES ───────────────────────────────────────────────
  if (app.pendingInvite && !app.session) {
    return (
      <InviteAcceptScreen
        invite={app.pendingInvite}
        client={app.clients.find((c) => c.id === app.pendingInvite!.clientId)}
        onAccept={(email) => app.acceptInvite(app.pendingInvite!.token, email)}
        onDecline={() => {
          app.setPendingInvite(null);
          window.history.replaceState({}, "", window.location.pathname);
        }}
      />
    );
  }

  if (!app.session) {
    return (
      <>
        <LoginScreen onLogin={app.handleLogin} />
        {app.toast && (
          <Toast key={app.toast.id} message={app.toast.message} type={app.toast.type} />
        )}
      </>
    );
  }

  // Signed in, no pipeline open → homepage.
  if (!app.activeClient) {
    const session = app.session;
    return (
      <>
        <ClientList
          clients={app.filteredClients}
          allClients={app.visibleClients}
          totalClients={app.visibleClients.length}
          searchQuery={app.searchQuery}
          setSearchQuery={app.setSearchQuery}
          onOpen={app.setActiveClientId}
          onDelete={app.deleteClient}
          onNew={() => app.setShowNewClient(true)}
          session={session}
          onLogout={app.handleLogout}
          computeUnread={app.computeUnread}
          workspaces={app.workspaces.filter((w) => w.ownerEmail === session.email)}
          activeWorkspace={app.workspaces.find((w) => w.id === app.activeWorkspaceId)}
          onSwitchWorkspace={app.switchWorkspace}
          onShowWorkspaceModal={() => app.setShowWorkspaceModal(true)}
          onRenameWorkspace={app.renameWorkspace}
          onDeleteWorkspace={app.deleteWorkspace}
        />
        {app.showNewClient && (
          <NewClientModal
            onCreate={app.createClient}
            onCancel={() => app.setShowNewClient(false)}
            userTemplates={app.userTemplates}
            onDeleteUserTemplate={app.deleteUserTemplate}
          />
        )}
        {app.showWorkspaceModal && (
          <NewWorkspaceModal
            onCreate={(name) => {
              app.createWorkspace(name);
              app.setShowWorkspaceModal(false);
            }}
            onCancel={() => app.setShowWorkspaceModal(false)}
          />
        )}
        {app.toast && (
          <Toast key={app.toast.id} message={app.toast.message} type={app.toast.type} />
        )}
      </>
    );
  }

  // Active client, no stage focused → ClientBoard.
  if (!app.activeStage) {
    const activeClient = app.activeClient;
    const session = app.session;
    const clientInvitesForPipeline = Object.entries(app.clientInvites)
      .filter(([, inv]) => inv.clientId === activeClient.id)
      .map(([token, inv]) => ({ token, ...inv }));
    const clientPortalEmail =
      clientInvitesForPipeline.find((inv) => inv.accepted)?.clientEmail ||
      clientInvitesForPipeline[0]?.clientEmail ||
      null;
    return (
      <>
        <ClientBoard
          client={activeClient}
          session={session}
          boardTab={app.boardTab as BoardTab}
          setBoardTab={app.setBoardTab}
          unread={app.computeUnread(activeClient)}
          onBack={() => {
            app.setActiveClientId(null);
            app.setActiveStageId(null);
            app.setBoardTab("canvas");
          }}
          onOpenStage={app.setActiveStageId}
          onMoveToStage={(sid) => app.moveToStage(activeClient.id, sid)}
          onSubmitPipeline={() => app.submitPipeline(activeClient.id)}
          onUpdateTaskPos={(stageId, taskId, pos) =>
            app.updateTaskPosition(activeClient.id, stageId, taskId, pos)
          }
          onShowInvite={() => app.setShowInviteModal(true)}
          onShowSaveTemplate={() => app.setShowSaveTemplateModal(true)}
          onRenameStage={(sid, name) => app.renameStage(activeClient.id, sid, name)}
          onAddStage={() => app.addStage(activeClient.id)}
          onRemoveStage={(sid) => app.removeStage(activeClient.id, sid)}
          onReorderStage={(sid, delta) => app.reorderStage(activeClient.id, sid, delta)}
          onRemoveMember={(email) => app.removeMember(activeClient.id, email)}
          onPromoteToAdmin={(email) => app.promoteToAdmin(activeClient.id, email)}
          onDemoteToMember={(email) => app.demoteToMember(activeClient.id, email)}
          onToggleAdminCanSubmit={(email) => app.toggleAdminCanSubmit(activeClient.id, email)}
          onToggleMemberCanCheckTasks={(email) =>
            app.toggleMemberCanCheckTasks(activeClient.id, email)
          }
          pendingInvites={app.pendingClientInvitesForActive}
          hasSeenCelebration={app.hasSeenCelebration(activeClient.id)}
          onMarkCelebrationSeen={() => app.markCelebrationSeen(activeClient.id)}
          clientPortalEmail={clientPortalEmail}
          onCreateChannel={(name, members, isClient) =>
            app.createChannel(activeClient.id, name, members, isClient)
          }
          onAddChannelMember={(channelId, email) =>
            app.addChannelMember(activeClient.id, channelId, email)
          }
          onRemoveChannelMember={(channelId, email) =>
            app.removeChannelMember(activeClient.id, channelId, email)
          }
          onSendChannelMessage={(channelId, text, mentions, internal) =>
            app.sendChannelMessage(activeClient.id, channelId, text, mentions, internal)
          }
          onAddLink={(label, url) => app.addLink(activeClient.id, label, url)}
          onAddImage={(label, dataUrl, fileName, fileSize) =>
            app.addImage(activeClient.id, label, dataUrl, fileName, fileSize)
          }
          onToggleLinkClientVisible={(linkId) =>
            app.toggleLinkClientVisible(activeClient.id, linkId)
          }
          onRemoveLink={(linkId) => app.removeLink(activeClient.id, linkId)}
          clientInvitesForPipeline={clientInvitesForPipeline}
          onInviteClientToPipeline={(email) => app.inviteClientToPipeline(activeClient.id, email)}
          onRevokeClientInvite={app.revokeClientInvite}
        />
        {app.showInviteModal && (
          <InviteModal
            client={activeClient}
            onCreate={(email) => app.createInvite(activeClient.id, email)}
            onClose={() => app.setShowInviteModal(false)}
          />
        )}
        {app.showSaveTemplateModal && (
          <SaveTemplateModal
            client={activeClient}
            onSave={(name, includeTasks) =>
              app.saveAsTemplate(activeClient.id, name, includeTasks)
            }
            onClose={() => app.setShowSaveTemplateModal(false)}
          />
        )}
        {app.toast && (
          <Toast key={app.toast.id} message={app.toast.message} type={app.toast.type} />
        )}
      </>
    );
  }

  // Active stage open → real StagePage.
  const activeClient = app.activeClient;
  const activeStage = app.activeStage;
  const isCurrent = activeClient.currentStage === activeStage.id;
  return (
    <>
      <StagePage
        client={activeClient}
        stage={activeStage}
        session={app.session}
        isCurrent={isCurrent}
        onBack={() => app.setActiveStageId(null)}
        onMarkComplete={() => app.completeCurrentStage(activeClient.id)}
        onToggleTask={(tid) => app.toggleTask(activeClient.id, activeStage.id, tid)}
        onAddTask={(text) => app.addTask(activeClient.id, activeStage.id, text)}
        onRemoveTask={(tid) => app.removeTask(activeClient.id, activeStage.id, tid)}
        onSetTaskNote={(tid, note) =>
          app.setTaskNote(activeClient.id, activeStage.id, tid, note)
        }
        onEditTaskText={(tid, text) =>
          app.editTaskText(activeClient.id, activeStage.id, tid, text)
        }
        onAddNote={(text) => app.addNote(activeClient.id, activeStage.id, text)}
        onEditNote={(noteId, text) =>
          app.editNote(activeClient.id, activeStage.id, noteId, text)
        }
        onDeleteNote={(noteId) => app.deleteNote(activeClient.id, activeStage.id, noteId)}
        onUpdateStageDescription={(desc) =>
          app.updateStageDescription(activeClient.id, activeStage.id, desc)
        }
        onSetStageDeadline={(deadline) =>
          app.setStageDeadline(activeClient.id, activeStage.id, deadline)
        }
        onSetTaskDeadline={(taskId, deadline) =>
          app.setTaskDeadline(activeClient.id, activeStage.id, taskId, deadline)
        }
        onToggleStageClientVisible={() =>
          app.toggleStageClientVisible(activeClient.id, activeStage.id)
        }
        onToggleTaskClientVisible={(taskId) =>
          app.toggleTaskClientVisible(activeClient.id, activeStage.id, taskId)
        }
        onToggleNoteClientVisible={(noteId) =>
          app.toggleNoteClientVisible(activeClient.id, activeStage.id, noteId)
        }
        onAddStageAttachment={(label, dataUrl, fileName, fileSize) =>
          app.addStageAttachment(
            activeClient.id,
            activeStage.id,
            label,
            dataUrl,
            fileName,
            fileSize,
          )
        }
        onToggleStageAttachmentClientVisible={(attachmentId) =>
          app.toggleStageAttachmentClientVisible(
            activeClient.id,
            activeStage.id,
            attachmentId,
          )
        }
        onRemoveStageAttachment={(attachmentId) =>
          app.removeStageAttachment(activeClient.id, activeStage.id, attachmentId)
        }
        onReorderTask={(taskId, newIndex) =>
          app.reorderTask(activeClient.id, activeStage.id, taskId, newIndex)
        }
      />
      {app.toast && (
        <Toast key={app.toast.id} message={app.toast.message} type={app.toast.type} />
      )}
    </>
  );
}

