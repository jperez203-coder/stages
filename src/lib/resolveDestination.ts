import type { UserContext } from "@/hooks/useUserContexts";
import { isAutoPersonalOnly } from "@/lib/auto-personal";

/**
 * Decision tree for the post-login workspace selector.
 *
 *   * `create_workspace` → user has no agency context and is "essentially
 *     brand-new" — either truly zero contexts (pre-WL-2 state) OR the
 *     only context is the untouched WL-2 auto-personal (post-WL-2 state).
 *     Route to /onboarding/create-workspace where they'll name an agency.
 *   * `go_to` → exactly one valid destination; auto-route there and write
 *     `last_active_workspace_id` (caller's responsibility)
 *   * `show_chooser` → multiple valid contexts; render the chooser UI
 *
 * Pure function. No side effects, no React. Tested independently of the
 * fetching layer — give it contexts + last-active and it returns where to go.
 */
export type ResolveResult =
  | { kind: "create_workspace" }
  | { kind: "go_to"; url: string; contextToCommit: UserContext }
  | { kind: "show_chooser" };

export function resolveDestination(
  contexts: UserContext[],
  lastActiveWorkspaceId: string | null,
): ResolveResult {
  if (contexts.length === 0) {
    return { kind: "create_workspace" };
  }

  // WL-3a: the WL-2 trigger creates an "auto-personal" workspace at
  // signup so contexts.length === 0 is unreachable for any post-WL-2
  // user. Without this branch, those users hit the contexts.length === 1
  // path below and get routed to /w/personal — a dead end with no
  // affordance to create an agency. The shared isAutoPersonalOnly
  // predicate catches "only the untouched auto-personal" and routes them
  // to /onboarding/create-workspace, restoring the Flow A signup-then-
  // name-agency journey. Renamed personals don't match (the workspace
  // name is part of the predicate) so an engaged user is still routed
  // to their renamed dashboard.
  if (isAutoPersonalOnly(contexts)) {
    return { kind: "create_workspace" };
  }

  if (contexts.length === 1) {
    return {
      kind: "go_to",
      url: urlForContext(contexts[0]),
      contextToCommit: contexts[0],
    };
  }

  // 2+ contexts. Check if last-active is still valid.
  if (lastActiveWorkspaceId) {
    const matching = contexts.filter(
      (c) => c.workspaceId === lastActiveWorkspaceId,
    );
    if (matching.length > 0) {
      // Per CLAUDE.md identity-model design: when ambiguous (user is BOTH
      // agency-side AND client of the same workspace — rare), prefer the
      // agency context. If real customer data ever shows this matters,
      // we'll add `last_active_client_pipeline_id` to disambiguate.
      const preferred = matching.find((c) => c.type === "agency") ?? matching[0];
      return {
        kind: "go_to",
        url: urlForContext(preferred),
        contextToCommit: preferred,
      };
    }
    // Stale last-active (workspace deleted, membership revoked, etc.) →
    // fall through to the chooser. The DB's ON DELETE SET NULL covers the
    // workspace-deleted case automatically; this branch handles the
    // membership-revoked case where the FK still points at a real row.
  }

  return { kind: "show_chooser" };
}

/**
 * Resolves the destination URL for a context. The fix that landed
 * 2026-05-26 (B1 in the agency↔client boundary cleanup): client
 * contexts route to /portal/[pipelineId]; agency contexts route to
 * /w/[slug] exactly as before.
 *
 * Pre-fix: every context routed to /w/[slug], which meant a pure
 * client signing in would land on the agency dashboard, the
 * dashboard's workspace-membership gate would redirect them to /,
 * and they'd end up on the legacy in-memory app. Now they land
 * directly on their portal.
 *
 * EXPORTED so the chooser (WorkspaceSelector) can use the same
 * URL-construction logic when a user clicks a context. Keeping the
 * two call sites in lockstep — bypassing this function would let
 * the chooser drift from the auto-route behavior.
 *
 * Agency routing is BYTE-FOR-BYTE UNCHANGED: any context with
 * `type === "agency"` still returns /w/[slug]. The fix is purely
 * additive on the client branch.
 */
export function urlForContext(ctx: UserContext): string {
  if (ctx.type === "client") {
    if (ctx.pipelineId) {
      return `/portal/${ctx.pipelineId}`;
    }
    // Defensive fallback: a client context with no pipelineId is a
    // data bug — useUserContexts only sets type='client' on rows
    // sourced from pipeline_memberships, which always have a
    // pipeline_id. If this ever fires, log + fall through to the
    // agency URL. The /w/[slug] route's gate will redirect the user
    // to / cleanly (no new failure mode introduced).
    console.warn(
      "[resolveDestination] client context missing pipelineId; falling back to /w/[slug]",
      { workspaceId: ctx.workspaceId, role: ctx.role },
    );
  }
  return `/w/${ctx.workspaceSlug}`;
}
