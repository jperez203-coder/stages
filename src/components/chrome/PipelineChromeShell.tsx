"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PipelineHeader } from "./PipelineHeader";
import { LeftRail } from "./LeftRail";
import { EditModeProvider } from "./EditModeContext";
import type { CanvasChromeData } from "@/lib/canvas-chrome-data";

/**
 * Top-level chrome wrapper for every route in the (canvas) route group.
 * Phase 4a step 5d.
 *
 * Layout (fixed chrome, scrollable content):
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  PipelineHeader (sticky, 52px tall)                    │
 *   ├────┬───────────────────────────────────────────────────┤
 *   │    │                                                    │
 *   │ R  │                                                    │
 *   │ A  │           {children}  ← the actual page            │
 *   │ I  │           (canvas OR /clients body)                │
 *   │ L  │                                                    │
 *   │    │                                                    │
 *   └────┴───────────────────────────────────────────────────┘
 *
 * The header + rail are fixed chrome — they don't pan or zoom with the
 * canvas. Only the canvas's internal transform plane pans/zooms.
 *
 * Used by:
 *   * `/w/[slug]/p/[pipeline-id]/page.tsx` (canvas)
 *   * `/w/[slug]/p/[pipeline-id]/clients/page.tsx` (client invite UI)
 *
 * Both pages fetch chrome data via `fetchCanvasChromeData()` server-side
 * and pass the result here as the `chrome` prop. Children render inside
 * the canvas-area div which fills the remaining viewport (right of
 * rail, below header).
 *
 * Note: the chrome itself is a CLIENT component (PipelineHeader +
 * LeftRail both need React state for popovers + the profile menu).
 * Data comes in as props from the server page — no client-side fetch,
 * no flash of empty header.
 */

type Props = {
  workspaceSlug: string;
  /** WT-5: parent workspace category. Threaded into LeftRail to gate
   *  the "+ Invite client" + "View as client" affordances on personal
   *  workspaces. The pipeline canvas itself still renders for both
   *  categories — only the client-portal-adjacent rail icons hide. */
  workspaceType: "agency" | "personal";
  chrome: CanvasChromeData;
  /** Aggregated task counts for the header subline. Caller computes
   *  from whatever task data they already have; passed in to avoid
   *  refetching just for a count. /clients page passes 0/0 since it
   *  doesn't fetch tasks. */
  completedTasks: number;
  totalTasks: number;
  /** Logged-in user's profile (for the HeaderProfileMenu in the
   *  top-right corner of the header, separated from the pipeline
   *  member cluster by a visual divider per spec). */
  user: {
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  /** Hide the "Edit pipeline" toggle button in the header. OPTIONAL —
   *  defaults to "hide on tab sub-routes (chat/files/clients), show on
   *  canvas main" via usePathname below. Pre-Win-#2 (perf hoist) this
   *  was a required-on-tabs prop passed by each tab page; post-hoist
   *  the shell renders in the shared layout and derives the default
   *  itself. Callers can still pass an explicit override if they need
   *  to force a value. */
  hideEditButton?: boolean;
  children: ReactNode;
};

export function PipelineChromeShell({
  workspaceSlug,
  workspaceType,
  chrome,
  completedTasks,
  totalTasks,
  user,
  hideEditButton,
  children,
}: Props) {
  // Edit-button default: hide on the three tab sub-routes (chat/files/
  // clients), show on the canvas-main route (no trailing tab segment).
  // The shell now lives in the shared canvas layout, so it needs to
  // self-derive this rather than each page passing it. Caller-provided
  // `hideEditButton` (when defined) overrides the pathname default.
  const pathname = usePathname();
  const isTabRoute = pathname
    ? /\/p\/[^/]+\/(chat|files|clients)(\/|$)/.test(pathname)
    : false;
  const effectiveHideEditButton = hideEditButton ?? isTabRoute;

  return (
    <EditModeProvider canEditPipeline={chrome.canEditPipeline}>
      {/* NF-2.3: h-screen + overflow-hidden replace NF-2.2's min-h-0
          attempt. The root cause of NF-2.2's no-op: with min-h-screen
          (floor, not ceiling) on this outer div, content can still
          push the chrome past viewport — min-h-0 on a descendant only
          lets that descendant shrink, it doesn't bound the ancestor.
          h-screen caps the chrome to exactly viewport height;
          overflow-hidden insures against any residual growth.
          Sibling tabbed children (PipelineCanvas, FilesBody, etc.)
          already clip their own contents (overflow:hidden inside);
          this change just stops the page itself from scrolling. */}
      <div
        className="h-screen overflow-hidden flex flex-col"
        style={{ background: "#212124" }}
      >
        <PipelineHeader
          workspaceSlug={workspaceSlug}
          chrome={chrome}
          completedTasks={completedTasks}
          totalTasks={totalTasks}
          user={user}
          hideEditButton={effectiveHideEditButton}
        />

        {/* Body row: rail on the left, page content on the right. */}
        <div className="flex-1 flex min-h-0">
          <LeftRail
            workspaceSlug={workspaceSlug}
            pipelineId={chrome.pipeline.id}
            members={chrome.members}
            canEditPipeline={chrome.canEditPipeline}
            isWorkspaceOwnerOrAdmin={chrome.isWorkspaceOwnerOrAdmin}
            workspaceType={workspaceType}
          />
          {/* NF-2.2: `min-h-0` is mandatory on a flex-col child that
              hosts an internally-scrolling page (the chat surface in
              particular). Without it, ChatLayout's flex:1 children
              overflow this column, the overflow leaks to the page,
              and scrolling the messages list scrolls the LeftRail +
              ChatSidebar with it. min-w-0 already shipped for
              horizontal containment; this is its vertical sibling. */}
          <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
            {children}
          </div>
        </div>
      </div>
    </EditModeProvider>
  );
}
