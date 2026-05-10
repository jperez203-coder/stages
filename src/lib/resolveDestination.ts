import type { UserContext } from "@/hooks/useUserContexts";

/**
 * Decision tree for the post-login workspace selector.
 *
 *   * `create_workspace` → user has no contexts; route to onboarding
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
 * Currently every context routes to /w/[slug]. Phase 4 wires role-aware
 * rendering inside that route (client portal vs agency view), and may
 * route client contexts to a separate /portal/[pipelineId] structure
 * instead. Centralising the URL construction here means there's one place
 * to change when that decision lands.
 */
function urlForContext(ctx: UserContext): string {
  return `/w/${ctx.workspaceSlug}`;
}
