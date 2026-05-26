import type { ReactNode } from "react";
import { PipelineChromeShell } from "@/components/chrome/PipelineChromeShell";
import { fetchCanvasRouteBundle } from "@/lib/canvas-route-cache";

/**
 * Layout for every route under /w/[slug]/p/[pipeline-id] — canvas
 * main + chat + files + clients. Phase 4b perf Win #2 (2026-05-26).
 *
 * Mirrors the proven pattern in src/app/portal/[pipeline-id]/layout.tsx:
 * the layout owns the gate + chrome render so tab navigations don't
 * re-run the workspace_memberships + pipelines + chrome + caller-profile
 * fetches that each tab page used to do solo.
 *
 * Result: clicking Canvas ↔ Chat ↔ Files ↔ Clients preserves this
 * layout (and therefore the PipelineChromeShell render) across the
 * navigation. Only the tab's specific page.tsx unmounts/remounts.
 * The 4 fetches above run ONCE per visit to the segment.
 *
 * Pages still call `fetchCanvasRouteBundle` for their own user.id /
 * chrome.members access AND as defense-in-depth on the gate. The
 * helper is React.cache-wrapped → page calls return the layout's
 * cached result with zero DB round-trips.
 *
 * REDIRECT BEHAVIOR — IDENTICAL to pre-hoist per-page code; see
 * canvas-route-cache.ts header for the three redirect cases.
 *
 * `hideEditButton` is NOT passed here — PipelineChromeShell now
 * defaults it based on `usePathname()` (canvas-main route shows the
 * button; sub-route tabs hide it). Callers can still override via the
 * prop if they need to force a different behavior. See
 * PipelineChromeShell for the derivation logic.
 *
 * Task counts come from the bundle's aggregate count queries → all
 * tabs now show accurate counts (was "0 / 0" on tabs pre-hoist; minor
 * UX improvement, no behavioral regression).
 */

export const dynamic = "force-dynamic";

// Next.js 16: LayoutProps params is loose (`Promise<unknown>`) so the
// layout type satisfies the generated LayoutConfig contravariance.
// Cast on resolution — Next guarantees the runtime shape matches the
// route segment. Same shape used by the portal layout.
export default async function CanvasLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as {
    slug: string;
    "pipeline-id": string;
  };
  const { slug } = resolved;
  const pipelineId = resolved["pipeline-id"];

  // Cached helper does the gate + all fetches. Redirects on failure
  // (anon → /auth/signin, non-member → /, mismatch → /w/<slug>).
  const bundle = await fetchCanvasRouteBundle(slug, pipelineId);

  return (
    <PipelineChromeShell
      workspaceSlug={bundle.ws.slug}
      chrome={bundle.chrome}
      completedTasks={bundle.taskCounts.completed}
      totalTasks={bundle.taskCounts.total}
      user={{
        email: bundle.user.email ?? "",
        displayName: bundle.callerProfile.display_name,
        avatarUrl: bundle.callerProfile.avatar_url,
      }}
    >
      {children}
    </PipelineChromeShell>
  );
}
