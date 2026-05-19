"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Pending client invite for the /w/[slug]/p/[pipeline-id]/clients page.
 * Same shape as TeamInvite (agency invites) minus the `role` field —
 * client invites have no role variation, every recipient is a client.
 */
export type PipelineClientInvite = {
  token: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: string | null;
  inviterDisplayName: string | null;
  inviterEmail: string | null;
};

/**
 * A current client on a pipeline. Filtered to pipeline_memberships rows
 * where role='client' — agency-side members (owner/admin/member) live
 * elsewhere in the UI.
 */
export type PipelineClient = {
  userId: string;
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
};

export type PipelineClientsDataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      pipelineName: string;
      workspaceSlug: string;
      workspaceName: string;
      invites: PipelineClientInvite[];
      clients: PipelineClient[];
      refetch: () => Promise<void>;
    };

/**
 * Batched fetch of pending client_invites + client pipeline_memberships
 * for ONE pipeline, joined client-side with profiles + the pipeline /
 * workspace metadata.
 *
 * Same multi-query strategy as `useTeamData`:
 *   * Three queries in parallel where they can be (invites, memberships,
 *     pipeline metadata), then a fourth profile-lookup query to enrich
 *     names and avatars.
 *   * profile lookup is skipped when no user IDs need enriching (no
 *     pending invites with inviters AND no client members yet).
 *
 * The pipeline name + workspace info come from the same pipelines table
 * query, so we get them for free. The hook surfaces them in the ready
 * state so the page can render "Clients of [pipeline] in [workspace]"
 * without an extra round-trip.
 */
export function usePipelineClientsData(
  pipelineId: string | null,
): PipelineClientsDataState {
  const [state, setState] = useState<PipelineClientsDataState>({
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
            .is("accepted_at", null)
            .order("created_at", { ascending: false }),
          supabase
            .from("pipeline_memberships")
            .select("user_id")
            .eq("pipeline_id", pipelineId)
            .eq("role", "client"),
          supabase
            .from("pipelines")
            .select("name, workspace:workspaces(name, slug)")
            .eq("id", pipelineId)
            .maybeSingle(),
        ]);

      if (invitesResult.error) {
        throw new Error(invitesResult.error.message);
      }
      if (membershipsResult.error) {
        throw new Error(membershipsResult.error.message);
      }
      if (pipelineResult.error) {
        throw new Error(pipelineResult.error.message);
      }
      if (!pipelineResult.data) {
        throw new Error(
          "Pipeline not found or you don't have access to it",
        );
      }

      // The PostgREST nested-select-as-array quirk shows up here too
      // (same as the route handlers). Handle both shapes defensively.
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

      // Collect every user_id we'll need a profile for (inviters + clients).
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
        { display_name: string | null; email: string; avatar_url: string | null }
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

      const invites: PipelineClientInvite[] = (invitesResult.data ?? []).map(
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

      const clients: PipelineClient[] = (membershipsResult.data ?? [])
        .map((m) => {
          const userId = m.user_id as string;
          const prof = profileMap[userId];
          return {
            userId,
            displayName: prof?.display_name ?? null,
            email: prof?.email ?? "",
            avatarUrl: prof?.avatar_url ?? null,
          };
        })
        .sort((a, b) => {
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
        clients,
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
