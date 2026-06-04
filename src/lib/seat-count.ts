import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Counts unique agency seats for a workspace per the locked definition in
 * CLAUDE.md → "Pricing-driven gates":
 *
 *   An agency seat is a unique user with EITHER
 *     - a workspace_memberships row in the workspace, OR
 *     - a pipeline_memberships row with role IN (owner, admin, member)
 *       on any pipeline in the workspace.
 *   Client seats (pipeline_memberships role='client') are NEVER counted.
 *
 * Two reads + JS-side dedup via a Set. The canonical CLAUDE.md SQL is a
 * UNION across the two membership tables; supabase-js can't express
 * UNION directly, so we issue two scoped queries and union user_ids in
 * memory. Result is identical (same set of distinct user_ids).
 *
 * Service-role only — the cross-table read needs to bypass RLS for both
 * tables uniformly (and the membership tables' policies differ in subtle
 * ways that would make a unified caller-side query brittle). The sole
 * authorized consumer today is /api/cron/sync-seats. Any future caller
 * must perform its own authorization check before invoking this helper.
 *
 * Pure function in spirit — no side effects, idempotent given identical
 * DB state. The Set dedupes naturally if a user appears in BOTH membership
 * tables (workspace owner who is also a pipeline owner of their own
 * pipeline, etc.) — same user_id, counts once.
 */
export async function computeAgencySeatCount(
  workspaceId: string,
): Promise<number> {
  const admin = getSupabaseAdmin();

  // 1. workspace_memberships — all roles count as agency seats (owner /
  //    admin / member; the membership table doesn't include 'client').
  const wm = await admin
    .from("workspace_memberships")
    .select("user_id")
    .eq("workspace_id", workspaceId);
  if (wm.error) {
    throw new Error(
      `workspace_memberships query failed: ${wm.error.message} (code=${wm.error.code ?? "?"})`,
    );
  }

  // 2. pipeline_memberships — agency roles only. Inner join pipelines
  //    to constrain by workspace_id.
  const pm = await admin
    .from("pipeline_memberships")
    .select("user_id, pipeline:pipelines!inner(workspace_id)")
    .eq("pipeline.workspace_id", workspaceId)
    .in("role", ["owner", "admin", "member"]);
  if (pm.error) {
    throw new Error(
      `pipeline_memberships query failed: ${pm.error.message} (code=${pm.error.code ?? "?"})`,
    );
  }

  const userIds = new Set<string>();
  for (const r of wm.data ?? []) userIds.add(r.user_id);
  for (const r of pm.data ?? []) userIds.add(r.user_id);
  return userIds.size;
}
