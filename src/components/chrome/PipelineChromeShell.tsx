"use client";

import type { ReactNode } from "react";
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
  /** Hide the "Edit pipeline" toggle button in the header. Set on the
   *  /clients route — edit mode belongs on the canvas surface only.
   *  Defaults to false (button visible when canEditPipeline === true). */
  hideEditButton?: boolean;
  children: ReactNode;
};

export function PipelineChromeShell({
  workspaceSlug,
  chrome,
  completedTasks,
  totalTasks,
  user,
  hideEditButton = false,
  children,
}: Props) {
  return (
    <EditModeProvider canEditPipeline={chrome.canEditPipeline}>
      <div
        className="min-h-screen flex flex-col"
        style={{ background: "#212124" }}
      >
        <PipelineHeader
          workspaceSlug={workspaceSlug}
          chrome={chrome}
          completedTasks={completedTasks}
          totalTasks={totalTasks}
          user={user}
          hideEditButton={hideEditButton}
        />

        {/* Body row: rail on the left, page content on the right. */}
        <div className="flex-1 flex min-h-0">
          <LeftRail
            workspaceSlug={workspaceSlug}
            pipelineId={chrome.pipeline.id}
            members={chrome.members}
            canEditPipeline={chrome.canEditPipeline}
          />
          <div className="flex-1 flex flex-col min-w-0 relative">
            {children}
          </div>
        </div>
      </div>
    </EditModeProvider>
  );
}
