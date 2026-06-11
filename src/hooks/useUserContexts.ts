"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/hooks/useSession";

/**
 * A unified context entry — what the user has access to and how they got it.
 *
 *   * `agency` (source: 'workspace') — workspace_memberships row, role
 *      owner/admin/member. The user has agency-side access to every pipeline
 *      in this workspace.
 *   * `agency` (source: 'pipeline') — pipeline_memberships row with role
 *      owner/admin/member, but no workspace_memberships row. The user has
 *      agency-side access to ONE specific pipeline in this workspace.
 *   * `client` (source: 'pipeline') — pipeline_memberships row with role
 *      'client'. The user has client-portal access to ONE specific pipeline,
 *      restricted to client_visible content.
 *
 * `stats` is populated for AGENCY contexts only (workspaces this user has
 * agency-side access to). Used by the workspace switcher's stat subtitles
 * (e.g. "5 teammates · 12 clients"). Counts come from 3 batched queries
 * aggregated client-side; see fetchWorkspaceStats below. Pure client
 * contexts leave `stats` undefined — clients don't see agency stats.
 */
export type WorkspaceStats = {
  /** Distinct users with workspace_memberships role IN ('owner','admin','member') */
  teammates: number;
  /** Distinct users with pipeline_memberships role = 'client' across pipelines in this workspace */
  clients: number;
  /** Total pipelines in this workspace */
  projects: number;
};

export type UserContext = {
  type: "agency" | "client";
  source: "workspace" | "pipeline";
  role: "owner" | "admin" | "member" | "client";

  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;

  /** WT-5: workspace category. Set for every agency context; undefined
   *  for client contexts (clients see only their pipeline, never the
   *  parent workspace as a first-class concept). Drives switcher
   *  classification, billing UI visibility, settings/team tab
   *  visibility, and pipeline /clients tab visibility. */
  workspaceType?: "agency" | "personal";

  /** Set when source === 'pipeline'. */
  pipelineId?: string;
  pipelineName?: string;

  /** Set only on agency contexts after the stats batch runs. */
  stats?: WorkspaceStats;
};

/**
 * Profile fields surfaced alongside the contexts list. Lives on this hook
 * (rather than a separate useProfile) because we already query profiles for
 * last_active_workspace_id — adding two more columns to that select is free,
 * and keeps the AppShell to a single Supabase round-trip on mount.
 */
export type ProfileSummary = {
  displayName: string | null;
  avatarUrl: string | null;
};

export type UserContextsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      contexts: UserContext[];
      lastActiveWorkspaceId: string | null;
      profile: ProfileSummary;
    };

// Shape of the joined workspace_memberships row. We don't have generated
// Supabase types yet (TODO: `supabase gen types typescript`), so the cast is
// manual. Defensive null checks below cover any malformed rows.
type WorkspaceMembershipRow = {
  role: string;
  workspace: {
    id: string;
    slug: string;
    name: string;
    type: "agency" | "personal";
  } | null;
};

type PipelineMembershipRow = {
  role: string;
  pipeline: {
    id: string;
    name: string;
    workspace: {
      id: string;
      slug: string;
      name: string;
      type: "agency" | "personal";
    } | null;
  } | null;
};

/**
 * Fetches every context the signed-in user has access to. Re-runs whenever
 * the underlying user changes (sign-in / sign-out / different user). Does
 * NOT auto-refresh on membership changes mid-session — if a user accepts a
 * workspace invite while signed in, they need to refresh or sign out and
 * back in. Real-time subscriptions are a future enhancement.
 */
