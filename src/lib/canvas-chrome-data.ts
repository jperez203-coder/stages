import type { createSupabaseServerClient } from "./supabase-server";

/**
 * Server-side data fetch for the pipeline canvas chrome (header + rail).
 * Phase 4a step 5d.
 *
 * Shared by both consumers of the chrome:
 *   * `/w/[slug]/p/[pipeline-id]` (the canvas itself)
 *   * `/w/[slug]/p/[pipeline-id]/clients` (the agency-side client invite UI)
 *
 * Both routes are in the (canvas) route group; both render
 * `<PipelineChromeShell {...chromeData}>` around their own page content.
 * Centralizing the fetch here means the chrome's data shape is defined
 * in one place — if we add a field (e.g. a stage count, a pipeline
 * status badge), only this helper changes.
 *
 * Returns null only if the pipeline doesn't exist (caller should
 * `redirect()` to the workspace dashboard in that case).
 *
 * **Member roster pattern (locked):** two queries (pipeline_memberships,
 * then profiles), in-memory join. Mirrors the dashboard's exact pattern
 * in `/w/[slug]/page.tsx`. We CAN'T use PostgREST's nested
 * `profile:profiles!inner(...)` form here because the schema has no
 * direct foreign key from `pipeline_memberships` to `profiles` —
 * both reference `auth.users(id)` separately, so PostgREST can't infer
 * the relationship and returns 0 rows. First attempt at this helper
 * used the nested form and the member cluster rendered empty across
 * the entire chrome surface; fixed 2026-05-22 by switching to the
 * dashboard's two-query pattern.
 */

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type ChromeMember = {
  role: string; // "owner" | "admin" | "member" | "client"
  user: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  };
};

export type CanvasChromeData = {
  pipeline: {
    id: string;
    name: string;
    emoji: string;
    company: string | null;
    last_edited_at: string;
  };
  /** All members, sorted agency-first (owner→admin→member→client) then by joined_at asc. */
  members: ChromeMember[];
  /** First 3 members for the avatar cluster preview. */
  visibleMembers: ChromeMember[];
  /** Count beyond the visible cluster — drives the "+N" overflow badge. */
  overflowMembers: number;
  /** Workspace owner OR pipeline owner/admin → can edit, see +Invite, etc. */
  canEditPipeline: boolean;
  /** WORKSPACE-level owner/admin specifically (NOT pipeline-level admins).
   *  Narrower than canEditPipeline — gates the "View as client" rail icon,
   *  which is a workspace-operator affordance, not a per-pipeline edit. */
  isWorkspaceOwnerOrAdmin: boolean;
};

/**
 * Fetch all chrome data for one pipeline. Caller provides:
 *   * `pipelineId` — known from the route param
 *   * `userId` — from `supabase.auth.getUser()`
 *   * `workspaceRole` — already resolved by the caller's workspace
 *     membership check (we don't refetch it; passed in to avoid a
 *     redundant round-trip)
 */
export async function fetchCanvasChromeData(
  supabase: SupabaseServerClient,
  pipelineId: string,
  userId: string,
  workspaceRole: string,
): Promise<CanvasChromeData | null> {
  // Parallel: pipeline lookup + member list + caller's pipeline_memberships.
  // The member list (pipeline_memberships only — no profiles join, see
  // doc above) returns user_ids; we follow up with one batched profiles
  // query for those ids.
  const [pipelineRes, membershipsRes, pipelineMembershipRes] =
    await Promise.all([
      supabase
        .from("pipelines")
        .select("id, name, emoji, company, last_edited_at")
        .eq("id", pipelineId)
        .maybeSingle(),

      supabase
        .from("pipeline_memberships")
        .select("role, user_id, joined_at")
        .eq("pipeline_id", pipelineId),

      // Calling user's pipeline membership — needed for can_edit_pipeline
      // mirroring (workspace owner can edit any; pipeline owner/admin can
      // edit theirs). Skipped if the workspace role is already 'owner'
      // (workspace owners bypass), but cheap enough to always run.
      supabase
        .from("pipeline_memberships")
        .select("role")
        .eq("pipeline_id", pipelineId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  if (!pipelineRes.data) return null;

  // ── canEditPipeline (mirrors the can_edit_pipeline SQL helper) ────
  // Workspace owners AND admins get blanket edit access to every pipeline
  // in the workspace (matches the widened can_edit_pipeline SQL helper —
  // see 20260614120000_admin_pipeline_access_and_create_perms.sql). Plain
  // members still need an explicit pipeline_memberships owner/admin row.
  const isWorkspaceOwnerOrAdmin =
    workspaceRole === "owner" || workspaceRole === "admin";
  const pipelineRole = pipelineMembershipRes.data?.role ?? null;
  const isPipelineOwnerOrAdmin =
    pipelineRole === "owner" || pipelineRole === "admin";
  const canEditPipeline = isWorkspaceOwnerOrAdmin || isPipelineOwnerOrAdmin;

  // ── Batched profiles fetch keyed by member user_ids ───────────────
  const membershipRows = membershipsRes.data ?? [];
  const userIds = Array.from(
    new Set(membershipRows.map((m) => m.user_id as string)),
  );

  const profilesRes = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email")
        .in("id", userIds)
    : { data: [], error: null };

  type Profile = {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    email: string | null;
  };
  const profileById = new Map<string, Profile>();
  for (const p of (profilesRes.data ?? []) as Profile[]) {
    profileById.set(p.id, p);
  }

  // ── Build + sort members ──────────────────────────────────────────
  // Role order (locked): owner → admin → member → client. Within each
  // group, sorted by joined_at ascending (oldest first).
  const roleOrder = (role: string): number => {
    switch (role) {
      case "owner":
        return 0;
      case "admin":
        return 1;
      case "member":
        return 2;
      case "client":
        return 3;
      default:
        return 4;
    }
  };

  const sortedMembers: ChromeMember[] = [...membershipRows]
    .sort((a, b) => {
      const ro = roleOrder(a.role as string) - roleOrder(b.role as string);
      if (ro !== 0) return ro;
      return (
        new Date(a.joined_at as string).getTime() -
        new Date(b.joined_at as string).getTime()
      );
    })
    .map((m) => {
      const profile = profileById.get(m.user_id as string);
      return {
        role: m.role as string,
        user: {
          id: m.user_id as string,
          display_name: profile?.display_name ?? null,
          avatar_url: profile?.avatar_url ?? null,
          email: profile?.email ?? null,
        },
      };
    });

  const visibleMembers = sortedMembers.slice(0, 3);
  const overflowMembers = Math.max(0, sortedMembers.length - 3);

  return {
    pipeline: {
      id: pipelineRes.data.id,
      name: pipelineRes.data.name,
      emoji: pipelineRes.data.emoji ?? "📋",
      company: pipelineRes.data.company,
      last_edited_at: pipelineRes.data.last_edited_at,
    },
    members: sortedMembers,
    visibleMembers,
    overflowMembers,
    canEditPipeline,
    isWorkspaceOwnerOrAdmin,
  };
}
