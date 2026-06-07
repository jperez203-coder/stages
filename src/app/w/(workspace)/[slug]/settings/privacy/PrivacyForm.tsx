"use client";

import { useState, useTransition } from "react";
import {
  setWorkspaceAgentEnabled,
  setUserImprovementSignals,
} from "./actions";

/**
 * Interactive section of /w/[slug]/settings/privacy.
 *
 * Renders two card sections:
 *
 *   1. Workspace AI  — Level 1 toggle (agent_enabled).
 *      Interactive for workspace owners; read-only status line for
 *      non-owners. Per docs/DATA-COLLECTION.md § 4.3.C.
 *
 *   2. Your AI preferences — Level 4 toggle (improvement_signals).
 *      Always interactive (own-profile setting; RLS-enforced).
 *
 * Each interactive toggle has its own useTransition + optimistic state so
 * the two sections can update independently. On server-action error the
 * optimistic state reverts and an inline message renders briefly.
 *
 * The Switch primitive is inlined here per Phase 3a design lock C (YAGNI;
 * no second consumer today). If Slice 0.2's per-integration UI needs the
 * same control, extract to src/components/ui/Switch.tsx then — ~5-min
 * refactor.
 */

type Props = {
  workspaceSlug: string;
  isOwner: boolean;
  initialAgentEnabled: boolean;
  initialImprovementSignals: boolean;
};

export function PrivacyForm({
  workspaceSlug,
  isOwner,
  initialAgentEnabled,
  initialImprovementSignals,
}: Props) {
  return (
    <>
      <WorkspaceAISection
        workspaceSlug={workspaceSlug}
        isOwner={isOwner}
        initialEnabled={initialAgentEnabled}
      />
      <ImprovementSignalsSection
        workspaceSlug={workspaceSlug}
        initialEnabled={initialImprovementSignals}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Section 1 — Workspace AI (Level 1)
// ─────────────────────────────────────────────────────────────────────────

function WorkspaceAISection({
  workspaceSlug,
  isOwner,
  initialEnabled,
}: {
  workspaceSlug: string;
  isOwner: boolean;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onToggle = (next: boolean) => {
    if (pending) return;
    const previous = enabled;
    setEnabled(next); // optimistic
    setError(null);
    startTransition(async () => {
      const result = await setWorkspaceAgentEnabled(workspaceSlug, next);
      if (!result.ok) {
        setEnabled(previous); // revert
        setError(result.error);
      }
    });
  };

  return (
    <div className="panel-card p-6 mb-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="text-[14px] font-semibold text-zinc-100">
          Workspace AI
        </div>
        <OwnerOnlyPill />
      </div>

      {isOwner ? (
        <>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[14px] text-zinc-100 leading-snug mb-1.5">
                Enable AI agent features in this workspace
              </div>
              <p className="text-[13px] text-zinc-500 leading-snug">
                When off, no AI features can be invoked in this workspace —
                even by members who have opted in to improvement signals.
              </p>
            </div>
            <Switch
              checked={enabled}
              onChange={onToggle}
              disabled={pending}
              label="Enable AI agent features in this workspace"
            />
          </div>
          {error && (
            <div className="mt-3 text-[12.5px] text-stages-red">{error}</div>
          )}
        </>
      ) : (
        <p className="text-[13px] text-zinc-500 leading-snug">
          AI agent features are{" "}
          <span className="text-zinc-300 font-medium">
            {enabled ? "on" : "off"}
          </span>{" "}
          in this workspace. Talk to your workspace owner to change this
          setting.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Section 2 — Your AI preferences (Level 4)
// ─────────────────────────────────────────────────────────────────────────

function ImprovementSignalsSection({
  workspaceSlug,
  initialEnabled,
}: {
  workspaceSlug: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onToggle = (next: boolean) => {
    if (pending) return;
    const previous = enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const result = await setUserImprovementSignals(workspaceSlug, next);
      if (!result.ok) {
        setEnabled(previous);
        setError(result.error);
      }
    });
  };

  return (
    <div className="panel-card p-6 mb-4">
      <div className="text-[14px] font-semibold text-zinc-100 mb-3">
        Your AI preferences
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[14px] text-zinc-100 leading-snug mb-1.5">
            Allow anonymized usage signals to improve AI features for everyone
          </div>
          <p className="text-[13px] text-zinc-500 leading-snug">
            Off by default. Anonymized signals only — never the content of
            your work, messages, or connected-service data.
          </p>
        </div>
        <Switch
          checked={enabled}
          onChange={onToggle}
          disabled={pending}
          label="Allow anonymized usage signals to improve AI features"
        />
      </div>
      {error && (
        <div className="mt-3 text-[12.5px] text-stages-red">{error}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Inline primitives
// ─────────────────────────────────────────────────────────────────────────

/**
 * Tailwind-styled toggle switch. Uses a hidden native checkbox underneath
 * for accessibility (keyboard + screen reader). Visual is a 44×24 pill
 * with a 20×20 sliding circle. Active state uses stages-blue (the primary-
 * action token).
 *
 * Not extracted to src/components/ui/ — single consumer today. See Phase 3a
 * design lock C in docs/DATA-COLLECTION.md.
 */
function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <label
      className={`relative inline-flex items-center flex-shrink-0 mt-0.5 ${
        disabled ? "opacity-60 cursor-wait" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={label}
        className="sr-only peer"
      />
      <div
        className={`w-11 h-6 rounded-full transition-colors ${
          checked ? "bg-stages-blue" : "bg-zinc-700"
        }`}
      />
      <div
        className={`absolute top-0.5 left-0.5 bg-white rounded-full h-5 w-5 transition-transform shadow-sm ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </label>
  );
}

/**
 * "Owner only" badge in the workspace-purple palette (#6E5BE8), matching
 * the founding-member badge styling in settings/billing/page.tsx. Different
 * semantic than the gray "Coming soon" badge used for deferred-slot cards.
 */
function OwnerOnlyPill() {
  return (
    <span
      className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-semibold tracking-wide uppercase"
      style={{
        background: "rgba(110, 91, 232, 0.14)",
        color: "#9586EE",
        border: "1px solid rgba(110, 91, 232, 0.45)",
      }}
    >
      Owner only
    </span>
  );
}
