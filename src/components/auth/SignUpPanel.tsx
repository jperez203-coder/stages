"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Mail, UserPlus } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { WorkspaceSelector } from "@/components/auth/WorkspaceSelector";
import { useSession } from "@/hooks/useSession";
import { peekPendingAcceptInvite } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * Lock state derived from a pending workspace-invite token in localStorage.
 * When the user arrived here from /accept-invite/[token] → "Create account",
 * we fetch the invite preview and lock the email field to the invited
 * address. Prevents the §3 papercut where a recipient could sign up with
 * an arbitrary email and end up with a useless account that can't accept.
 *
 * Defense-in-depth note: the accept_workspace_invite RPC ALSO enforces the
 * email match server-side (workspace_invites migration, lines 274-279). The
 * form lock is the UX layer; the RPC is the security gate. Do not remove
 * either thinking the other is sufficient — they protect different threats
 * (UI confusion vs. direct RPC call bypassing the form).
 */
type InviteLock =
  | { status: "none" }
  | { status: "loading" }
  | {
      status: "locked";
      email: string;
      workspaceName: string | null;
    }
  // Token exists in localStorage but the preview returned a non-pending
  // status (expired / accepted / not_found) — render the form unlocked so
  // the user isn't stranded. They'll see the bad-invite UX when the post-
  // auth router takes them back to /accept-invite/[token].
  | { status: "stale" };

/**
 * Client wrapper for /auth/signup. Three states:
 *   1. anonymous + no pending confirmation → render the form
 *   2. anonymous + sign-up succeeded but email not yet confirmed → "check
 *      your email" message
 *   3. authenticated (email already confirmed, or instant if email
 *      confirmation is OFF in this project) → AuthSuccessState
 *
 * Layered on top of those: if a pending workspace-invite token is in
 * localStorage, we pre-fill and lock the email to the invited address (see
 * InviteLock above).
 */
