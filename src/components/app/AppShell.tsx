"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, PanelLeft, Settings } from "lucide-react";
import { StagesLogo } from "@/components/icons/StagesLogo";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { HeaderWorkspaceSwitcher } from "@/components/app/HeaderWorkspaceSwitcher";
import { HeaderProfileMenu } from "@/components/app/HeaderProfileMenu";
import {
  HeaderSearch,
  type HeaderSearchPipeline,
  type HeaderSearchStatus,
} from "@/components/app/HeaderSearch";
import { Sidebar } from "@/components/app/Sidebar";
import { supabase } from "@/lib/supabase";

type Props = {
  children: ReactNode;
};

/**
 * Persistent app-shell chrome for authenticated agency-side views. Wraps
 * ClientList, ClientBoard, and StagePage at /w/[slug]. Renders the 64px
 * header with logo + workspace switcher (left) and profile menu (right);
 * children render below.
 *
 * KNOWN TRANSITIONAL STATE (Phase 3.4 → 4):
 * The workspace switcher fetches real Supabase data (via useUserContexts).
 * Switching workspaces updates the URL (/w/[new-slug]) and writes
 * profiles.last_active_workspace_id. But the views below render in-memory
 * stub data via useAppState — they do NOT honor the active workspace from
 * the URL. This is intentional and documented in CLAUDE.md → "Known
 * transitional state (Phase 3.4 → 4)". Phase 4 wires real Supabase queries
 * inside the views, at which point switching will change displayed data.
 */
