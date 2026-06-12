"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Pending member invite for the /w/[slug]/p/[pipeline-id]/clients page's
 * Members sub-tab. Defensively rendered post-PI-followup-1 — no new
 * member-role email invites can be created (API hard-rejects them),
 * but rows that landed from the PI-6 window still need to render so
 * Jordan can Resend / Revoke them.
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
 * rows where role IN ('admin', 'member').
 */
export type PipelineMember = {
  userId: string;
  role: "admin" | "member";
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
};

/**
 * PI-followup-1: an existing workspace seat that's NOT yet on this
 * pipeline. The Members sub-tab's picker enumerates these so the agency
 * owner can click-to-add. Source: workspace_memberships for the parent
 * workspace MINUS anyone already in pipeline_memberships for this
 * pipeline (regardless of role — clients are also excluded so a
 * client-on-this-pipeline isn't accidentally promoted to member; that's
 * a server-side error anyway since pipeline_memberships PK is
 * (pipeline_id, user_id) and the row already exists).
 */
export type PipelineAddableMember = {
  userId: string;
  workspaceRole: "owner" | "admin" | "member";
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
      addable: PipelineAddableMember[];
      refetch: () => Promise<void>;
    };

/**
 * Hook for the Members sub-tab. Queries in three rounds:
 *   1. Parallel: pending member invites + pipeline_memberships +
 *      pipeline metadata (incl. workspace_id).
 *   2. workspace_memberships for the parent workspace — needs round 1
 *      to resolve so we know the workspace_id.
 *   3. profiles enrichment for every user_id referenced.
 *
 * Addable list = wsMembers MINUS pipeline_memberships' user_ids.
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
            .select("name, workspace_id, workspace:workspaces(id, name, slug)")
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

      // PostgREST nested-select-as-array quirk — same normalize pattern as
      // elsewhere.
      const workspaceRel = pipelineResult.data.workspace as unknown as
        | { id: string; name: string; slug: string }
        | { id: string; name: string; slug: string }[]
        | null;
      const workspace = Array.isArray(workspaceRel)
        ? workspaceRel[0]
        : workspaceRel;
      const workspaceName = workspace?.name ?? "this workspace";
      const workspaceSlug = workspace?.slug ?? "";
      const workspaceId = workspace?.id ?? null;
      const pipelineName =
        (pipelineResult.data.name as string | null) ?? "this pipeline";

      // Round 2: workspace_memberships. Skipped defensively when
      // workspaceId is somehow null (shouldn't happen — pipeline FK
      // requires workspace_id NOT NULL).
      const wsMembershipsResult = workspaceId
        ? await supabase
            .from("workspace_memberships")
            .select("user_id, role")
            .eq("workspace_id", workspaceId)
        : { data: [], error: null };
      if (wsMembershipsResult.error) {
        throw new Error(wsMembershipsResult.error.message);
      }

      // ALL user_ids needing a profile fetch: inviters + pipeline members
      // + workspace members. Single round-3 batch.
      const userIds = Array.from(
        new Set([
          ...((invitesResult.data ?? [])
            .map((i) => i.invited_by as string | null)
            .filter(Boolean) as string[]),
          ...((membershipsResult.data ?? []).map(
            (m) => m.user_id as string,
          )),
          ...((wsMembershipsResult.data ?? []).map(
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
          if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
          const aName = (a.displayName || a.email).toLowerCase();
          const bName = (b.displayName || b.email).toLowerCase();
          return aName.localeCompare(bName);
        });

      // Addable = workspace_memberships MINUS pipeline_memberships.
      // PI-followup-1: this is the picker's source. Workspace owners +
      // admins + members all show up — Jordan picks which to scope to
      // this pipeline.
      const pipelineMemberUserIds = new Set(
        (membershipsResult.data ?? []).map((m) => m.user_id as string),
      );
      const addable: PipelineAddableMember[] = (wsMembershipsResult.data ?? [])
        .filter((wm) => !pipelineMemberUserIds.has(wm.user_id as string))
        .map((wm) => {
          const userId = wm.user_id as string;
          const prof = profileMap[userId];
          return {
            userId,
            workspaceRole: wm.role as "owner" | "admin" | "member",
            displayName: prof?.display_name ?? null,
            email: prof?.email ?? "",
            avatarUrl: prof?.avatar_url ?? null,
          };
        })
        .sort((a, b) => {
          // Alphabetical by display name, falling back to email.
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
        addable,
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
