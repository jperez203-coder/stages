import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";

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
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠ SERVICE-ROLE ONLY — BYPASSES RLS. Call from crons and webhooks only.
 *
 * For user-facing pages (server-rendered or otherwise), use
 * getWorkspaceSeatCountSSR() below — it respects RLS via the caller's
 * own authenticated session.
 *
 * The sole authorized consumer today is /api/cron/sync-seats. Any future
 * caller must perform its own authorization check before invoking this
 * helper.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Two reads + JS-side dedup via a Set. The canonical CLAUDE.md SQL is a
 * UNION across the two membership tables; supabase-js can't express
 * UNION directly, so we issue two scoped queries and union user_ids in
 * memory. Result is identical (same set of distinct user_ids).
 *
 * Throws on read errors (cron wants to know + retry next cycle, not
 * silently return a wrong number).
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

/**
 * SSR-AUTHENTICATED variant — RESPECTS RLS via the caller's own
 * authenticated session (createSupabaseServerClient cookie-backed).
 *
 * Same agency-seat definition as computeAgencySeatCount above, just
 * with a different client. Use this from user-facing server components
 * (pages, server actions). For crons and webhooks use
 * computeAgencySeatCount() instead.
 *
 * RETURN CONTRACT
 *   * number: success. The seat count for the workspace.
 *   * null:   either the caller lacks the RLS-allowed visibility into
 *             at least one of the two membership tables, OR a read
 *             errored. In either case the caller should render a
 *             graceful "seat count unavailable" UI rather than crashing.
 *
 * IN PRACTICE: any caller who has already passed an owner/admin gate
 * before invoking this helper will get a number (because owner/admin
 * RLS sees their own workspace's memberships). Returning null is the
 * safe fallback for the edge case where RLS or the network does
 * something unexpected.
 *
 * Logs but does not throw on read errors — the page surface that
 * consumes this should not crash on a billing-display issue.
 */
export async function getWorkspaceSeatCountSSR(
  workspaceId: string,
): Promise<number | null> {
  const supa = await createSupabaseServerClient();

  // 1. workspace_memberships — RLS lets the caller read their own
  //    workspace's memberships (workspace_memberships_select policy).
  const wm = await supa
    .from("workspace_memberships")
    .select("user_id")
    .eq("workspace_id", workspaceId);
  if (wm.error) {
    console.error(
      "[seat-count-ssr] workspace_memberships read failed:",
      wm.error.message,
      "code:",
      wm.error.code,
      "details:",
      wm.error.details,
      "hint:",
      wm.error.hint,
    );
    return null;
  }

  // 2. pipeline_memberships — agency roles only, inner-joined through
  //    pipelines for the workspace_id scope. RLS on
  //    pipeline_memberships requires the caller to share a workspace
  //    OR pipeline membership; owner/admin of the workspace satisfies
  //    that across all child pipelines.
  const pm = await supa
    .from("pipeline_memberships")
    .select("user_id, pipeline:pipelines!inner(workspace_id)")
    .eq("pipeline.workspace_id", workspaceId)
    .in("role", ["owner", "admin", "member"]);
  if (pm.error) {
    console.error(
      "[seat-count-ssr] pipeline_memberships read failed:",
      pm.error.message,
      "code:",
      pm.error.code,
      "details:",
      pm.error.details,
      "hint:",
      pm.error.hint,
    );
    return null;
  }

  const userIds = new Set<string>();
  for (const r of wm.data ?? []) userIds.add(r.user_id);
  for (const r of pm.data ?? []) userIds.add(r.user_id);
  return userIds.size;
}
