"use client";

import { StagesLogo } from "@/components/icons/StagesLogo";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { InviteAcceptScreen } from "@/components/auth/InviteAcceptScreen";
import { ClientPortalAcceptScreen } from "@/components/auth/ClientPortalAcceptScreen";
import { Toast } from "@/components/Toast";
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
    return <Phase2Placeholder kind="client-portal" email={app.clientSession.email} />;
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
          <button onClick={app.handleClientLogout} className="btn-ghost">
            Sign out
          </button>
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
        {app.toast && <Toast key={app.toast.id} message={app.toast.message} type={app.toast.type} />}
      </>
    );
  }

  // Signed in as agency — full ClientList / ClientBoard / StagePage land in
  // Checkpoints C and D. Until then, show a placeholder so the auth flow can
  // be exercised end-to-end.
  return (
    <>
      <Phase2Placeholder kind="agency" email={app.session.email} onLogout={app.handleLogout} />
      {app.toast && <Toast key={app.toast.id} message={app.toast.message} type={app.toast.type} />}
    </>
  );
}

// Throwaway scaffolding for Checkpoint B — replaced in C/D when the real
// ClientList and ClientPortal land.
function Phase2Placeholder({
  kind,
  email,
  onLogout,
}: {
  kind: "agency" | "client-portal";
  email: string;
  onLogout?: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 w-full max-w-md fade-in text-center">
        <div className="flex justify-center mb-5">
          <StagesLogo size={48} />
        </div>
        <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "#979393" }}>
          Phase 2 · Checkpoint B
        </div>
        <h1 className="text-xl font-semibold mb-2">
          {kind === "agency" ? "Signed in" : "Client portal"}
        </h1>
        <p className="text-[13px] mb-1" style={{ color: "#E4E4E7" }}>
          <span style={{ color: "#979393" }}>You&apos;re in as</span> {email}
        </p>
        <p className="text-[13px] mb-6 leading-relaxed" style={{ color: "#979393" }}>
          The {kind === "agency" ? "client list and pipeline views" : "project portal view"} land
          in {kind === "agency" ? "Checkpoints C and D" : "Checkpoint E"}. Auth + state extraction
          are working — sign-out works, and the app would route correctly if those views existed.
        </p>
        {onLogout && (
          <button onClick={onLogout} className="btn-ghost">
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
