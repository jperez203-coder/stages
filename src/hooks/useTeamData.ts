"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * One pending invite for the team settings page, joined with the inviter's
 * profile (display name + email). `inviterDisplayName` / `inviterEmail` are
 * null when invited_by is null (the inviter's auth.users row was deleted —
 * ON DELETE SET NULL handles the FK cleanup but leaves the invite intact
 * per the locked design).
 */
export type TeamInvite = {
  token: string;
  email: string;
  role: "admin" | "member";
  createdAt: string;
  expiresAt: string;
  invitedBy: string | null;
  inviterDisplayName: string | null;
  inviterEmail: string | null;
};

/**
 * One workspace member for the team settings page.
 *
 * Note: workspace_memberships has no `created_at` column (confirmed during
 * step 6 planning). When we want "joined at" for display, that's a future
 * schema migration. For now members are sorted by role (owner/admin/member)
 * then alphabetically by display name or email.
 */
export type TeamMember = {
  userId: string;
  role: "owner" | "admin" | "member";
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
};

export type TeamDataState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      invites: TeamInvite[];
      members: TeamMember[];
      refetch: () => Promise<void>;
    };

/**
 * Batched fetch of pending workspace_invites + workspace_memberships for a
 * single workspace, joined client-side with profiles (display name, email,
 * avatar). One `useTeamData` instance per `/w/[slug]/settings/team` mount.
 *
 * Why client-side join instead of PostgREST nested-select:
 *   * workspace_invites.invited_by FKs to auth.users(id), not profiles(id).
 *   * workspace_memberships.user_id same shape.
 *   * PostgREST nested selects need a direct FK between the two tables;
 *     transitive joins through auth.users aren't auto-detected.
 *   * Three queries (invites + members + profiles-by-id-set) is simpler
 *     than fighting the relationship hints, and the third only fires when
 *     there's actually data to enrich.
 *
 * Returns a refetch function so caller-initiated mutations (send / resend /
 * revoke) can refresh the lists without remounting.
 */
export function useTeamData(workspaceId: string | null): TeamDataState {
  const [state, setState] = useState<TeamDataState>({ status: "loading" });

  const load = useCallback(async () => {
    if (!workspaceId) {
      setState({ status: "loading" });
      return;
    }
    setState({ status: "loading" });
    try {
      const [invitesResult, membersResult] = await Promise.all([
        supabase
          .from("workspace_invites")
          .select("token, email, role, created_at, expires_at, invited_by")
          .eq("workspace_id", workspaceId)
          .is("accepted_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("workspace_memberships")
          .select("user_id, role")
          .eq("workspace_id", workspaceId),
      ]);

      if (invitesResult.error) {
        throw new Error(invitesResult.error.message);
      }
      if (membersResult.error) {
        throw new Error(membersResult.error.message);
      }

      // Collect every user_id we'll need a profile for (inviters + members),
      // deduplicated. Empty set → skip the profile query.
      const userIds = Array.from(
        new Set([
          ...((invitesResult.data ?? [])
            .map((i) => i.invited_by as string | null)
            .filter(Boolean) as string[]),
          ...((membersResult.data ?? []).map(
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

      const invites: TeamInvite[] = (invitesResult.data ?? []).map((i) => ({
        token: i.token as string,
        email: i.email as string,
        role: i.role as "admin" | "member",
        createdAt: i.created_at as string,
        expiresAt: i.expires_at as string,
        invitedBy: (i.invited_by as string | null) ?? null,
        inviterDisplayName: i.invited_by
          ? profileMap[i.invited_by as string]?.display_name ?? null
          : null,
        inviterEmail: i.invited_by
          ? profileMap[i.invited_by as string]?.email ?? null
          : null,
      }));

      const roleOrder: Record<TeamMember["role"], number> = {
        owner: 0,
        admin: 1,
        member: 2,
      };
      const members: TeamMember[] = (membersResult.data ?? [])
        .map((m) => {
          const userId = m.user_id as string;
          const prof = profileMap[userId];
          return {
            userId,
            role: m.role as TeamMember["role"],
            displayName: prof?.display_name ?? null,
            email: prof?.email ?? "",
            avatarUrl: prof?.avatar_url ?? null,
          };
        })
        .sort((a, b) => {
          if (roleOrder[a.role] !== roleOrder[b.role]) {
            return roleOrder[a.role] - roleOrder[b.role];
          }
          const aName = (a.displayName || a.email).toLowerCase();
          const bName = (b.displayName || b.email).toLowerCase();
          return aName.localeCompare(bName);
        });

      setState({ status: "ready", invites, members, refetch: load });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return state;
}
