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

    const [wsRes, pipRes] = await Promise.all([
      supabase
        .from("workspace_memberships")
        .select("workspace_id")
        .eq("user_id", user.id),
      supabase
        .from("pipeline_memberships")
        .select("pipeline_id, role")
        .eq("user_id", user.id),
    ]);

    const hasWsMembership = (wsRes.data?.length ?? 0) > 0;
    const pipelineRows = pipRes.data ?? [];
    const agencyPipelineRows = pipelineRows.filter(
      (r) => r.role !== "client",
    );
    const clientPipelineRows = pipelineRows.filter(
      (r) => r.role === "client",
    );

    return {
      hasAgency: hasWsMembership || agencyPipelineRows.length > 0,
      hasClient: clientPipelineRows.length > 0,
      singleClientPipelineId:
        clientPipelineRows.length === 1
          ? clientPipelineRows[0].pipeline_id
          : null,
    };
  },
);
