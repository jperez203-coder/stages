"use client";

import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/SignInForm";
import { WorkspaceSelector } from "@/components/auth/WorkspaceSelector";
import { useSession } from "@/hooks/useSession";

/**
 * Client wrapper for /auth/signin. Renders the form when anonymous, hands
 * off to WorkspaceSelector (orchestrator + chooser) when authenticated, and
 * shows a placeholder shell during the brief loading window after mount so
 * we don't flash the form for users who already have a stored session.
 */
export function SignInPanel() {
  const session = useSession();

  if (session.status === "loading") {
    return (
      <AuthShell title="Sign in" subtitle="Welcome back.">
        <div className="h-32" />
      </AuthShell>
    );
  }

  if (session.status === "authenticated") {
    // WorkspaceSelector calls useSearchParams (for the ?intent=portal
    // fork). Next.js 16 requires a Suspense boundary around any tree
    // that reads search params during static prerender — without this
    // the production build fails at /auth/signin too once the static
    // pass tries to render the authenticated branch.
    return (
      <Suspense
        fallback={
          <AuthShell title="Loading…" subtitle="Fetching your workspaces.">
            <div className="h-32" />
          </AuthShell>
        }
      >
        <WorkspaceSelector />
      </Suspense>
    );
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Sign in to your workspace.">
      <SignInForm />
    </AuthShell>
  );
}
