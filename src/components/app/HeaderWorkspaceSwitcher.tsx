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
   *  renders agency contexts split between MY AGENCY (co-working / has
   *  clients) and PERSONAL (solo / empty) sections, with client
   *  memberships in their own CLIENT PORTALS section. */
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
  /** Dropdown alignment relative to the trigger pill.
   *   * "start" (default) — dropdown's LEFT edge aligns with trigger's
   *      left edge and extends rightward. Right answer when the trigger
   *      lives on the LEFT side of the top bar (AppShell).
   *   * "end" — dropdown's RIGHT edge aligns with trigger's right edge
   *      and extends LEFTWARD. Right answer when the trigger lives on
   *      the RIGHT side of the top bar (PortalShell), so the panel
   *      doesn't overflow the viewport.
   *  Independent of `compact` — these are orthogonal concerns even if
   *  they currently happen to co-vary (PortalShell uses both). */
  align?: "start" | "end";
};

/**
 * Workspace switcher in the AppShell header. One-trigger, three-section
 * dropdown. Top to bottom:
 *
 *   1. MY AGENCY — agency workspaces where the user has co-workers
 *      ((stats.teammates ?? 2) > 1) OR clients (stats.clients > 0).
 *      Defensive default of 2 teammates when stats are missing is
 *      load-bearing: a workspace whose stats batch hasn't returned yet
 *      should appear in MY AGENCY (the safer bucket — a real agency
 *      misclassified to PERSONAL while stats are stale would flicker
 *      across re-renders, which reads as a bug). The cost is that a
 *      genuinely-personal workspace briefly shows under MY AGENCY on
 *      first paint, which corrects itself once stats land — much less
 *      jarring than the inverse.
 *
 *   2. CLIENT PORTALS — pipelines where this user is a client. One row
 *      per agency (so a client on multiple pipelines under the same
 *      agency collapses to one row). Collapsible: default-open when ≤ 3
 *      portals, default-collapsed when > 3.
 *
 *   3. PERSONAL — agency workspaces that are clearly solo: 1 teammate
 *      (just the user) AND 0 clients. Captures the workspace a founder
 *      created for themselves but hasn't populated yet. Still shows
 *      rename/delete affordances on hover — these are real workspaces
 *      the user owns, just labeled by use case rather than treated as
 *      a different kind of thing.
 *
 * Each section header is hidden when its list is empty. A pure-client
 * user (no agency contexts at all) sees a "Create your own workspace"
 * CTA card at the TOP of the dropdown instead of an empty MY AGENCY
 * section — this card routes to /upgrade?source=switcher_empty. The
 * "+ New workspace" button at the bottom is gated on the user having
 * at least one agency context; pure-client users use the CTA card
 * above for that path instead.
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
  align = "start",
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

  // All agency-side workspace rows (deduped). The classification step
  // below splits these into MY AGENCY vs PERSONAL — both render the
  // same row shape via renderAgencyRow, only the heading differs.
  const workspaces = useMemo(() => dedupeAgencyContexts(contexts), [contexts]);
  const activeAgencyCtx = workspaces.find((w) => w.workspaceSlug === activeSlug);
  // Total agency-workspace count across MY AGENCY + PERSONAL. The
  // delete affordance hides when this is 1, because deleting their
  // last workspace would route the user through /select-workspace
  // with nothing to switch to. Per-section count would be wrong here
  // — a user with one MY AGENCY workspace and one PERSONAL workspace
  // can safely delete either.
  const onlyOneWorkspace = workspaces.length <= 1;
  const hasAnyAgencyContext = workspaces.length > 0;

  // MY AGENCY vs PERSONAL classification. The `?? 2` default on
  // teammates and `?? 0` default on clients are both load-bearing:
  // missing stats fall toward MY AGENCY, not PERSONAL — see the
  // component-level doc comment for why.
  const myAgencyContexts = useMemo(
    () =>
      workspaces.filter((c) => {
        const teammates = c.stats?.teammates ?? 2;
        const clients = c.stats?.clients ?? 0;
        return teammates > 1 || clients > 0;
      }),
    [workspaces],
  );
  const personalContexts = useMemo(
    () =>
      workspaces.filter((c) => {
        const teammates = c.stats?.teammates ?? 2;
        const clients = c.stats?.clients ?? 0;
        return teammates === 1 && clients === 0;
      }),
    [workspaces],
  );

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

  // Trigger pill identity. In portal mode it's "Client of: <Agency>"
  // with the agency's tint. Falls back to agency identity otherwise.
  const triggerWorkspaceId = activeClientCtx
    ? activeClientCtx.workspaceId
    : activeAgencyCtx?.workspaceId ?? "fallback";

  // Portal-mode pill: resolve the agency owner's profiles.company_name
  // for the pipeline this client is viewing, falling back to the
  // workspace name when null.
  //
  // Why an RPC instead of a direct query: workspace_memberships_select
  // is gated on is_workspace_member(workspace_id), and clients have no
  // workspace_memberships row → the obvious query returns zero rows for
  // every client. Widening that policy would leak teammate identities.
  // pipeline_memberships_select hides other members' rows from clients
  // for the same reason, so we can't read the owner's pipeline row
  // either. The SECURITY DEFINER RPC
  // `get_pipeline_workspace_owner_company` (migration
  // 20260617120000) is the narrowest fix: it traverses the owner ladder
  // internally and returns ONLY the owner's company_name, with an
  // authorization guard that the caller must have a pipeline_memberships
  // row on the requested pipeline. See the migration header for the full
  // rationale.
  //
  // Keyed on pipelineId (the RPC's required input). Self-contained — no
  // useUserContexts contract change. One small RPC per portal
  // navigation.
  const [ownerCompanyName, setOwnerCompanyName] = useState<string | null>(
    null,
  );
  useEffect(() => {
    const pipelineId = activeClientCtx?.pipelineId;
    if (!pipelineId) {
      setOwnerCompanyName(null);
      return;
    }
    let alive = true;
    void (async () => {
      const { data, error } = await supabase.rpc(
        "get_pipeline_workspace_owner_company",
        { p_id: pipelineId },
      );
      if (!alive) return;
      if (error) {
        // Soft-fail: the pill still renders, just with the workspace
        // name fallback. Don't block the UI on a lookup failure (e.g.
        // network blip, migration not yet applied on this project).
        console.error(
          "[switcher] portal owner company_name lookup failed:",
          error?.message,
          "code:",
          error?.code,
          "details:",
          error?.details,
          "hint:",
          error?.hint,
        );
        setOwnerCompanyName(null);
        return;
      }
      // RPC returns `text` (the owner's company_name) or null. The two
      // null cases — caller has no membership on this pipeline vs. owner
      // has no company_name yet — are deliberately indistinguishable
      // (authorization status doesn't leak through the return). Both
      // collapse to the workspaceName fallback below, which is the
      // correct UX in either case.
      setOwnerCompanyName(
        typeof data === "string" && data.length > 0 ? data : null,
      );
    })();
    return () => {
      alive = false;
    };
  }, [activeClientCtx?.pipelineId]);

  const triggerLabel = activeClientCtx
    ? `Client of: ${ownerCompanyName ?? activeClientCtx.workspaceName}`
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

  // Renders a single agency-style row. Used in BOTH the MY AGENCY and
  // PERSONAL sections — the two sections differ only by their heading,
  // not by per-row behavior. Personal workspaces are still real agency
  // contexts the user can rename, delete, and switch to.
  const renderAgencyRow = (ctx: UserContext) => {
    const isActive = !activeClientCtx && ctx.workspaceSlug === activeSlug;
    const isEditing = editingId === ctx.workspaceId;
    const isBusy = busyId === ctx.workspaceId;
    return (
      <div key={ctx.workspaceId} className="px-2 group">
        {isEditing ? (
          <div className="flex items-center gap-3 px-2 py-2">
            <StagesHashTile workspaceId={ctx.workspaceId} size={40} />
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
            style={{ background: isActive ? "#212939" : "transparent" }}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.background = "#1F1F22";
            }}
            onMouseLeave={(e) => {
              if (!isActive)
                e.currentTarget.style.background = "transparent";
            }}
            onClick={() => switchTo(ctx)}
          >
            <StagesHashTile workspaceId={ctx.workspaceId} size={40} />
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
          className={`absolute mt-2 fade-in z-50 ${
            align === "end" ? "right-0" : "left-0"
          }`}
          style={{ width: "320px" }}
        >
          <div
            style={{
              background: "#1A1A1A",
              border: "1px solid #36363A",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
              overflow: "hidden",
            }}
          >
            {/* Pure-client CTA at the TOP of the dropdown. Shown when
                the user has zero agency workspaces — replaces the
                empty MY AGENCY section AND the "+ New workspace"
                footer (both of which would be useless to this
                persona). Routes to /upgrade, which is the waitlist
                page for the paid plan that unlocks workspace
                creation. */}
            {!hasAnyAgencyContext && (
              <div className="py-1">
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
              </div>
            )}

            {/* Section stack. Cap at ~420px so a user with many
                workspaces still gets the "+ New workspace" footer
                visible without scrolling the whole dropdown. */}
            <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
              {/* ── MY AGENCY ─────────────────────────────────────── */}
              {myAgencyContexts.length > 0 && (
                <div className="py-1">
                  <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                    My Agency
                  </div>
                  {myAgencyContexts.map(renderAgencyRow)}
                </div>
              )}

              {/* ── CLIENT PORTALS ────────────────────────────────── */}
              {clientGroups.length > 0 && (
                <div
                  className={`py-1 ${
                    myAgencyContexts.length > 0 || !hasAnyAgencyContext
                      ? "border-t border-zinc-800"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setPortalSectionOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-3 pt-1.5 pb-1 cursor-pointer"
                    aria-expanded={portalSectionOpen}
                  >
                    <span className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                      Client Portals
                    </span>
                    <ChevronDown
                      size={12}
                      className="text-zinc-500 flex-shrink-0"
                      style={{
                        transform: portalSectionOpen
                          ? "rotate(180deg)"
                          : "none",
                        transition: "transform 0.15s",
                      }}
                    />
                  </button>
                  {portalSectionOpen &&
                    clientGroups.map((group) => {
                      const isActive =
                        !!activeClientCtx &&
                        group.contexts.some(
                          (c) => c.pipelineId === activeClientCtx.pipelineId,
                        );
                      // First context in the group is the navigation
                      // target when there are multiple pipelines under
                      // one agency (no per-pipeline last-visited
                      // tracking today).
                      const target = group.contexts[0]!;
                      const showPipelineSubtitle =
                        group.contexts.length === 1;
                      return (
                        <div key={group.workspaceId} className="px-2">
                          <div
                            className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors"
                            style={{
                              background: isActive
                                ? "#212939"
                                : "transparent",
                            }}
                            onMouseEnter={(e) => {
                              if (!isActive)
                                e.currentTarget.style.background = "#1F1F22";
                            }}
                            onMouseLeave={(e) => {
                              if (!isActive)
                                e.currentTarget.style.background =
                                  "transparent";
                            }}
                            onClick={() => switchToPortal(target)}
                          >
                            <StagesHashTile
                              workspaceId={group.workspaceId}
                              size={40}
                            />
                            <div className="flex-1 min-w-0">
                              {/* CLIENT PORTALS rows stay on
                                  workspaceName, NOT company_name —
                                  the company-name RPC only feeds the
                                  active-pill label, not the row
                                  labels here (each row would need its
                                  own pipeline-scoped RPC call, which
                                  isn't worth the wattage for a list
                                  that's already grouped by agency). */}
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

              {/* ── PERSONAL ──────────────────────────────────────── */}
              {personalContexts.length > 0 && (
                <div
                  className={`py-1 ${
                    myAgencyContexts.length > 0 || clientGroups.length > 0
                      ? "border-t border-zinc-800"
                      : ""
                  }`}
                >
                  <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                    Personal
                  </div>
                  {personalContexts.map(renderAgencyRow)}
                </div>
              )}
            </div>

            {/* + New workspace global footer. Hidden for pure-client
                users — they get the CTA card at the top instead. */}
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