export function SignUpPanel() {
  const session = useSession();
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);
  const [inviteLock, setInviteLock] = useState<InviteLock>({ status: "none" });

  // Resolve the invite lock once on mount. Synchronous localStorage read +
  // async preview RPC. The token is PEEKED, not consumed — WorkspaceSelector
  // is the canonical consumer post-auth.
  //
  // No-token case leaves state at the useState default ({ status: "none" })
  // rather than calling setInviteLock — keeps render counts down and avoids
  // the react-hooks/set-state-in-effect lint rule for the trivial case.
  useEffect(() => {
    const token = peekPendingAcceptInvite();
    if (!token) return;
    // setState-in-effect is unavoidable here: localStorage isn't readable
    // during SSR, so the lock decision can't be derived from useState's
    // initial value without risking a hydration mismatch. The intermediate
    // "loading" state is needed to block the form render until the preview
    // RPC settles (otherwise the form briefly renders unlocked and then
    // suddenly locks — jarring). useSyncExternalStore would be overkill for
    // a one-shot read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInviteLock({ status: "loading" });
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc(
        "get_workspace_invite_preview",
        { invite_token: token },
      );
      if (!active) return;
      if (error) {
        // Network or RPC failure → render the form unlocked. The post-auth
        // /accept-invite/[token] page will retry the preview and surface the
        // error properly.
        setInviteLock({ status: "stale" });
        return;
      }
      const preview = data as
        | {
            status: "pending" | "expired" | "accepted" | "not_found";
            email?: string;
            workspace_name?: string;
          }
        | null;
      if (preview?.status === "pending" && preview.email) {
        setInviteLock({
          status: "locked",
          email: preview.email,
          workspaceName: preview.workspace_name ?? null,
        });
      } else {
        setInviteLock({ status: "stale" });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (session.status === "loading") {
    return (
      <AuthShell title="Create your account" subtitle="Setting things up.">
        <div className="h-32" />
      </AuthShell>
    );
  }

  if (session.status === "authenticated") {
    return <WorkspaceSelector />;
  }

  // Hold the form render until the invite-preview RPC settles. Avoids the
  // jarring flash of an unlocked form briefly visible before it suddenly
  // locks. None / stale / locked all proceed to render — only "loading"
  // blocks. The window is sub-second on a healthy network.
  if (inviteLock.status === "loading") {
    return (
      <AuthShell title="Create your account" subtitle="Setting things up.">
        <div className="h-32" />
      </AuthShell>
    );
  }

  if (pendingConfirmEmail) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="One more step to finish creating your account."
      >
        <div className="text-center">
          <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
            <Mail size={22} className="text-stages-blue" />
          </div>
          <p className="text-[14px] text-zinc-200 mb-1">Confirmation link sent</p>
          <p className="text-[13px] text-zinc-400 mb-5 break-all">
            {pendingConfirmEmail}
          </p>
          <p className="text-[12px] text-zinc-500 mb-5 leading-relaxed">
            Click the link in your email to verify your account. You can close
            this tab — once you click the link, you&apos;ll be signed in
            automatically.
          </p>
          {/* "Use a different email" only makes sense when the user isn't
              locked to an invite. With an invite lock, clicking would just
              bounce them back to the same locked email — confusing. */}
          {inviteLock.status !== "locked" && (
            <button
              onClick={() => setPendingConfirmEmail(null)}
              className="btn-ghost w-full justify-center"
            >
              Use a different email
            </button>
          )}
          {/* Defense-in-depth safety link. The SignUpForm catches the
              "already-registered" obfuscated response and shows an inline
              error with this same link, so this state should normally only
              appear for genuinely new signups. But if Supabase changes the
              obfuscation behaviour and the inline detection breaks, this
              link still gets the user where they need to go. */}
          <p className="mt-4 text-[12px] text-zinc-600">
            Already have an account?{" "}
            <Link
              href="/auth/signin"
              className="text-stages-blue hover:underline font-medium"
            >
              Sign in instead
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  // Locked-to-invite shell: title + subtitle reframe around accepting the
  // invite. The unlocked default talks about creating a workspace, which
  // would be misleading when the user is actually joining one.
  if (inviteLock.status === "locked") {
    return (
      <AuthShell
        title="Accept your invitation"
        subtitle={
          inviteLock.workspaceName
            ? `Create an account to join ${inviteLock.workspaceName}.`
            : "Create an account to accept your invite."
        }
      >
        <div
          className="mb-5 p-3 rounded-lg flex items-start gap-2.5"
          style={{
            background: "rgba(16, 140, 233, 0.08)",
            border: "1px solid rgba(16, 140, 233, 0.35)",
          }}
        >
          <UserPlus size={14} className="text-stages-blue flex-shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-zinc-300 leading-snug">
            This invite was sent to{" "}
            <span className="text-zinc-100 font-medium break-all">
              {inviteLock.email}
            </span>
            . You need to sign up with this address to accept it.
          </div>
        </div>
        {/* FB-1: SignUpForm now reads ?invite= via useSearchParams.
            Next.js 16 requires that under a Suspense boundary during
            prerender — same posture SignInPanel uses for
            WorkspaceSelector. The fallback mirrors the surrounding form
            spacing so there's no visual flicker. */}
        <Suspense fallback={<div className="h-72" />}>
          <SignUpForm
            onSignedUp={setPendingConfirmEmail}
            lockedEmail={inviteLock.email}
          />
        </Suspense>
        <ConsentMicrocopy />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up a workspace to start tracking client engagements."
    >
      <Suspense fallback={<div className="h-72" />}>
        <SignUpForm onSignedUp={setPendingConfirmEmail} />
      </Suspense>
      <ConsentMicrocopy />
    </AuthShell>
  );
}

/**
 * Legal-consent microcopy rendered below the SignUpForm in both
 * invite-locked and non-locked signup paths. Locked at Slice S7
 * build time — the microcopy MUST be visually proximate to the
 * "Create account" submit button for the consent linkage to be
 * unambiguous.
 */
function ConsentMicrocopy() {
  return (
    <p className="mt-4 text-[12px] text-zinc-500 leading-relaxed text-center">
      By creating an account, you agree to our{" "}
      <Link href="/terms" className="text-zinc-500 hover:underline">
        Terms of Service
      </Link>{" "}
      and acknowledge our{" "}
      <Link href="/privacy" className="text-zinc-500 hover:underline">
        Privacy Policy
      </Link>
      .
    </p>
  );
}
