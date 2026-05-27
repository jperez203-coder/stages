import { Suspense } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { WorkspaceSelector } from "@/components/auth/WorkspaceSelector";

export const metadata = {
  title: "Choose a workspace — Stages",
};

/**
 * Suspense wrapper is required because WorkspaceSelector calls
 * useSearchParams (for the ?intent=portal fork). Next.js 16's static
 * prerender pass bails out of any tree that reads search params unless
 * a Suspense boundary catches the suspending render. Dev mode skips
 * this check, so the local build looked fine — Vercel surfaces it.
 *
 * Fallback mirrors WorkspaceSelector's own "loading" state (AuthShell
 * with a "Fetching your workspaces" subtitle) so the transition from
 * suspended → hydrated doesn't visibly flash.
 */
export default function SelectWorkspacePage() {
  return (
    <Suspense fallback={<SelectWorkspaceFallback />}>
      <WorkspaceSelector />
    </Suspense>
  );
}

function SelectWorkspaceFallback() {
  return (
    <AuthShell title="Loading…" subtitle="Fetching your workspaces.">
      <div className="h-32" />
    </AuthShell>
  );
}
