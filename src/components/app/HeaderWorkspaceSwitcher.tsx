"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { StagesHashTile } from "@/components/icons/StagesHashTile";
import { urlForContext } from "@/lib/resolveDestination";
import { supabase } from "@/lib/supabase";
import type { UserContext } from "@/hooks/useUserContexts";

type Props = {
  /** All contexts the user has — both agency-side workspace memberships and
   *  pipeline-level memberships (incl. client memberships). The switcher
   *  renders agency contexts in the top panel and client memberships in the
   *  bottom Client Portal panel. */
  contexts: UserContext[];
  /** Slug of the workspace currently in the URL (/w/[slug]). May be null if
   *  the user is on a route outside the /w/[slug] tree (e.g. inside a
   *  /portal/[id] route — in which case the portal-mode detection below
   *  takes over). */
  activeSlug: string | null;
  /** Current user's id, needed to write last_active_workspace_id. */
  userId: string;
  /** Trigger-pill density. AppShell mounts at default (40px tall — matches
   *  its 40px HeaderProfileMenu avatar). PortalShell mounts compact (32px
   *  tall — matches its 32px avatar) so the right-side cluster reads as
   *  one unit. Dropdown panel is unaffected by this prop. */
  compact?: boolean;
};

/**
 * Workspace switcher in the AppShell header. Slice-2 redesign per the
 * Figma reference. Two stacked panels:
 *
 *   1. Agency panel — one row per workspace the user has agency-side
 *      access to (deduped via dedupeAgencyContexts). Each row shows a
 *      tinted Stages "#" tile + workspace name + stat subtitle
 *      ("5 teammates · 12 clients" / "just you · 3 clients" / "5
 *      teammates · 1 project" / "just you"). Existing rename / delete /
 *      switch affordances preserved. Existing green check on the
 *      currently active workspace preserved. "+ Create new workspace"
 *      button at the bottom preserved.
 *
 *   2. Client Portal panel (NEW) — only rendered when the user has at
 *      least one client membership. Collapsible: defaults expanded when
 *      total portal count ≤ 3, collapsed when > 3. Each row shows the
 *      agency workspace name as the title and the pipeline name as the
 *      subtitle. When a user is a client on multiple pipelines under
 *      the SAME agency, those collapse to a single row (no pipeline
 *      subtitle, since no canonical "which one" to show). Clicking
 *      navigates via urlForContext, which already returns
 *      /portal/[pipelineId] for client contexts. The row matching the
 *      pipeline the user is currently inside gets a green-check
 *      selected state, consistent with the agency panel.
 *
 * Trigger pill: always shows the Stages "#" tile + workspace name.
 * In portal mode (URL matches /portal/...) the label is prefixed with
 * "Client of: " and the tile tint hashes from the agency workspace id,
 * not the pipeline id — so it reads as "you're a client of this
 * agency" rather than "you're inside this pipeline."
 *
 * Portal-mode detection lives inline via usePathname() to avoid
 * changing AppShell's prop contract.
 */
