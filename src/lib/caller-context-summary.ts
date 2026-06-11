import "server-only";
import { cache } from "react";
import type { createSupabaseServerClient } from "./supabase-server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Lightweight server-side summary of the caller's memberships. Mirrors
 * the data `useUserContexts` reads client-side, but returns
 * presence-of-context booleans rather than full UserContext[] — useful
 * for fast server-side gates that just need to know "is this user
 * agency / client / both / neither?" without paying for full context
 * data.
 *
 * Cached per-request via React.cache so multiple gate sites in the
 * same request share one pair of queries.
 *
 * Three-case rule callers can read off this shape directly:
 *   * Zero contexts: `!hasAgency && !hasClient` → brand-new signup
 *   * Pure client:   `hasClient && !hasAgency`  → block from agency surfaces
 *   * Agency:        `hasAgency`                 → allow (may also be a client elsewhere — that's fine)
 *
 * Used by:
 *   * /onboarding/create-workspace server gate (2026-05-26, C1 fix —
 *     prevents pure clients from creating workspaces as a paywall bypass)
 *   * Future server-side surfaces that need the agency-vs-client signal
 *
 * RLS-safe: both queries filter by user_id = caller. A user can only
 * see their own memberships under existing policies; this helper
 * doesn't introduce any new read scope.
 */
export type CallerContextSummary = {
  hasAgency: boolean;
  hasClient: boolean;
  /** True iff the caller has at least one membership with role IN
   *  ('owner','admin') across either workspace_memberships OR
   *  pipeline_memberships. Distinct from `hasAgency`: a workspace-member
   *  or pipeline-member (role='member') has `hasAgency=true` but this
   *  flag is `false` because they don't hold owner/admin standing
   *  anywhere.
   *
   *  Drives the workspace-type selector visibility at
   *  /onboarding/create-workspace (WT-3, follow-up commit):
   *    * false → user is member-only somewhere → selector skips the
   *              "agency" option, auto-assigns type='personal'.
   *    * true  → user can already invite team / own work elsewhere →
   *              selector shows both agency + personal options with no
   *              forced default.
   *  The zero-context case (brand-new signup) also evaluates `false`
   *  here, but WT-3's logic shows the selector with "agency" pre-
   *  selected for that distinct case. */
  hasAgencyOwnerOrAdminRole: boolean;
  /** Exactly-one-client case: pipelineId for a direct /portal/<id>
   *  redirect on a blocked client. Null when the caller has zero or
   *  multiple client memberships. Callers with multiple clients should
   *  fall back to /select-workspace and let the user pick. */
  singleClientPipelineId: string | null;
};

export const fetchCallerContextSummary = cache(
  async (
    supabase: SupabaseServerClient,
  ): Promise<CallerContextSummary | null> => {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) return null;

    // workspace_memberships `role` added to the select (WT-2) so the new
    // `hasAgencyOwnerOrAdminRole` field can be computed without a third
    // round-trip — same two queries the helper has always run, one
    // extra column on the first one.
    const [wsRes, pipRes] = await Promise.all([
      supabase
        .from("workspace_memberships")
        .select("workspace_id, role")
        .eq("user_id", user.id),
      supabase
        .from("pipeline_memberships")
        .select("pipeline_id, role")
        .eq("user_id", user.id),
    ]);

    const wsRows = wsRes.data ?? [];
    const hasWsMembership = wsRows.length > 0;
    const pipelineRows = pipRes.data ?? [];
    const agencyPipelineRows = pipelineRows.filter(
      (r) => r.role !== "client",
    );
    const clientPipelineRows = pipelineRows.filter(
      (r) => r.role === "client",
    );

    // hasAgencyOwnerOrAdminRole: any owner/admin standing across either
    // membership table. Plain `.some()` over the already-fetched rows;
    // no DB cost beyond the role column added above.
    const hasOwnerOrAdminWs = wsRows.some(
      (r) => r.role === "owner" || r.role === "admin",
    );
    const hasOwnerOrAdminPipeline = agencyPipelineRows.some(
      (r) => r.role === "owner" || r.role === "admin",
    );

    return {
      hasAgency: hasWsMembership || agencyPipelineRows.length > 0,
      hasClient: clientPipelineRows.length > 0,
      hasAgencyOwnerOrAdminRole: hasOwnerOrAdminWs || hasOwnerOrAdminPipeline,
      singleClientPipelineId:
        clientPipelineRows.length === 1
          ? clientPipelineRows[0].pipeline_id
          : null,
    };
  },
);
