"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
        console.error("[app-shell] header-search pipelines fetch failed:", error);
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
    <div className="min-h-screen flex flex-col" style={{ background: "#212124" }}>
      <header
        className="border-b border-zinc-800 sticky top-0 z-40"
        style={{
          background: "#121212",
          height: "64px",
        }}
      >
        {/* Inner container matches the dashboard body's max-w-[1200px] +
            px-4/sm:px-6 so the workspace switcher's left edge and the
            avatar's right edge align with the cards below. Header
            background still spans the full viewport (sticky bar). */}
        {/* Flat flex row matching the figma header layout:
              [logo] [switcher] [search flex-1] [pipeline] [avatar]
            Consistent 16px gap between every element. Search bar is the
            only flexible element — it absorbs all remaining space; the
            others sit at their natural width. No max-width cap on search:
            it spans whatever's left between switcher and Pipeline button. */}
        <div
          className="max-w-[1600px] mx-auto px-6 sm:px-12 h-full flex items-center"
          style={{ gap: "16px" }}
        >
          {/* Logo — clicking routes to the active workspace's dashboard
              (or workspace selector if no active slug). Standard webapp
              pattern (Linear, Notion, Slack all do this). Falls back to
              `/` if activeSlug isn't resolved yet — won't happen on
              normal /w/[slug]/* navigation since the URL has the slug. */}
          <Link
            href={activeSlug ? `/w/${activeSlug}` : "/"}
            className="flex-shrink-0 flex items-center transition-opacity"
            style={{ cursor: "pointer" }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            aria-label="Go to dashboard"
          >
            <StagesLogo size={28} />
          </Link>

          {/* Workspace switcher. Empty slot during the brief load window
              (no placeholder flash). */}
          {session.status === "authenticated" && contexts.status === "ready" && (
            <HeaderWorkspaceSwitcher
              contexts={contexts.contexts}
              activeSlug={activeSlug}
              userId={session.user.id}
            />
          )}

          {/* Header search — real interactive input as of 2026-05-25.
              Was a styled placeholder div through Phase 4a; now wires
              the reserved ⌘K binding to focus the input and runs a
              client-side substring filter over the active workspace's
              pipelines (name + company). flex-1 absorbs leftover
              header space; hidden below md so mobile chrome stays
              tight. See HeaderSearch.tsx for v1 scope decisions. */}
          <HeaderSearch
            pipelines={searchPipelines}
            status={searchStatus}
            workspaceSlug={activeSlug}
          />

          {/* + Pipeline button — only on workspace-scoped routes where
              activeSlug is known AND the current user is a workspace
              owner/admin. Members and pipeline-only agency users have
              this hidden; the flex-1 search bar to its left grows to
              fill the freed space, no layout jump. */}
          {activeSlug && canCreatePipeline && (
            <button
              type="button"
              onClick={() => router.push(`/w/${activeSlug}/p/new`)}
              className="flex items-center gap-1.5 text-[14px] font-medium text-white flex-shrink-0 transition-opacity"
              style={{
                background: "#108CE9",
                height: 40,
                padding: "0 16px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Plus size={14} strokeWidth={2.5} />
              Pipeline
            </button>
          )}

          {/* Avatar */}
          {session.status === "authenticated" && contexts.status === "ready" && (
            <HeaderProfileMenu
              email={session.user.email ?? ""}
              displayName={contexts.profile.displayName}
              avatarUrl={contexts.profile.avatarUrl}
            />
          )}
        </div>
      </header>

      {/* Children render below the persistent header. Each view (ClientList,
          ClientBoard, StagePage) is responsible for its own view-specific
          chrome (search bars, back buttons, breadcrumbs, action buttons). */}
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
