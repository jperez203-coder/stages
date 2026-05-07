"use client";

import { StagesLogo } from "@/components/icons/StagesLogo";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { InviteAcceptScreen } from "@/components/auth/InviteAcceptScreen";
import { ClientPortalAcceptScreen } from "@/components/auth/ClientPortalAcceptScreen";
import { Toast } from "@/components/Toast";
import { ClientList } from "@/components/home/ClientList";
import { NewClientModal } from "@/components/home/NewClientModal";
import { NewWorkspaceModal } from "@/components/home/NewWorkspaceModal";
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

  // ─── CLIENT PORTAL ROUTES — take precedence over agency-side ──────────
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
    return <PortalPlaceholder email={app.clientSession.email} onLogout={app.handleClientLogout} />;
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

  // Active pipeline open → pipeline view (lands in Checkpoint D).
  return (
    <>
      <PipelinePlaceholder
        clientName={app.activeClient.name}
        emoji={app.activeClient.emoji}
        onBack={() => {
          app.setActiveClientId(null);
          app.setActiveStageId(null);
          app.setBoardTab("canvas");
        }}
      />
      {app.toast && (
        <Toast key={app.toast.id} message={app.toast.message} type={app.toast.type} />
      )}
    </>
  );
}

function PipelinePlaceholder({
  clientName,
  emoji,
  onBack,
}: {
  clientName: string;
  emoji: string;
  onBack: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 w-full max-w-md fade-in text-center">
        <div className="flex justify-center mb-5">
          <StagesLogo size={48} />
        </div>
        <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "#979393" }}>
          Phase 2 · Checkpoint D
        </div>
        <h1 className="text-xl font-semibold mb-2">
          {emoji || "📋"} {clientName}
        </h1>
        <p className="text-[13px] mb-6 leading-relaxed" style={{ color: "#979393" }}>
          The pipeline view (canvas, stage page, chat, files, members, activity) lands in
          Checkpoint D. The pipeline is selected and addressable in app state — clicking back
          returns you to the homepage cleanly.
        </p>
        <button onClick={onBack} className="btn-ghost">Back to homepage</button>
      </div>
    </div>
  );
}

function PortalPlaceholder({
  email,
  onLogout,
}: {
  email: string;
  onLogout: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 w-full max-w-md fade-in text-center">
        <div className="flex justify-center mb-5">
          <StagesLogo size={48} />
        </div>
        <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "#979393" }}>
          Phase 2 · Checkpoint E
        </div>
        <h1 className="text-xl font-semibold mb-2">Client portal</h1>
        <p className="text-[13px] mb-1" style={{ color: "#E4E4E7" }}>
          <span style={{ color: "#979393" }}>Signed in as</span> {email}
        </p>
        <p className="text-[13px] mb-6 leading-relaxed" style={{ color: "#979393" }}>
          The project portal view (with the new Files section) lands in Checkpoint E.
        </p>
        <button onClick={onLogout} className="btn-ghost">Sign out</button>
      </div>
    </div>
  );
}
