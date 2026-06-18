/**
 * WL-3a: shared predicate for "the caller's only workspace context is the
 * auto-created personal from WL-2." DRY single source of truth so
 * resolveDestination (client routing) and the /onboarding/create-workspace
 * server gate agree on what "essentially a brand-new user" means after
 * WL-2 broke the pre-existing zero-contexts predicate.
 *
 * Pure function. No React, no DB, no Supabase. Accepts a minimal
 * structural shape so both UserContext[] (client-side, from
 * useUserContexts) and the server-side workspace_memberships rows can
 * feed it without coupling either consumer to the other's full type.
 *
 * THE LITERAL 'Personal'
 * ──────────────────────
 * AUTO_PERSONAL_WORKSPACE_NAME mirrors the literal in WL-2's
 * handle_new_user trigger
 * (supabase/migrations/20260618150000_wl_2_auto_personal_workspace.sql:~225
 * — `values ('Personal', 'personal')`). If we ever change the trigger
 * literal we MUST update this constant too. Symmetric coupling is
 * intentional: the predicate's job is "did this user pass through the
 * trigger without engaging with the workspace yet?" — a user who
 * renamed their auto-personal has engaged, so they no longer match.
 * Renaming exits the auto-personal-only bucket and the routing logic
 * correctly sends them to their renamed workspace's dashboard.
 *
 * USED BY
 * ───────
 *   * src/lib/resolveDestination.ts — pre-empts the single-context
 *     `go_to` branch when the single context is the unchanged auto-
 *     personal, routing the user to /onboarding/create-workspace
 *     instead of /w/personal.
 *   * src/lib/caller-context-summary.ts — derives
 *     `hasOnlyAutoPersonal` server-side from workspace_memberships
 *     rows for the /onboarding/create-workspace page-level
 *     selectorMode computation.
 */

export const AUTO_PERSONAL_WORKSPACE_NAME = "Personal";

/**
 * Minimal shape the predicate needs. Both UserContext (the client-side
 * shape from useUserContexts) and a server-side reshape from
 * workspace_memberships rows can satisfy this.
 */
export type AutoPersonalContextShape = {
  source: "workspace" | "pipeline";
  role: string;
  workspaceType?: "agency" | "personal";
  workspaceName: string;
};

/**
 * True iff the caller has EXACTLY ONE workspace_memberships row, that
 * row's role is 'owner', and the joined workspace is the canonical
 * untouched auto-personal: type='personal' AND name='Personal'.
 *
 * False in every other case, including:
 *   * Zero contexts (genuine brand-new pre-WL-2 state — but post-WL-2
 *     this is unreachable because the trigger always creates the
 *     auto-personal before the user reaches any routing decision).
 *   * 2+ contexts (existing agency, multi-pipeline client, etc.).
 *   * 1 context that is a pipeline membership (client / pipeline-only
 *     member).
 *   * 1 context that is workspace-sourced but type='agency' (the user
 *     made an agency separately).
 *   * 1 context that is workspace-sourced personal but with a renamed
 *     workspace (user engaged with it already).
 */
export function isAutoPersonalOnly(
  contexts: readonly AutoPersonalContextShape[],
): boolean {
  if (contexts.length !== 1) return false;
  const c = contexts[0];
  return (
    c.source === "workspace" &&
    c.role === "owner" &&
    c.workspaceType === "personal" &&
    c.workspaceName === AUTO_PERSONAL_WORKSPACE_NAME
  );
}
