import type { ReactNode } from "react";

/**
 * Layout for the (canvas) route group — `/w/[slug]/p/[pipeline-id]` and
 * its sub-routes (currently /clients, the agency-side client invite UI).
 *
 * Phase 4a step 5d is split into two atomic steps:
 *   1. **THIS COMMIT — route-groups split only.** This layout is a
 *      pass-through `<>{children}</>` so the new (canvas) group exists
 *      with no behavioral change. URLs stay identical to pre-split.
 *      Verifies that the route-groups architecture works end-to-end
 *      before any new feature work is bundled in.
 *
 *   2. **Phase 2 (next commit)** — replace this pass-through with the
 *      real `PipelineChrome` (header + left rail) per the 5d spec. At
 *      that point this file fetches pipeline-level data (name, emoji,
 *      company, last_edited_at, members + profiles) server-side and
 *      hands it to a client `PipelineChromeShell` component. The
 *      AppShell that was active under /w/[slug]/* before this split is
 *      now replaced by PipelineChrome for the canvas surface only;
 *      sibling routes in the (workspace) group keep AppShell unchanged.
 *
 * Why the split into two atomic steps: route-group refactors that
 * move every file in a tree have a non-zero blast radius (broken
 * imports, missing layouts). Verifying the move alone — with no new
 * code — confirms the URL surface is intact before adding header +
 * rail features. Catches one class of breakage at a time.
 */
export default function CanvasLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
