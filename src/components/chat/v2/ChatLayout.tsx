"use client";

import type { ReactNode } from "react";

/**
 * Two-pane shell for the chat surface — left sidebar + right message
 * thread. Phase 4b slice 1.
 *
 * Fills the canvas-area container that PipelineChromeShell provides
 * (right of LeftRail, below PipelineHeader). The chrome is fixed; this
 * layout's children own the scrolling regions internally (sidebar
 * vertically scrolls its own list, MessageThread vertically scrolls
 * its own message area).
 */

type Props = {
  sidebar: ReactNode;
  thread: ReactNode;
};

export function ChatLayout({ sidebar, thread }: Props) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        minHeight: 0,
        minWidth: 0,
        background: "#212124",
      }}
    >
      {sidebar}
      {thread}
    </div>
  );
}