export function HeaderWorkspaceSwitcher({
  contexts,
  activeSlug,
  userId,
  compact = false,
}: Props) {
  // Trigger-pill dimensions derived from `compact`. Default (agency
  // mode) sits at 40 to match AppShell's 40px avatar; compact (portal
  // mode) sits at 32 to match PortalShell's 32px avatar. Inner tile
  // scales proportionally so the # mark's visual weight stays roughly
  // ~70% of the pill height in both modes.
  const triggerHeight = compact ? 32 : 40;
  const triggerTileSize = compact ? 22 : 28;
  const triggerPadding = compact ? "0 8px 0 3px" : "0 10px 0 4px";
  const triggerFontSize = compact ? 12 : 13;
  const triggerLabelMaxWidth = compact ? 180 : 200;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setEditingId(null);
        setEditValue("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Agency rows (deduped). Client contexts handled separately below.
  const workspaces = dedupeAgencyContexts(contexts);
  const activeAgencyCtx = workspaces.find((w) => w.workspaceSlug === activeSlug);
  const onlyOneWorkspace = workspaces.length <= 1;
  const hasAnyAgencyContext = contexts.some((c) => c.type === "agency");

  // Portal-mode detection: when the current route is /portal/[pipelineId],
  // figure out which client context owns that pipeline so we can prefix
  // the trigger pill with the agency name + tint the tile from the agency
  // workspace id (NOT the pipeline id — the spec calls for hashing on the
  // agency, since that's the identity the client recognizes).
  const portalPipelineMatch = pathname?.match(/^\/portal\/([^/]+)/);
  const activePortalPipelineId = portalPipelineMatch
    ? portalPipelineMatch[1]
    : null;
  const clientContexts = useMemo(
    () => contexts.filter((c) => c.type === "client"),
    [contexts],
  );
  const activeClientCtx = activePortalPipelineId
    ? clientContexts.find((c) => c.pipelineId === activePortalPipelineId)
    : null;

  // Group client contexts by agency workspace. One row per agency. If
  // the user is a client on multiple pipelines under the same agency,
  // those collapse to a single row whose label hides the pipeline name
  // (no canonical "which one" — we lack per-pipeline last-visited
  // tracking today). Clicking such a row navigates to the first
  // pipeline in the group — documented v1 behavior; revisit when we
  // ship last_active_pipeline_id per-user-per-workspace.
  const clientGroups = useMemo(() => groupClientByAgency(clientContexts), [
    clientContexts,
  ]);

  // Client Portal section collapse default: expanded when ≤ 3 portals,
  // collapsed when > 3 (per spec). The chevron is always present.
  const [portalSectionOpen, setPortalSectionOpen] = useState(
    clientGroups.length <= 3,
  );
  // Re-sync the default when the user's memberships change underfoot
  // (sign-in / accept-invite / context refresh). Re-running the effect
  // only when group COUNT changes — not contents — so the user's manual
  // toggle isn't yanked back to default on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPortalSectionOpen(clientGroups.length <= 3);
  }, [clientGroups.length]);

  // Trigger pill identity. In portal mode it's "Client of: AgencyName"
  // with the agency's tint. Falls back to agency identity otherwise.
  const triggerWorkspaceId = activeClientCtx
    ? activeClientCtx.workspaceId
    : activeAgencyCtx?.workspaceId ?? "fallback";
  const triggerLabel = activeClientCtx
    ? `Client of: ${activeClientCtx.workspaceName}`
    : activeAgencyCtx?.workspaceName ?? "Workspace";

  const startEdit = (ctx: UserContext) => {
    setEditingId(ctx.workspaceId);
    setEditValue(ctx.workspaceName);
  };

  const commitEdit = async () => {
    if (!editingId || !editValue.trim()) {
      setEditingId(null);
      setEditValue("");
      return;
    }
    setBusyId(editingId);
    const newName = editValue.trim();
    const { error } = await supabase
      .from("workspaces")
      .update({ name: newName })
      .eq("id", editingId);
    setBusyId(null);
    setEditingId(null);
    setEditValue("");
    if (error) {
      console.error("Workspace rename failed:", error.message);
      return;
    }
    router.refresh();
  };

  const switchTo = (ctx: UserContext) => {
    setOpen(false);
    supabase
      .from("profiles")
      .update({ last_active_workspace_id: ctx.workspaceId })
      .eq("id", userId)
      .select()
      .then(({ error, data }) => {
        if (error) {
          console.error(
            "Failed to persist last_active_workspace_id:",
            error.message,
          );
        } else if (!data || data.length === 0) {
          console.warn(
            "last_active_workspace_id update affected 0 rows — RLS denial or missing profile row?",
          );
        }
      });
    router.push(`/w/${ctx.workspaceSlug}`);
  };

  const switchToPortal = (ctx: UserContext) => {
    setOpen(false);
    // urlForContext returns /portal/[pipelineId] for client contexts —
    // single source of truth shared with the /select-workspace flow.
    router.push(urlForContext(ctx));
  };

  const deleteWorkspace = async (ctx: UserContext) => {
    if (
      !confirm(
        `Delete workspace "${ctx.workspaceName}"? All pipelines, members, and channels in this workspace will be removed. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(ctx.workspaceId);
    const { error } = await supabase
      .from("workspaces")
      .delete()
      .eq("id", ctx.workspaceId);
    setBusyId(null);
    if (error) {
      console.error("Workspace delete failed:", error.message);
      return;
    }
    setOpen(false);
    router.push("/select-workspace");
  };

  const createNew = () => {
    setOpen(false);
    router.push("/onboarding/create-workspace");
  };

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 transition-colors"
        style={{
          background: "#212124",
          border: "1px solid #36363A",
          borderRadius: "8px",
          padding: triggerPadding,
          height: `${triggerHeight}px`,
          color: "#E4E4E7",
          cursor: "pointer",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "#28282C")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "#212124")}
      >
        <StagesHashTile workspaceId={triggerWorkspaceId} size={triggerTileSize} />
        <span
          className="font-semibold truncate"
          style={{
            fontSize: triggerFontSize,
            maxWidth: triggerLabelMaxWidth,
          }}
        >
          {triggerLabel}
        </span>
        <ChevronDown
          size={12}
          className="text-zinc-500"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 mt-2 fade-in z-50 space-y-2"
          style={{ width: "320px" }}
        >
          {/* ── Agency panel ────────────────────────────────────────── */}
          <div
            style={{
              background: "#1A1A1A",
              border: "1px solid #36363A",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              overflow: "hidden",
            }}
          >
            <div className="py-1 max-h-[340px] overflow-y-auto scrollbar-thin">
              {workspaces.map((ctx) => {
                const isActive =
                  !activeClientCtx && ctx.workspaceSlug === activeSlug;
                const isEditing = editingId === ctx.workspaceId;
                const isBusy = busyId === ctx.workspaceId;
                return (
                  <div key={ctx.workspaceId} className="px-2 group">
                    {isEditing ? (
                      <div className="flex items-center gap-3 px-2 py-2">
                        <StagesHashTile
                          workspaceId={ctx.workspaceId}
                          size={40}
                        />
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") {
                              setEditingId(null);
                              setEditValue("");
                            }
                          }}
                          className="flex-1 text-[13px] font-medium"
                          style={{
                            background: "#212124",
                            border: "1px solid #108CE9",
                            borderRadius: "6px",
                            padding: "6px 10px",
                            color: "#E4E4E7",
                            outline: "none",
                          }}
                          disabled={isBusy}
                        />
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors"
                        style={{
                          background: isActive ? "#212939" : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (!isActive)
                            e.currentTarget.style.background = "#1F1F22";
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive)
                            e.currentTarget.style.background = "transparent";
                        }}
                        onClick={() => switchTo(ctx)}
                      >
                        <StagesHashTile
                          workspaceId={ctx.workspaceId}
                          size={40}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-semibold truncate text-white">
                            {ctx.workspaceName}
                          </div>
                          <div className="text-[12px] text-zinc-500 truncate mt-0.5">
                            {formatAgencyStats(ctx.stats)}
                          </div>
                        </div>
                        {isActive && (
                          <Check
                            size={16}
                            className="flex-shrink-0"
                            style={{ color: "#15B981" }}
                            strokeWidth={3}
                          />
                        )}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(ctx);
                            }}
                            className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-200"
                            title="Rename"
                            disabled={isBusy}
                          >
                            <Pencil size={11} />
                          </button>
                          {!onlyOneWorkspace && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void deleteWorkspace(ctx);
                              }}
                              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-rose-400"
                              title="Delete workspace"
                              disabled={isBusy}
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Pure-client empty state — the user has zero agency
                  workspaces, so instead of the dead "No workspaces yet"
                  line, surface a CTA that routes to /upgrade where they
                  can join the paid-plan waitlist. The "+ New workspace"
                  button below this list is already gated on
                  hasAnyAgencyContext so it auto-hides for this persona;
                  this card is the affordance that replaces it. */}
              {workspaces.length === 0 && (
                <div className="px-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      router.push("/upgrade?source=switcher_empty");
                    }}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg transition-colors text-left"
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#1F1F22")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                    style={{ background: "transparent" }}
                  >
                    {/* Brand-tinted tile — uses a stable per-user seed
                        (the userId) so the same pure client always
                        sees the same tint, while different clients
                        see different ones. Picked over a workspace-id
                        hash because the user has no workspace yet. */}
                    <StagesHashTile workspaceId={userId} size={40} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-white">
                        Create your own workspace
                      </div>
                      <div className="text-[12px] text-zinc-500 mt-0.5">
                        Run your own agency on Stages
                      </div>
                    </div>
                    <ArrowRight
                      size={16}
                      className="text-zinc-500 flex-shrink-0"
                    />
                  </button>
                </div>
              )}
            </div>

            {hasAnyAgencyContext && (
              <div className="border-t border-zinc-800 p-1">
                <button
                  onClick={createNew}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-[13px] font-medium text-zinc-400 transition-colors"
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#1F1F22")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                  style={{ background: "transparent" }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      border: "1px solid #36363A",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Plus size={18} className="text-zinc-500" />
                  </div>
                  New workspace
                </button>
              </div>
            )}
          </div>

          {/* ── Client Portal panel (only when user has ≥1 client) ── */}
          {clientGroups.length > 0 && (
            <div
              style={{
                background: "#1A1A1A",
                border: "1px solid #36363A",
                borderRadius: "12px",
                boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => setPortalSectionOpen((v) => !v)}
                className="w-full flex items-center gap-3 px-3 py-2.5 transition-colors"
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#1F1F22")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
                style={{ background: "transparent" }}
                aria-expanded={portalSectionOpen}
              >
                {/* Header tile tints from the FIRST agency, which is a
                    reasonable identity for the section as a whole. The
                    row-level tiles below tint from each individual
                    agency, so this is just a visual anchor. */}
                <StagesHashTile
                  workspaceId={clientGroups[0]!.workspaceId}
                  size={40}
                />
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[14px] font-semibold text-white truncate">
                    Client Portal
                  </div>
                  <div className="text-[12px] text-zinc-500 truncate mt-0.5">
                    {clientGroups.length === 1
                      ? "1 portal"
                      : `${clientGroups.length} portals`}
                  </div>
                </div>
                <ChevronDown
                  size={14}
                  className="text-zinc-500 flex-shrink-0"
                  style={{
                    transform: portalSectionOpen ? "rotate(180deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                />
              </button>

              {portalSectionOpen && (
                <div className="border-t border-zinc-800 py-1">
                  {clientGroups.map((group) => {
                    const isActive =
                      !!activeClientCtx &&
                      group.contexts.some(
                        (c) => c.pipelineId === activeClientCtx.pipelineId,
                      );
                    // First context in the group is the navigation target
                    // when there are multiple pipelines under one agency
                    // (no per-pipeline last-visited tracking today).
                    const target = group.contexts[0]!;
                    const showPipelineSubtitle = group.contexts.length === 1;
                    return (
                      <div key={group.workspaceId} className="px-2">
                        <div
                          className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors"
                          style={{
                            background: isActive ? "#212939" : "transparent",
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive)
                              e.currentTarget.style.background = "#1F1F22";
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive)
                              e.currentTarget.style.background = "transparent";
                          }}
                          onClick={() => switchToPortal(target)}
                        >
                          <StagesHashTile
                            workspaceId={group.workspaceId}
                            size={40}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[14px] font-semibold truncate text-white">
                              {group.workspaceName}
                            </div>
                            {showPipelineSubtitle &&
                              target.pipelineName && (
                                <div className="text-[12px] text-zinc-500 truncate mt-0.5">
                                  {target.pipelineName}
                                </div>
                              )}
                          </div>
                          {isActive && (
                            <Check
                              size={16}
                              className="flex-shrink-0"
                              style={{ color: "#15B981" }}
                              strokeWidth={3}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Deduplicate contexts to one entry per workspace, agency-side only. */
function dedupeAgencyContexts(contexts: UserContext[]): UserContext[] {
  const seen = new Map<string, UserContext>();
  for (const ctx of contexts) {
    if (ctx.type !== "agency") continue;
    const existing = seen.get(ctx.workspaceId);
    if (!existing) {
      seen.set(ctx.workspaceId, ctx);
      continue;
    }
    // Prefer workspace-source over pipeline-source (broader access wins) —
    // same precedence as resolveDestination.ts when contexts overlap.
    if (existing.source === "pipeline" && ctx.source === "workspace") {
      seen.set(ctx.workspaceId, ctx);
    }
  }
  return Array.from(seen.values());
}

type ClientGroup = {
  workspaceId: string;
  workspaceName: string;
  contexts: UserContext[];
};

/** Group client contexts by agency workspace. Same agency, multiple
 *  pipelines → one row whose label hides the pipeline name (no per-
 *  pipeline last-visited yet, so we lack a canonical "which one"). */
function groupClientByAgency(contexts: UserContext[]): ClientGroup[] {
  const seen = new Map<string, ClientGroup>();
  for (const ctx of contexts) {
    if (ctx.type !== "client") continue;
    let group = seen.get(ctx.workspaceId);
    if (!group) {
      group = {
        workspaceId: ctx.workspaceId,
        workspaceName: ctx.workspaceName,
        contexts: [],
      };
      seen.set(ctx.workspaceId, group);
    }
    group.contexts.push(ctx);
  }
  return Array.from(seen.values());
}

/**
 * Stat-subtitle text per the Figma. Branching rules:
 *   teammates 1 (solo)   → "just you"
 *   teammates N          → "N teammates"
 *   + clients M > 0      → "... · M clients"
 *   + projects K > 0 AND clients === 0 → "... · K project(s)"
 *
 * The "projects only when no clients" rule matches the Figma's Personal
 * workspace ("5 teammates · 1 project") vs. Acme agency ("5 teammates ·
 * 12 clients") — the second appendix is whichever dimension better
 * captures what the workspace is FOR. If both stats are zero we drop
 * the suffix entirely and show only the teammate phrase.
 */
function formatAgencyStats(stats: UserContext["stats"]): string {
  if (!stats) return "";
  const teammatePhrase =
    stats.teammates === 1 ? "just you" : `${stats.teammates} teammates`;
  if (stats.clients > 0) {
    const plural = stats.clients === 1 ? "client" : "clients";
    return `${teammatePhrase} · ${stats.clients} ${plural}`;
  }
  if (stats.projects > 0) {
    const plural = stats.projects === 1 ? "project" : "projects";
    return `${teammatePhrase} · ${stats.projects} ${plural}`;
  }
  return teammatePhrase;
}