export function useUserContexts(): UserContextsState {
  const session = useSession();
  const userId = session.status === "authenticated" ? session.user.id : null;
  const [state, setState] = useState<UserContextsState>({ status: "loading" });

  useEffect(() => {
    if (!userId) {
      // Not authenticated — keep waiting. SessionState's loading window
      // is short; once it flips to anonymous OR authenticated, this re-runs.
      setState({ status: "loading" });
      return;
    }

    let active = true;
    setState({ status: "loading" });

    const fetchAll = async () => {
      const [wsResult, pmResult, profResult] = await Promise.all([
        supabase
          .from("workspace_memberships")
          .select("role, workspace:workspaces(id, slug, name, type)")
          .eq("user_id", userId),
        supabase
          .from("pipeline_memberships")
          .select(
            "role, pipeline:pipelines(id, name, workspace:workspaces(id, slug, name, type))",
          )
          .eq("user_id", userId),
        supabase
          .from("profiles")
          .select("last_active_workspace_id, display_name, avatar_url")
          .eq("id", userId)
          .single(),
      ]);

      if (!active) return;

      const firstError = wsResult.error || pmResult.error || profResult.error;
      if (firstError) {
        setState({ status: "error", message: firstError.message });
        return;
      }

      const contexts: UserContext[] = [];

      for (const row of (wsResult.data ?? []) as unknown as WorkspaceMembershipRow[]) {
        if (!row.workspace) continue;
        contexts.push({
          type: "agency",
          source: "workspace",
          role: row.role as UserContext["role"],
          workspaceId: row.workspace.id,
          workspaceSlug: row.workspace.slug,
          workspaceName: row.workspace.name,
          workspaceType: row.workspace.type,
        });
      }

      for (const row of (pmResult.data ?? []) as unknown as PipelineMembershipRow[]) {
        if (!row.pipeline || !row.pipeline.workspace) continue;
        const isAgencyCtx = row.role !== "client";
        contexts.push({
          type: row.role === "client" ? "client" : "agency",
          source: "pipeline",
          role: row.role as UserContext["role"],
          workspaceId: row.pipeline.workspace.id,
          workspaceSlug: row.pipeline.workspace.slug,
          workspaceName: row.pipeline.workspace.name,
          // workspaceType is set for agency contexts only — client
          // contexts don't surface the parent workspace as a first-class
          // concept in any UI surface (they live in /portal/*).
          workspaceType: isAgencyCtx ? row.pipeline.workspace.type : undefined,
          pipelineId: row.pipeline.id,
          pipelineName: row.pipeline.name,
        });
      }

      const lastActiveWorkspaceId =
        (profResult.data?.last_active_workspace_id as string | null) ?? null;
      const profile: ProfileSummary = {
        displayName: (profResult.data?.display_name as string | null) ?? null,
        avatarUrl: (profResult.data?.avatar_url as string | null) ?? null,
      };

      // Stats batch — only for AGENCY workspaces. Three parallel queries
      // aggregated client-side: teammate counts, project counts, distinct
      // client counts (joined to pipelines so we can group by workspace).
      // RLS keeps cross-workspace data out of these reads — workspace
      // members see their workspace's rows, no others.
      const agencyWorkspaceIds = Array.from(
        new Set(
          contexts
            .filter((c) => c.type === "agency")
            .map((c) => c.workspaceId),
        ),
      );

      const statsByWorkspaceId = new Map<string, WorkspaceStats>();
      if (agencyWorkspaceIds.length > 0) {
        const [teammatesRows, projectsRows, clientsRows] = await Promise.all([
          supabase
            .from("workspace_memberships")
            .select("workspace_id, user_id, role")
            .in("workspace_id", agencyWorkspaceIds),
          supabase
            .from("pipelines")
            .select("workspace_id, id")
            .in("workspace_id", agencyWorkspaceIds),
          supabase
            .from("pipeline_memberships")
            .select("user_id, pipeline:pipelines(workspace_id)")
            .eq("role", "client"),
        ]);

        if (!active) return;

        // Don't fail the whole hook on a stats error — degrade gracefully
        // to "no subtitle" rather than blocking sign-in. Log for ops.
        const statsErr =
          teammatesRows.error || projectsRows.error || clientsRows.error;
        if (statsErr) {
          console.warn(
            "useUserContexts stats batch failed (rendering without subtitles):",
            statsErr.message,
          );
        } else {
          for (const ws of agencyWorkspaceIds) {
            statsByWorkspaceId.set(ws, {
              teammates: 0,
              clients: 0,
              projects: 0,
            });
          }

          // Teammates: distinct users by workspace with role IN
          // (owner, admin, member). Counting by user_id (not row count)
          // because someone could theoretically have multiple
          // workspace_memberships in the same workspace via a future
          // schema change; staying defensive.
          const teammatesByWs = new Map<string, Set<string>>();
          for (const row of (teammatesRows.data ?? []) as Array<{
            workspace_id: string;
            user_id: string;
            role: string;
          }>) {
            if (!["owner", "admin", "member"].includes(row.role)) continue;
            let set = teammatesByWs.get(row.workspace_id);
            if (!set) {
              set = new Set();
              teammatesByWs.set(row.workspace_id, set);
            }
            set.add(row.user_id);
          }
          for (const [wsId, set] of teammatesByWs.entries()) {
            const s = statsByWorkspaceId.get(wsId);
            if (s) s.teammates = set.size;
          }

          // Projects: simple count by workspace.
          for (const row of (projectsRows.data ?? []) as Array<{
            workspace_id: string;
            id: string;
          }>) {
            const s = statsByWorkspaceId.get(row.workspace_id);
            if (s) s.projects++;
          }

          // Clients: distinct user_id per workspace, joined through pipelines.
          // Cast through unknown — same pattern as the main contexts query
          // above, since Supabase's generated row shape doesn't quite line
          // up with the unflattened JS object shape we actually receive.
          const clientsByWs = new Map<string, Set<string>>();
          for (const row of (clientsRows.data ?? []) as unknown as Array<{
            user_id: string;
            pipeline: { workspace_id: string } | null;
          }>) {
            const wsId = row.pipeline?.workspace_id;
            if (!wsId || !statsByWorkspaceId.has(wsId)) continue;
            let set = clientsByWs.get(wsId);
            if (!set) {
              set = new Set();
              clientsByWs.set(wsId, set);
            }
            set.add(row.user_id);
          }
          for (const [wsId, set] of clientsByWs.entries()) {
            const s = statsByWorkspaceId.get(wsId);
            if (s) s.clients = set.size;
          }

          // Attach stats back onto each agency context.
          for (const ctx of contexts) {
            if (ctx.type === "agency") {
              ctx.stats = statsByWorkspaceId.get(ctx.workspaceId);
            }
          }
        }
      }

      setState({
        status: "ready",
        contexts,
        lastActiveWorkspaceId,
        profile,
      });
    };

    fetchAll().catch((err: unknown) => {
      if (!active) return;
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    });

    return () => {
      active = false;
    };
  }, [userId]);

  return state;
}
