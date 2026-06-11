"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Pending member invite for the /w/[slug]/p/[pipeline-id]/clients page's
 * Members sub-tab. Same shape as PipelineClientInvite but specifically
 * for role='member' rows in client_invites (PI-1+ added the role column).
 */
export type PipelineMemberInvite = {
  token: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: string | null;
  inviterDisplayName: string | null;
  inviterEmail: string | null;
};

/**
 * A current team member on a pipeline. Filtered to pipeline_memberships
 * rows where role IN ('admin', 'member') — clients live in the parallel
 * usePipelineClientsData hook + Clients sub-tab.
 *
 * Carries `role` so the roster row can render an admin / member badge.
 */
export type PipelineMember = {
  userId: string;
  role: "admin" | "member";
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
};

export type PipelineMembersDataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      pipelineName: string;
      workspaceSlug: string;
      workspaceName: string;
      invites: PipelineMemberInvite[];
      members: PipelineMember[];
      refetch: () => Promise<void>;
    };

/**
 * Mirror of usePipelineClientsData for the Members sub-tab. Three queries
 * in parallel (invites, memberships, pipeline metadata) then a profile
 * lookup for name + avatar enrichment.
 *
 *   * Invites: client_invites WHERE pipeline_id = X AND role = 'member'
 *              AND accepted_at IS NULL. PI-6: filters on the role column
 *              added in PI-1 so the Members sub-tab only sees its own
 *              pending invites (not the Clients sub-tab's).
 *   * Members: pipeline_memberships WHERE pipeline_id = X AND role IN
 *              ('admin', 'member'). Both agency-side roles surface in
 *              the Members roster; 'owner' is workspace-level only,
 *              never a pipeline_memberships value via the UI invite
 *              flow, but included in the comparison for defensiveness.
 *   * Pipeline metadata: same query as the clients hook — gives us
 *              pipelineName + workspaceSlug + workspaceName for free.
 *
 * 'admin' role is NOT exposed in the invite form picker yet (PI-6 ships
 * member-only UI per the strategy lock). The roster IS admin-aware —
 * SQL-side admin assignment is allowed and the UI should reflect any
 * admins it sees.
 */
export function usePipelineMembersData(
  pipelineId: string | null,
): PipelineMembersDataState {
  const [state, setState] = useState<PipelineMembersDataState>({
    status: "loading",
  });

  const load = useCallback(async () => {
    if (!pipelineId) {
      setState({ status: "loading" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [invitesResult, membershipsResult, pipelineResult] =
        await Promise.all([
          supabase
            .from("client_invites")
            .select("token, email, created_at, expires_at, invited_by")
            .eq("pipeline_id", pipelineId)
            .eq("role", "member")
            .is("accepted_at", null)
            .order("created_at", { ascending: false }),
          supabase
            .from("pipeline_memberships")
            .select("user_id, role")
            .eq("pipeline_id", pipelineId)
            .in("role", ["admin", "member"]),
          supabase
            .from("pipelines")
            .select("name, workspace:workspaces(name, slug)")
            .eq("id", pipelineId)
            .maybeSingle(),
        ]);

      if (invitesResult.error) throw new Error(invitesResult.error.message);
      if (membershipsResult.error)
        throw new Error(membershipsResult.error.message);
      if (pipelineResult.error) throw new Error(pipelineResult.error.message);
      if (!pipelineResult.data) {
        throw new Error("Pipeline not found or you don't have access to it");
      }

      // PostgREST nested-select-as-array quirk — same pattern as
      // usePipelineClientsData.
      const workspaceRel = pipelineResult.data.workspace as unknown as
        | { name: string; slug: string }
        | { name: string; slug: string }[]
        | null;
      const workspace = Array.isArray(workspaceRel)
        ? workspaceRel[0]
        : workspaceRel;
      const workspaceName = workspace?.name ?? "this workspace";
      const workspaceSlug = workspace?.slug ?? "";
      const pipelineName =
        (pipelineResult.data.name as string | null) ?? "this pipeline";

      // Collect every user_id we'll need a profile for (inviters + members).
      const userIds = Array.from(
        new Set([
          ...((invitesResult.data ?? [])
            .map((i) => i.invited_by as string | null)
            .filter(Boolean) as string[]),
          ...((membershipsResult.data ?? []).map(
            (m) => m.user_id as string,
          )),
        ]),
      );

      const profileMap: Record<
        string,
        {
          display_name: string | null;
          email: string;
          avatar_url: string | null;
        }
      > = {};
      if (userIds.length > 0) {
        const profilesResult = await supabase
          .from("profiles")
          .select("id, display_name, email, avatar_url")
          .in("id", userIds);
        if (profilesResult.error) {
          throw new Error(profilesResult.error.message);
        }
        for (const p of profilesResult.data ?? []) {
          profileMap[p.id as string] = {
            display_name: p.display_name as string | null,
            email: p.email as string,
            avatar_url: p.avatar_url as string | null,
          };
        }
      }

      const invites: PipelineMemberInvite[] = (invitesResult.data ?? []).map(
        (i) => ({
          token: i.token as string,
          email: i.email as string,
          createdAt: i.created_at as string,
          expiresAt: i.expires_at as string,
          invitedBy: (i.invited_by as string | null) ?? null,
          inviterDisplayName: i.invited_by
            ? profileMap[i.invited_by as string]?.display_name ?? null
            : null,
          inviterEmail: i.invited_by
            ? profileMap[i.invited_by as string]?.email ?? null
            : null,
        }),
      );

      const members: PipelineMember[] = (membershipsResult.data ?? [])
        .map((m) => {
          const userId = m.user_id as string;
          const prof = profileMap[userId];
          return {
            userId,
            role: m.role as "admin" | "member",
            displayName: prof?.display_name ?? null,
            email: prof?.email ?? "",
            avatarUrl: prof?.avatar_url ?? null,
          };
        })
        .sort((a, b) => {
          // Admins first, then members. Within group, alphabetical by
          // display name (falling back to email).
          if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
          const aName = (a.displayName || a.email).toLowerCase();
          const bName = (b.displayName || b.email).toLowerCase();
          return aName.localeCompare(bName);
        });

      setState({
        status: "ready",
        pipelineName,
        workspaceSlug,
        workspaceName,
        invites,
        members,
        refetch: load,
      });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [pipelineId]);

  useEffect(() => {
    void load();
  }, [load]);

  return state;
}
