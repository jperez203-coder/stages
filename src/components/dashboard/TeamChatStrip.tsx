"use client";

import { Lock } from "lucide-react";

/**
 * Team chat strip on the workspace dashboard. Phase 4a step 2.
 *
 * STEP 2 STATE: ALWAYS renders, ALWAYS shows the empty state. The workspace-
 * level chat channel schema doesn't exist yet — `channels.pipeline_id` is
 * NOT NULL, so all current channels are pipeline-scoped. Workspace chat is
 * a Phase 4b deliverable (schema migration + writer surface + UI wire-up).
 *
 * TODO(4b): gate this strip on workspaces.plan === 'team'. When gated for
 * solo-plan workspaces, return null (not display:none) so the DOM is clean.
 * The plan column itself is deferred to Phase 6 (Stripe billing); until
 * then this strip always renders regardless of plan.
 *
 * TODO(4b): when workspace chat schema lands, fetch most recent message +
 * reply count and render preview row. Empty state remains as fallback when
 * no messages exist yet.
 */

export function TeamChatStrip() {
  return (
    <div
      className="rounded-2xl mt-6"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        padding: "20px 24px",
      }}
    >
      <header className="flex items-center gap-3">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: "#212124",
            border: "1px solid #36363A",
            fontSize: 24,
          }}
        >
          💬
        </div>
        <h2 className="text-[16px] font-medium text-white">Team</h2>
        <span
          className="inline-flex items-center gap-1 text-[11px]"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.5)",
            padding: "2px 8px",
            borderRadius: 10,
          }}
        >
          <Lock size={10} />
          internal only
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            console.log(
              "[step 2 stub] open chat clicked. workspace chat arrives in 4b.",
            );
          }}
          className="text-[14px] font-medium"
          style={{
            color: "#7FA7D9",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          Open chat →
        </button>
      </header>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p
          className="text-[13px]"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          no messages yet.
        </p>
        <button
          type="button"
          onClick={() => {
            console.log(
              "[step 2 stub] start a conversation clicked. workspace chat arrives in 4b.",
            );
          }}
          className="text-[14px] font-medium text-white flex-shrink-0"
          style={{
            background: "#108CE9",
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
          }}
        >
          Start a conversation
        </button>
      </div>
    </div>
  );
}
