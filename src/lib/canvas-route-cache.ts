import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase-server";
import { fetchCanvasChromeData, type CanvasChromeData } from "./canvas-chrome-data";

/**
 * Cached per-request bundle for every route under
 * `/w/(canvas)/[slug]/p/[pipeline-id]/*`. Phase 4b perf Win #2.
 *
 * Runs ONCE per (slug, pipelineId) per request:
 *   1. Auth gate
 *   2. Workspace membership check (joined to workspaces by slug)
 *   3. Pipeline ↔ workspace match pre-check
 *   4. Parallel: chrome data + caller profile + aggregate task counts
 *
 * Wrapped in `React.cache` so the layout AND each page in the segment
 * can call it without duplicate DB round-trips:
 *   * Layout calls it first → does the real work, redirects on failure.
 *   * Page calls it for defense-in-depth + to access user/chrome/etc.
 *     → React.cache returns the layout's already-computed result. No
 *     DB round-trip, no redundant work.
 *
 * Cache keys: just (slug, pipelineId). Supabase client is created
 * INSIDE the cached function so the cache stays request-scoped without
 * needing identity-stable supabase instances across call sites.
 *
 * REDIRECT BEHAVIOR — IDENTICAL to the pre-hoist per-page code:
 *   * Anonymous user → /auth/signin?next=/w/<slug>/p/<id>
 *   * Authenticated but not a workspace member → /
 *   * Pipeline doesn't belong to this workspace → /w/<slug>
 *   * Chrome fetch failed defensively → /w/<slug>
 *
 * Next's `redirect()` throws a NEXT_REDIRECT error. React.cache
 * stores thrown errors and re-throws them on subsequent calls, so
 * the throw propagates correctly from layout OR pages.
 *
 * SECURITY POSTURE — Defense in depth (CRITICAL — keep both):
 *   * Layout calls this first, gates the entire segment. If it
 *     redirects, no page in the segment runs.
 *   * Pages also call this. If a future refactor accidentally drops
 *     the layout's gate, the page-level call still fires the gate.
 *     Cached so the cost is zero on the happy path.
 *
 * Aggregate task counts (completedTasks / totalTasks): two cheap
 * count(*) aggregates on tasks, joined to stages by pipeline_id.
 * Replaces the per-page pattern where canvas main computed counts
 * from a full task fetch and chat/files/clients hardcoded 0/0.
 * Side effect: tab pages now show accurate counts in the chrome
 * subline (was "0 / 0" pre-hoist — minor UX improvement, no
 * behavioral regression).
 */

export type CanvasRouteBundle = {
  user: { id: string; email: string | null };
  ws: {
    id: string;
    name: string;
    slug: string;
    /** WT-5: workspace category. Drives the LeftRail "Clients" tab
     *  visibility and the /clients page-level server redirect. */
    type: "agency" | "personal";
    role: string;
  };
  chrome: CanvasChromeData;
  callerProfile: {
    display_name: string | null;
    avatar_url: string | null;
  };
  taskCounts: {
    completed: number;
    total: number;
  };
};

