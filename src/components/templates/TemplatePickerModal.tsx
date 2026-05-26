"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Bookmark, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { TemplateCard, type TemplateForCard } from "./TemplateCard";

/**
 * Step-2 picker for the create-pipeline flow. Phase 4c slice 4.
 *
 * Mockup: ./pipeline-snapshot.png. Centered modal with two sections —
 * "Your templates" (bookmark icon, workspace-saved templates) above
 * "Starter templates" (sparkles icon, Stages-shipped built-ins).
 * Cards render via TemplateCard. "Create Pipeline" disabled until a
 * card is selected. "Blank Workspace" built-in IS the from-scratch
 * option — there's no separate "Start from scratch" affordance.
 *
 * Owns:
 *   * The templates fetch (one query, RLS + explicit `or` filter)
 *   * Loading + error states for that fetch
 *   * Local `selectedTemplateId` (single-pick)
 *
 * Delegates to parent (the create-pipeline page):
 *   * onBack — return to step 1 with step-1 form values intact
 *   * onCancel — abandon the whole flow (X / Esc / backdrop)
 *   * onCreate — fire the RPC with the chosen template_id
 *
 * Defense-in-depth on visibility:
 *   * Query filter: workspace_id IS NULL OR workspace_id = active. RLS
 *     would already filter to the user's accessible templates, but the
 *     explicit `or` makes the intent obvious and protects against
 *     future RLS relaxations that could leak other-workspace templates
 *     into the picker.
 *   * RPC re-check: the 5-arg create_pipeline_with_channels validates
 *     the chosen template_id is reachable in this workspace (built-in
 *     OR own workspace) and 42501s otherwise. The picker can't bypass.
 */

const SECTION_LABEL_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "rgba(255,255,255,0.55)",
  marginBottom: 10,
};

type Props = {
  /** Active workspace — used to scope the templates fetch + passed to
   *  the RPC by the parent. */
  workspaceId: string;
  /** Return to step 1 (name + emoji + company). Step-1 values are
   *  preserved by the parent's component state. */
  onBack: () => void;
  /** Abandon the whole flow. Parent typically router.push(`/w/[slug]`). */
  onCancel: () => void;
  /** Submit. Parent fires the 5-arg RPC with this id + step-1 values. */
  onCreate: (templateId: string) => Promise<void> | void;
  /** Parent sets true while the RPC is in flight. Disables Create + Back. */
  isCreating: boolean;
  /** Surface RPC errors inline. NULL when no error. */
  createError: string | null;
};

type FetchStatus = "loading" | "ready" | "error";

