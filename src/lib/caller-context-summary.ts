import "server-only";
import { cache } from "react";
import type { createSupabaseServerClient } from "./supabase-server";
import { isAutoPersonalOnly } from "./auto-personal";

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
   *  /onboarding/create-workspace (WT-3):
   *    * false → user is member-only somewhere → selector skips the
   *              "agency" option, auto-assigns type='personal'.
   *    * true  → user can already invite team / own work elsewhere →
   *              selector shows both agency + personal options with no
   *              forced default.
   *  The zero-context case (brand-new signup) also evaluates `false`
   *  here, but WT-3's logic shows the selector with "agency" pre-
   *  selected for that distinct case. */
  hasAgencyOwnerOrAdminRole: boolean;
  /** WT-4: true iff the caller currently owns at least one personal
   *  workspace (workspace_memberships role='owner' AND the joined
   *  workspace's type='personal'). Drives WT-5's "Personal option
   *  disabled with tooltip" treatment on the workspace-type selector
   *  — the underlying limit is enforced by create_workspace_with_owner
   *  raising 23505, so this flag is a UX nicety rather than a
   *  security floor. */
  hasPersonalWorkspace: boolean;
  /** WL-3b: true iff the caller has ANY workspace_memberships row
   *  (role owner/admin/member) joined on workspaces.type='agency'.
   *  Drives the "Agency option disabled with tooltip" treatment on
   *  the create-workspace form AND the accept-invite preflight that
   *  blocks a 2nd-agency acceptance. Underlying limit is enforced by
   *  create_workspace_with_owner + accept_workspace_invite raising
   *  23505 (WL-1).
   *
   *  PREDICATE ASYMMETRY (intentional): hasPersonalWorkspace requires
   *  role='owner' to match the WT-4 1-personal cap shape (which only
   *  counts personal workspaces the caller OWNS). hasAgencyWorkspace
   *  counts ANY role to match the WL-1 1-agency cap shape (being a
   *  teammate in someone else's agency consumes the slot too). The
   *  two flags drive UI affordances for the two RPCs respectively;
   *  the role-filter difference mirrors what the RPCs themselves check. */
  hasAgencyWorkspace: boolean;
  /** Exactly-one-client case: pipelineId for a direct /portal/<id>
   *  redirect on a blocked client. Null when the caller has zero or
   *  multiple client memberships. Callers with multiple clients should
   *  fall back to /select-workspace and let the user pick. */
  singleClientPipelineId: string | null;
  /** WL-3a: true iff the caller's ONLY context is the untouched WL-2
   *  auto-personal workspace (1 workspace_memberships row with
   *  role='owner', joined workspaces.type='personal' and
   *  workspaces.name='Personal', AND zero pipeline_memberships). Used
   *  by /onboarding/create-workspace/page.tsx to compute a new
   *  'force-agency' selectorMode that defaults the form to agency and
   *  disables the personal card via the existing hasPersonalWorkspace
   *  affordance — closing the Flow A signup gap that emerged after
   *  WL-2 stopped contexts.length === 0 from ever being true post-
   *  signup. Computed via the shared isAutoPersonalOnly predicate in
   *  src/lib/auto-personal.ts so client-side resolveDestination and
   *  server-side selectorMode agree on the definition. */
  hasOnlyAutoPersonal: boolean;
};

export const fetchCallerContextSummary = cache(
  async (
    supabase: SupabaseServerClient,
  ): Promise<CallerContextSummary | null> => {
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) return null;

    // workspace_memberships `role` + embedded workspace.type added to
    // the select. The role column powers hasAgencyOwnerOrAdminRole
    // (WT-2); the joined workspace.type powers hasPersonalWorkspace
    // (WT-4); the joined workspace.name (added WL-3a) powers
    // hasOnlyAutoPersonal via the shared isAutoPersonalOnly predicate.
    // All three are filtered from the already-fetched rows — no extra
    // DB round-trips beyond the columns/embed added here.
    const [wsRes, pipRes] = await Promise.all([
      supabase
        .from("workspace_memberships")
        .select("workspace_id, role, workspace:workspaces!inner(type, name)")
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
    // membership table. Plain `.some()` over the already-fetched rows.
    const hasOwnerOrAdminWs = wsRows.some(
      (r) => r.role === "owner" || r.role === "admin",
    );
    const hasOwnerOrAdminPipeline = agencyPipelineRows.some(
      (r) => r.role === "owner" || r.role === "admin",
    );

    // hasPersonalWorkspace (WT-4): owner of at least one workspace with
    // type='personal'. PostgREST returns the embedded workspace row as
    // either an object or a single-element array depending on codegen
    // heuristic — normalize through unknown (same pattern used elsewhere
    // in the codebase, e.g. src/app/page.tsx + /w/[slug]/page.tsx).
    const hasPersonalWorkspace = wsRows.some((r) => {
      if (r.role !== "owner") return false;
      const w = (r as { workspace?: unknown }).workspace;
      const wsObj = (Array.isArray(w) ? w[0] : w) as
        | { type?: string }
        | undefined;
      return wsObj?.type === "personal";
    });

    // hasAgencyWorkspace (WL-3b → WL-1 alignment): ANY role on an agency-
    // type workspace. Predicate-asymmetry from hasPersonalWorkspace is
    // intentional — the underlying RPCs differ (WT-4 personal cap is
    // owner-only; WL-1 agency cap counts any role since being a
    // teammate consumes the slot too). Same PostgREST embed normalization.
    const hasAgencyWorkspace = wsRows.some((r) => {
      const w = (r as { workspace?: unknown }).workspace;
      const wsObj = (Array.isArray(w) ? w[0] : w) as
        | { type?: string }
        | undefined;
      return wsObj?.type === "agency";
    });

    // WL-3a: hasOnlyAutoPersonal. Reshape workspace_memberships rows
    // into the AutoPersonalContextShape the shared predicate consumes,
    // then call it. Pipeline memberships count as "additional contexts"
    // for the predicate's purpose; we feed the workspace rows only
    // when the pipeline-membership count is zero (any pipeline_-
    // membership row, agency-side or client, means contexts.length >= 2
    // when joined with the auto-personal workspace_membership, so the
    // predicate is automatically false). Skipping the reshape when
    // pipelineRows.length > 0 saves a few cycles on the hot path.
    const hasOnlyAutoPersonal =
      pipelineRows.length === 0 &&
      isAutoPersonalOnly(
        wsRows.map((r) => {
          const w = (r as { workspace?: unknown }).workspace;
          const wsObj = (Array.isArray(w) ? w[0] : w) as
            | { type?: "agency" | "personal"; name?: string }
            | undefined;
          return {
            source: "workspace" as const,
            role: r.role as string,
            workspaceType: wsObj?.type,
            workspaceName: wsObj?.name ?? "",
          };
        }),
      );

    return {
      hasAgency: hasWsMembership || agencyPipelineRows.length > 0,
      hasClient: clientPipelineRows.length > 0,
      hasAgencyOwnerOrAdminRole: hasOwnerOrAdminWs || hasOwnerOrAdminPipeline,
      hasPersonalWorkspace,
      hasAgencyWorkspace,
      singleClientPipelineId:
        clientPipelineRows.length === 1
          ? clientPipelineRows[0].pipeline_id
          : null,
      hasOnlyAutoPersonal,
    };
  },
);