export const fetchCanvasRouteBundle = cache(
  async (slug: string, pipelineId: string): Promise<CanvasRouteBundle> => {
    const supabase = await createSupabaseServerClient();
    const nextPath = `/w/${encodeURIComponent(slug)}/p/${encodeURIComponent(pipelineId)}`;

    // ── 1. Auth gate ──────────────────────────────────────────────────
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) {
      redirect(`/auth/signin?next=${encodeURIComponent(nextPath)}`);
    }

    // ── 2. Membership check (workspace-level OR pipeline-level) ───────
    // PI-5a: widen the gate beyond workspace_memberships. RLS already
    // grants pipeline-only agency members (admin / member on
    // pipeline_memberships, no workspace_memberships row) read access
    // to the pipeline via the pipelines_select policy's
    // is_pipeline_agency_member clause (20260509130000); the route
    // gate was the only thing keeping them out.
    //
    // Two queries fire in parallel: the existing workspace_memberships
    // lookup AND a pipeline_memberships lookup keyed to (caller,
    // pipelineId) with the URL slug verified through the embed. First
    // hit wins:
    //
    //   1. workspace_memberships present  → existing path (real role).
    //   2. pipeline_memberships role='client' on this pipeline → redirect
    //      to /portal/[pipelineId] (clients use the portal surface, not
    //      the canvas; mirrors the case-3 redirect in the workspace
    //      dashboard page).
    //   3. pipeline_memberships role IN ('admin','member') → pipeline-
    //      only path. Workspace info comes from the pipeline → workspace
    //      embed; workspaceRole is "" so isWorkspaceOwnerOrAdmin
    //      resolves false in fetchCanvasChromeData and canEditPipeline
    //      is driven by the pipeline-level role only. Same pattern
    //      already in use at src/app/portal/[pipeline-id]/chat/page.tsx.
    //   4. None of the above → redirect "/" (unchanged).
    //
    // WT-5: include workspaces.type so downstream callers (LeftRail
    // Clients-tab visibility, /clients server-side redirect, /settings
    // tab visibility) can branch on category without a second round-trip.
    const [wsMembershipResult, pipMembershipResult] = await Promise.all([
      supabase
        .from("workspace_memberships")
        .select(`role, workspace:workspaces!inner(id, name, slug, type)`)
        .eq("user_id", user.id)
        .eq("workspace.slug", slug)
        .maybeSingle(),
      supabase
        .from("pipeline_memberships")
        .select(
          `role, pipeline:pipelines!inner(workspace_id, workspace:workspaces!inner(id, name, slug, type))`,
        )
        .eq("user_id", user.id)
        .eq("pipeline_id", pipelineId)
        .eq("pipeline.workspace.slug", slug)
        .maybeSingle(),
    ]);

    type WsRow = {
      id: string;
      name: string;
      slug: string;
      type: "agency" | "personal";
    };

    let wsResolved: WsRow | null = null;
    let workspaceRole = "";

    if (wsMembershipResult.data) {
      const wsRaw = wsMembershipResult.data.workspace as unknown;
      wsResolved = Array.isArray(wsRaw)
        ? ((wsRaw[0] as WsRow | undefined) ?? null)
        : ((wsRaw as WsRow | null) ?? null);
      workspaceRole = wsMembershipResult.data.role as string;
    } else if (pipMembershipResult.data) {
      const pipMemRole = pipMembershipResult.data.role as string;

      // Clients arriving at the canvas URL belong on the portal surface.
      // Mirror the workspace dashboard's case-3 redirect rather than
      // letting the agency canvas render with a degraded view.
      if (pipMemRole === "client") {
        redirect(`/portal/${encodeURIComponent(pipelineId)}`);
      }

      // Pipeline-only admin / member path: extract workspace info from
      // the embed. workspaceRole stays "" so the chrome's
      // isWorkspaceOwnerOrAdmin branch returns false — no privilege
      // escalation. canEditPipeline is computed downstream from the
      // pipeline-level role separately.
      const pipRaw = pipMembershipResult.data.pipeline as unknown;
      const pipObj = (Array.isArray(pipRaw) ? pipRaw[0] : pipRaw) as
        | { workspace_id?: string; workspace?: unknown }
        | undefined;
      const wsRaw = pipObj?.workspace as unknown;
      wsResolved = Array.isArray(wsRaw)
        ? ((wsRaw[0] as WsRow | undefined) ?? null)
        : ((wsRaw as WsRow | null) ?? null);
      // workspaceRole stays "" — set explicitly for the reader's benefit.
      workspaceRole = "";
    }

    if (!wsResolved) {
      redirect("/");
    }

    // ── 3. Pipeline ↔ workspace match pre-check ───────────────────────
    const pipelineMatchRes = await supabase
      .from("pipelines")
      .select("id, workspace_id")
      .eq("id", pipelineId)
      .maybeSingle();

    if (
      !pipelineMatchRes.data ||
      pipelineMatchRes.data.workspace_id !== wsResolved.id
    ) {
      redirect(`/w/${slug}`);
    }

    // ── 4. Parallel: chrome + caller profile + aggregate task counts ──
    // Task count aggregates use { count: "exact", head: true } so the
    // server returns just the count (no row data over the wire).
    const [chrome, callerProfileRes, completedRes, totalRes] = await Promise.all([
      fetchCanvasChromeData(
        supabase,
        pipelineId,
        user.id,
        workspaceRole,
      ),
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select("id, stage:stages!inner(pipeline_id)", {
          count: "exact",
          head: true,
        })
        .eq("stage.pipeline_id", pipelineId)
        .eq("done", true),
      supabase
        .from("tasks")
        .select("id, stage:stages!inner(pipeline_id)", {
          count: "exact",
          head: true,
        })
        .eq("stage.pipeline_id", pipelineId),
    ]);

    if (!chrome) {
      // Should not be reachable post-match-check, but defensive: the
      // chrome helper's own internal pipeline lookup may return null
      // (RLS edge case). Same redirect as today's per-page code.
      redirect(`/w/${slug}`);
    }

    return {
      user: { id: user.id, email: user.email ?? null },
      ws: {
        id: wsResolved.id,
        name: wsResolved.name,
        slug: wsResolved.slug,
        type: wsResolved.type,
        // PI-5a: workspaceRole. Real workspace-membership role when the
        // caller passed via workspace_memberships; "" when they passed
        // via pipeline_memberships (no workspace-level role exists for
        // them). Empty string is the same sentinel already used by the
        // portal/chat surface for chrome calls.
        role: workspaceRole,
      },
      chrome,
      callerProfile: {
        display_name: callerProfileRes.data?.display_name ?? null,
        avatar_url: callerProfileRes.data?.avatar_url ?? null,
      },
      taskCounts: {
        completed: completedRes.count ?? 0,
        total: totalRes.count ?? 0,
      },
    };
  },
);