export function TemplatePickerModal({
  workspaceId,
  onBack,
  onCancel,
  onCreate,
  isCreating,
  createError,
}: Props) {
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [templates, setTemplates] = useState<TemplateForCard[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Fetch templates on mount ────────────────────────────────────────
  // One query. Explicit `or` filter narrows to built-ins + this
  // workspace's saved (defense in depth — RLS would do this anyway but
  // we don't want to depend on it). Nested `template_stages(... ,
  // template_tasks(count))` gives us per-stage task counts in one shot
  // so the card can render the "N stages · M tasks" auto-summary
  // without a second round trip.
  //
  // Ordering: workspace_id ASC NULLS FIRST so built-ins land first in
  // the array. We split into two arrays client-side and render in the
  // mockup's section order (Your templates above Starter templates).
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setFetchError(null);
    void (async () => {
      const { data, error } = await supabase
        .from("templates")
        .select(
          `
          id, name, description, emoji, workspace_id,
          template_stages (
            id, position, name,
            template_tasks ( count )
          )
        `,
        )
        .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
        .order("workspace_id", { ascending: true, nullsFirst: true });

      if (cancelled) return;
      if (error) {
        console.error("[template-picker] fetch failed:", error);
        setFetchError(error.message);
        setStatus("error");
        return;
      }
      setTemplates((data as TemplateForCard[]) ?? []);
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // ── Esc closes (matches AddLinkModal + SaveAsTemplateModal pattern) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isCreating) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, isCreating]);

  // ── Split into two arrays for section rendering ─────────────────────
  // workspace_id non-null = "Your templates"
  // workspace_id null     = "Starter templates" (Stages-shipped)
  const yourTemplates = templates.filter((t) => t.workspace_id !== null);
  const starterTemplates = templates.filter((t) => t.workspace_id === null);

  const canCreate = selectedId !== null && !isCreating && status === "ready";

  const handleCreate = () => {
    if (!canCreate || selectedId === null) return;
    void onCreate(selectedId);
  };

  return (
    <div
      onClick={() => {
        if (!isCreating) onCancel();
      }}
      role="dialog"
      aria-label="Pick a starting point"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 640,
          maxHeight: "90vh",
          background: "#1A1A1C",
          border: "1px solid #36363A",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid #2A2A2D",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "rgba(255,255,255,0.45)",
                letterSpacing: 0.3,
              }}
            >
              New pipeline · Step 2 of 2
            </span>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: "white",
                lineHeight: 1.3,
              }}
            >
              Pick a starting point
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
              color: "rgba(255,255,255,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: isCreating ? "not-allowed" : "pointer",
              flexShrink: 0,
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body — scrolls when content exceeds maxHeight */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            minHeight: 0,
          }}
        >
          {status === "loading" && (
            <PickerLoadingState />
          )}

          {status === "error" && (
            <div
              role="alert"
              style={{
                padding: 12,
                background: "rgba(244,63,94,0.08)",
                border: "1px solid rgba(244,63,94,0.3)",
                borderRadius: 8,
                color: "#F43F5E",
                fontSize: 13,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                Couldn&apos;t load templates: {fetchError ?? "unknown error"}.
                Refresh to retry.
              </span>
            </div>
          )}

          {status === "ready" && (
            <>
              {/* "Your templates" section — omitted entirely when empty.
                  Mockup intent: no empty-state clutter; built-ins carry
                  day-one workspaces. */}
              {yourTemplates.length > 0 && (
                <section>
                  <div style={SECTION_LABEL_STYLE}>
                    <Bookmark size={12} />
                    <span>Your templates</span>
                  </div>
                  <div style={cardGridStyle}>
                    {yourTemplates.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        isSelected={selectedId === t.id}
                        onSelect={() => setSelectedId(t.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* "Starter templates" — always shown when built-ins exist
                  (they should, per slice 2 seed). Falls back to a
                  defensive empty-section message in the unexpected case
                  the seed never ran. */}
              <section>
                <div style={SECTION_LABEL_STYLE}>
                  <Sparkles size={12} />
                  <span>Starter templates</span>
                </div>
                {starterTemplates.length > 0 ? (
                  <div style={cardGridStyle}>
                    {starterTemplates.map((t) => (
                      <TemplateCard
                        key={t.id}
                        template={t}
                        isSelected={selectedId === t.id}
                        onSelect={() => setSelectedId(t.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.45)",
                    }}
                  >
                    No starter templates available.
                  </div>
                )}
              </section>
            </>
          )}

          {createError && (
            <div
              role="alert"
              style={{
                padding: 12,
                background: "rgba(244,63,94,0.08)",
                border: "1px solid rgba(244,63,94,0.3)",
                borderRadius: 8,
                color: "#F43F5E",
                fontSize: 13,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{createError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #2A2A2D",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={onBack}
            disabled={isCreating}
            style={btnGhostStyle(isCreating)}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            style={btnPrimaryStyle(canCreate)}
          >
            {isCreating ? "Creating…" : "Create Pipeline"}
            {!isCreating && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components / styles ────────────────────────────────────────────

function PickerLoadingState() {
  // Lightweight skeleton — three card-shaped placeholders. Matches the
  // grid layout so swapping to real cards is a quiet transition.
  return (
    <div style={cardGridStyle} aria-label="Loading templates">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse"
          aria-hidden
          style={{
            height: 130,
            background: "#2C2C2F",
            border: "1px solid #36363A",
            borderRadius: 12,
          }}
        />
      ))}
    </div>
  );
}

const cardGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

function btnGhostStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid #36363A",
    borderRadius: 8,
    color: "rgba(255,255,255,0.75)",
    fontSize: 13,
    fontWeight: 500,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function btnPrimaryStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    background: "#108CE9",
    border: "1px solid #108CE9",
    borderRadius: 8,
    color: "white",
    fontSize: 13,
    fontWeight: 600,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.5,
  };
}