export function AppShell({ children }: Props) {
  const session = useSession();
  const contexts = useUserContexts();
  const router = useRouter();
  // Active workspace slug. When mounted inside /w/[slug]/*, it comes
  // straight from the route params. When mounted on workspace-agnostic
  // routes like /settings/*, there's no [slug] param — fall back to the
  // user's last_active_workspace_id resolved through their contexts. That
  // makes the switcher button label show the user's last workspace as a
  // "this is what you'd open by default" hint, even though the current
  // page isn't workspace-scoped. Clicking any workspace in the dropdown
  // still routes to /w/[slug] and leaves the agnostic page (decision 5
  // from the step 8 plan).
  const params = useParams();
  const slugFromUrl =
    typeof params?.slug === "string" ? params.slug : null;
  const lastActiveSlug =
    contexts.status === "ready" && contexts.lastActiveWorkspaceId
      ? contexts.contexts.find(
          (c) => c.workspaceId === contexts.lastActiveWorkspaceId,
        )?.workspaceSlug ?? null
      : null;
  const activeSlug = slugFromUrl ?? lastActiveSlug;

  // Role gate for the "+ Pipeline" header button. Only workspace-level
  // owners + admins can create pipelines (matches the
  // is_workspace_owner_or_admin gate on the create_pipeline_with_channels
  // RPC). Members + pipeline-only agency users see the button hidden;
  // the search bar's flex-1 absorbs the freed space.
  //
  // Connects to the plan model: Solo ($29/mo, single-user, always owner
  // → always sees the button) and Team ($39/mo/user, multi-role, only
  // owner/admin in a given workspace sees it). In multi-workspace
  // setups, the role is per-workspace, so the same user can have the
  // button visible in workspace A (their own) and hidden in workspace B
  // (where they're a member).
  //
  // While contexts is loading, canCreatePipeline is false (no flash of
  // button); once contexts ready, the right state renders.
  const activeWorkspaceContext =
    contexts.status === "ready" && activeSlug
      ? contexts.contexts.find(
          (c) =>
            c.workspaceSlug === activeSlug &&
            c.type === "agency" &&
            c.source === "workspace",
        ) ?? null
      : null;
  const canCreatePipeline =
    activeWorkspaceContext?.role === "owner" ||
    activeWorkspaceContext?.role === "admin";

  // ── Pure-client mode detection (2026-05-26, Tier-A fix) ──────────────
  // A "pure client" is a signed-in user who has zero agency contexts —
  // i.e., they only appear in pipeline_memberships with role='client',
  // never in workspace_memberships (and never in pipeline_memberships
  // with an agency role). For these users we suppress agency chrome:
  //   * workspace switcher (no workspaces to switch between)
  //   * +Pipeline button (they can't create pipelines)
  //   * "Create workspace" item inside the switcher dropdown
  //     (defense in depth — switcher is hidden, but the item is
  //     also gated inside HeaderWorkspaceSwitcher itself; see A3)
  // And we replace the switcher with a "← Back to portal" link
  // pointing to their client portal (A2).
  //
  // PURE UI gate. No redirect, no auth-layer change. When
  // hasAnyAgencyContext is true, render path is byte-for-byte identical
  // to pre-fix behavior — agency users see no difference.
  //
  // While contexts.status is "loading", we assume agency until proven
  // otherwise (hasAnyAgencyContext: true) — avoids a brief flash of
  // client-mode chrome at login for agency users.
  const hasAnyAgencyContext =
    contexts.status !== "ready"
      ? true
      : contexts.contexts.some((c) => c.type === "agency");

  // For the A2 "Back to portal" link: collect this user's client
  // contexts. If exactly one, link directly to its portal; if multiple,
  // link to /select-workspace so the user can pick.
  const clientContexts =
    contexts.status === "ready"
      ? contexts.contexts.filter(
          (c): c is typeof c & { pipelineId: string } =>
            c.type === "client" && typeof c.pipelineId === "string",
        )
      : [];
  const backToPortalHref =
    clientContexts.length === 1
      ? `/portal/${clientContexts[0].pipelineId}`
      : clientContexts.length > 1
        ? "/select-workspace"
        : null;

  // ── Header search: active workspace's pipelines for in-memory filter
  // One fetch per active-workspace change. The list is small (low-
  // double-digits per agency), client-side filter is trivially fast
  // — no debounce, no per-keystroke DB round-trip. Swap to a debounced
  // ilike query if a workspace ever crosses ~100 pipelines.
  //
  // Refetch triggers: workspaceId change (switching workspaces). NOT
  // re-fetched when the user creates a new pipeline in another tab —
  // that's a future polish (window-focus listener or supabase realtime
  // subscription); for v1, refresh the page to see new ones in search.
  const activeWorkspaceId = activeWorkspaceContext?.workspaceId ?? null;
  const [searchPipelines, setSearchPipelines] = useState<HeaderSearchPipeline[]>([]);
  const [searchStatus, setSearchStatus] = useState<HeaderSearchStatus>("loading");

  // Sidebar collapse — Figma V2's sidebar-toggle icon in the header.
  // Local UI state only, not persisted; matches the icon's apparent role
  // as a quick show/hide rather than a saved preference.
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!activeWorkspaceId) {
      // No agency context yet (contexts loading, or user not an agency
      // member of the URL's workspace). Mark "ready" with empty list
      // so HeaderSearch shows its "Choose a workspace…" hint instead
      // of an indefinite Loading…
      setSearchPipelines([]);
      setSearchStatus("ready");
      return;
    }
    let cancelled = false;
    setSearchStatus("loading");
    void (async () => {
      const { data, error } = await supabase
        .from("pipelines")
        .select("id, name, company, emoji")
        .eq("workspace_id", activeWorkspaceId)
        .order("last_edited_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error(
          "[app-shell] header-search pipelines fetch failed:",
          error?.message,
          "code:",
          error?.code,
          "details:",
          error?.details,
          "hint:",
          error?.hint,
        );
        setSearchPipelines([]);
        setSearchStatus("error");
        return;
      }
      setSearchPipelines(data ?? []);
      setSearchStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  return (
    // Header is a flat, full-width strip flush with the true viewport edges
    // — NOT part of the rounded/stroked panel below it. Only the
    // sidebar+content region gets the rounded-card, "leave space between
    // all edges" treatment from Figma V2. Keeping these as two separate
    // elements (rather than one bordered wrapper around everything) is
    // deliberate per Jordan's correction — the top bar has its own flat
    // edge-to-edge look with no stroke or corner radius.
    <div style={{ height: "100vh", background: "#000000", display: "flex", flexDirection: "column" }}>
      <header
        className="flex-shrink-0"
        style={{
          background: "#000000",
          height: "44px",
        }}
      >
        {/* Three-column grid, not a flat flex row: [left: switcher+toggle]
            [middle: logo+search, CENTERED within this column] [right:
            create/settings/avatar]. The middle column's width is
            everything left over after the two fixed-width edge columns,
            and its content is centered inside it — so the logo+search
            cluster sits centered over the "home screen" content area
            (which starts right where the sidebar-aligned left column
            ends), not dumped against the left edge with a single trailing
            spacer soaking up all the empty space on one side. */}
        <div
          className="h-full grid items-center"
          style={{
            gridTemplateColumns: "auto 1fr auto",
            columnGap: "16px",
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
        <div className="flex items-center" style={{ gap: "16px" }}>
          {/* Workspace switcher — agency-only. Hidden for pure clients
              (no workspaces to switch between, no "Create workspace"
              affordance they should see). Empty slot during the brief
              load window (no placeholder flash). See hasAnyAgencyContext
              derivation above for the 2026-05-26 Tier-A boundary fix. */}
          {session.status === "authenticated" &&
            contexts.status === "ready" &&
            hasAnyAgencyContext && (
              <HeaderWorkspaceSwitcher
                contexts={contexts.contexts}
                activeSlug={activeSlug}
                userId={session.user.id}
                triggerWidth={236}
                triggerHeight={30}
                compact
              />
            )}

          {/* "← Back to portal" link — pure-client mode only (A2). Sits
              in the same slot the switcher would have occupied so the
              header layout doesn't shift. Renders only when:
                * user is signed-in
                * has zero agency contexts (so no switcher)
                * has at least one client context to navigate to
              When the user has exactly one client context, links
              directly to that portal; multiple → /select-workspace. */}
          {session.status === "authenticated" &&
            contexts.status === "ready" &&
            !hasAnyAgencyContext &&
            backToPortalHref && (
              <Link
                href={backToPortalHref}
                className="flex items-center gap-1.5 flex-shrink-0 transition-colors text-[13px]"
                style={{
                  color: "#E4E4E7",
                  background: "#212124",
                  border: "1px solid #36363A",
                  borderRadius: 8,
                  padding: "0 12px",
                  height: 36,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#28282C")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#212124")
                }
                aria-label="Back to portal"
              >
                <ArrowLeft size={14} strokeWidth={2.5} />
                Back to portal
              </Link>
            )}

          {/* Sidebar-toggle — Figma V2. Only meaningful when a sidebar
              could actually render; hidden otherwise (pure clients,
              workspace-agnostic routes) so it never looks clickable with
              nothing to toggle. */}
          {hasAnyAgencyContext && activeSlug && (
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-pressed={sidebarOpen}
              className="flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "transparent",
                border: "none",
                color: "#979393",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <PanelLeft size={17} />
            </button>
          )}
        </div>

        {/* Middle column — logo + search, centered within the leftover
            width after the two fixed edge columns. */}
        <div className="flex items-center justify-center" style={{ gap: "16px" }}>
          {/* Small brand mark — moved here from the header's far-left slot
              per the Figma V2 layout, which places it beside the search
              bar rather than as the header's leading element. Still links
              home. */}
          <Link
            href={activeSlug ? `/w/${activeSlug}` : "/"}
            className="flex-shrink-0 flex items-center transition-opacity"
            style={{ cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            aria-label="Go to dashboard"
          >
            <StagesLogo size={22} />
          </Link>

          {/* Header search — real interactive input as of 2026-05-25.
              Was a styled placeholder div through Phase 4a; now wires
              the reserved ⌘K binding to focus the input and runs a
              client-side substring filter over the active workspace's
              pipelines (name + company). Fixed width (Figma V2) — this
              column centers it rather than letting it stretch. Hidden
              below md so mobile chrome stays tight. See HeaderSearch.tsx
              for v1 scope decisions. */}
          <HeaderSearch
            pipelines={searchPipelines}
            status={searchStatus}
            workspaceSlug={activeSlug}
          />

          {/* Quick-create — sits directly beside the search bar with the
              same 16px gap the logo mark uses on its other side, so the
              search bar reads as symmetrically bracketed (logo | search |
              +), not grouped with the settings/avatar cluster on the far
              right. Icon size matches Settings (17px) so the two read as
              the same visual weight. Same underlying action and owner/
              admin gating as before; only position + icon size changed. */}
          {activeSlug && canCreatePipeline && hasAnyAgencyContext && (
            <button
              type="button"
              onClick={() => router.push(`/w/${activeSlug}/p/new`)}
              aria-label="New project"
              className="flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#979393",
                border: "none",
                color: "#000000",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Plus size={9} strokeWidth={2.5} />
            </button>
          )}
        </div>

        <div className="flex items-center" style={{ gap: "16px", marginRight: 16 }}>
          {/* Settings — Figma V2 adds a standalone gear icon in the
              header. Routes to the existing account settings page;
              there's no per-workspace settings landing page today, so
              this points at the one settings surface that already
              exists rather than inventing a new destination. */}
          {session.status === "authenticated" && (
            <Link
              href="/settings/account"
              aria-label="Settings"
              className="flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "transparent",
                color: "#979393",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#232326")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <Settings size={17} />
            </Link>
          )}

          {/* Avatar */}
          {session.status === "authenticated" && contexts.status === "ready" && (
            <HeaderProfileMenu
              email={session.user.email ?? ""}
              displayName={contexts.profile.displayName}
              avatarUrl={contexts.profile.avatarUrl}
              size={30}
            />
          )}
        </div>
        </div>
      </header>

      {/* Rounded, stroked panel — the ONLY element with the corner radius
          + border treatment. Padding here (not on the outer wrapper) is
          what insets it from the viewport's left/right/bottom edges while
          the header above stays flush. */}
      <div
        className="flex-1 min-h-0"
        style={{ paddingTop: 0, paddingRight: 12, paddingBottom: 12, paddingLeft: 12 }}
      >
        <div
          className="flex h-full"
          style={{
            background: "#212124",
            border: "1px solid #2D2E30",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {hasAnyAgencyContext && activeSlug && sidebarOpen && (
            <Sidebar
              workspaceSlug={activeSlug}
              workspaceId={activeWorkspaceId}
              pipelines={searchPipelines}
            />
          )}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}
