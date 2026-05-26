"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ChevronRight, LogOut } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { WorkspaceIcon } from "@/components/icons/WorkspaceIcon";
import { useSession } from "@/hooks/useSession";
import { useUserContexts, type UserContext } from "@/hooks/useUserContexts";
import { consumePendingAcceptInvite } from "@/lib/auth";
import { resolveDestination, urlForContext } from "@/lib/resolveDestination";
import { supabase } from "@/lib/supabase";

/**
 * Post-login orchestrator + chooser UI.
 *
 * Mounted in two places:
 *   1. Inside SignInPanel / SignUpPanel after the session flips authenticated.
 *      Replaces the step-2 AuthSuccessState.
 *   2. As the page contents at /select-workspace.
 *
 * Same component, same logic. Auto-redirects when the destination is
 * unambiguous (0 / 1 / valid last-active). Renders the chooser inline only
 * when there are 2+ contexts AND no valid last-active.
 *
 * The decision tree itself lives in src/lib/resolveDestination.ts as a pure
 * function — testable independently of React / Supabase.
 */
export function WorkspaceSelector() {
  const router = useRouter();
  const session = useSession();
  const contexts = useUserContexts();

  // ─── Anonymous-session redirect ────────────────────────────────────────
  // /select-workspace is reachable by direct URL. If an unauthenticated user
  // lands here, send them to sign in instead of letting the panel sit in
  // its loading state forever (useUserContexts stays in "loading" without
  // a user). The post-auth flow naturally goes through this component when
  // session.status flips to "authenticated", so anyone who signs in via
  // the redirected /auth/signin will return here on the next render cycle.
  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace("/auth/signin");
    }
  }, [session.status, router]);

  // ─── Auto-redirect side effect ─────────────────────────────────────────
  // Runs whenever the session or contexts state changes. Idempotent — calling
  // router.replace with the same URL twice is a no-op.
  useEffect(() => {
    if (session.status !== "authenticated") return;
    if (contexts.status !== "ready") return;

    // Pending invite redirect — set by /accept-invite/[token] before the
    // anonymous user clicked "Sign in" or "Create an account". Check
    // BEFORE running the resolver so we route back to finish accepting
    // instead of falling into the user's default destination.
    // consumePendingAcceptInvite reads-and-clears in one step so a future
    // post-auth render (sign out → sign back in) won't see a stale token.
    const pendingInviteToken = consumePendingAcceptInvite();
    if (pendingInviteToken) {
      router.replace(`/accept-invite/${pendingInviteToken}`);
      return;
    }

    const result = resolveDestination(
      contexts.contexts,
      contexts.lastActiveWorkspaceId,
    );

    if (result.kind === "create_workspace") {
      router.replace("/onboarding/create-workspace");
      return;
    }
    if (result.kind === "go_to") {
      void commitLastActive(session.user.id, result.contextToCommit.workspaceId);
      router.replace(result.url);
      return;
    }
    // result.kind === "show_chooser" → fall through, render the chooser below.
  }, [session, contexts, router]);

  const signOut = () => {
    void supabase.auth.signOut();
  };

  // ─── Loading & error states ────────────────────────────────────────────
  if (session.status === "loading" || contexts.status === "loading") {
    return (
      <AuthShell title="Loading…" subtitle="Fetching your workspaces.">
        <div className="h-32" />
      </AuthShell>
    );
  }

  if (contexts.status === "error") {
    return (
      <AuthShell
        title="Couldn't load your workspaces"
        subtitle="Something went wrong fetching your account."
      >
        <div className="text-center">
          <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-red/10">
            <AlertCircle size={22} className="text-stages-red" />
          </div>
          <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed break-words">
            {contexts.message}
          </p>
          <button onClick={signOut} className="btn-ghost w-full justify-center">
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </AuthShell>
    );
  }

  // ─── If we reach this point, the useEffect above will (or already did)
  // redirect for 0 / 1 / valid-last-active cases. The chooser only renders
  // for the 2+ contexts case. The brief render before the redirect fires
  // shows a routing message — clean enough not to flash.
  const result = resolveDestination(
    contexts.contexts,
    contexts.lastActiveWorkspaceId,
  );

  if (result.kind !== "show_chooser") {
    return (
      <AuthShell title="Routing you to your workspace…" subtitle="One moment.">
        <div className="text-center pt-4">
          <div className="h-20" />
          <p className="text-[12px] text-zinc-600 mb-3">
            Taking longer than expected? Sign out and try again.
          </p>
          <button onClick={signOut} className="btn-ghost w-full justify-center">
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a workspace"
      subtitle="You have access to multiple workspaces. Pick one to get started."
    >
      <div className="space-y-2">
        {contexts.contexts.map((ctx, idx) => (
          <ContextRow
            key={`${ctx.workspaceId}-${ctx.pipelineId ?? "ws"}-${idx}`}
            ctx={ctx}
            onSelect={() => {
              if (session.status === "authenticated") {
                void commitLastActive(session.user.id, ctx.workspaceId);
              }
              // Use the shared URL builder (B1 fix, 2026-05-26) so the
              // chooser path stays in lockstep with the auto-route
              // path in resolveDestination. Client contexts go to
              // /portal/[pipelineId]; agency contexts go to /w/[slug].
              router.push(urlForContext(ctx));
            }}
          />
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-zinc-800 text-center">
        <button onClick={signOut} className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
          Not you? Sign out
        </button>
      </div>
    </AuthShell>
  );
}

// ─── Chooser row ─────────────────────────────────────────────────────────────

function ContextRow({ ctx, onSelect }: { ctx: UserContext; onSelect: () => void }) {
  const label = ctx.pipelineName
    ? `${ctx.pipelineName} — ${ctx.workspaceName}`
    : ctx.workspaceName;

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 p-3 rounded-lg border border-stages-border hover:border-stages-border-hover hover:bg-stages-card transition-colors text-left"
    >
      <div className="flex-shrink-0">
        <WorkspaceIcon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-zinc-200 truncate">
          {label}
        </div>
        <div className="mt-0.5">
          <RoleBadge role={ctx.role} />
        </div>
      </div>
      <ChevronRight size={16} className="text-zinc-600 flex-shrink-0" />
    </button>
  );
}

function RoleBadge({ role }: { role: UserContext["role"] }) {
  const styles: Record<UserContext["role"], string> = {
    owner: "text-stages-blue",
    admin: "text-stages-purple",
    member: "text-zinc-500",
    client: "text-stages-amber",
  };
  const label = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <span className={`text-[11px] font-medium uppercase tracking-wider ${styles[role]}`}>
      {label}
    </span>
  );
}

// ─── Last-active commit helper ───────────────────────────────────────────────

/**
 * Fire-and-forget update to profiles.last_active_workspace_id. Failures are
 * non-fatal — worst case the user gets re-prompted with the chooser on next
 * sign-in — but they're logged to the console so silent regressions show up
 * in dev. Same lesson learned in HeaderWorkspaceSwitcher's switchTo: don't
 * trust `void` on a PostgrestBuilder; subscribe via await/.then() or the
 * request never fires.
 */
async function commitLastActive(userId: string, workspaceId: string) {
  // `.select()` returns the affected rows so we can detect silent RLS denials
  // (0 rows + no error). The current profiles_update policy allows any user
  // to update their own row, so this case is unreachable today — but the
  // warning means future policy tightening can't introduce a silent regression.
  const { error, data } = await supabase
    .from("profiles")
    .update({ last_active_workspace_id: workspaceId })
    .eq("id", userId)
    .select();
  if (error) {
    console.error(
      "Failed to persist last_active_workspace_id:",
      error.message,
    );
  } else if (!data || data.length === 0) {
    console.warn(
      "last_active_workspace_id update affected 0 rows — RLS denial or missing profile row?",
    );
  }
}
