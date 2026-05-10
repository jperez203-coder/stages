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
 */
export type UserContext = {
  type: "agency" | "client";
  source: "workspace" | "pipeline";
  role: "owner" | "admin" | "member" | "client";

  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;

  /** Set when source === 'pipeline'. */
  pipelineId?: string;
  pipelineName?: string;
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
  workspace: { id: string; slug: string; name: string } | null;
};

type PipelineMembershipRow = {
  role: string;
  pipeline: {
    id: string;
    name: string;
    workspace: { id: string; slug: string; name: string } | null;
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
          .select("role, workspace:workspaces(id, slug, name)")
          .eq("user_id", userId),
        supabase
          .from("pipeline_memberships")
          .select(
            "role, pipeline:pipelines(id, name, workspace:workspaces(id, slug, name))",
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
        });
      }

      for (const row of (pmResult.data ?? []) as unknown as PipelineMembershipRow[]) {
        if (!row.pipeline || !row.pipeline.workspace) continue;
        contexts.push({
          type: row.role === "client" ? "client" : "agency",
          source: "pipeline",
          role: row.role as UserContext["role"],
          workspaceId: row.pipeline.workspace.id,
          workspaceSlug: row.pipeline.workspace.slug,
          workspaceName: row.pipeline.workspace.name,
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
