import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { computeAgencySeatCount } from "@/lib/seat-count";

/**
 * Data layer for the founder-only /admin/metrics page. Every query here
 * runs on the service-role client — see the "authorized callers" list in
 * supabase-admin.ts. The page itself gates access via isAdminUser()
 * BEFORE any of these functions are ever called; nothing here re-checks
 * that, by design (single trust boundary, not two half-enforced ones).
 *
 * PLAN_PRICE mirrors the per-seat prices documented on workspace_billing.plan
 * in supabase/migrations/20260618120000_stripe_billing_tables.sql. If
 * pricing ever changes, MRR here will drift until this constant is
 * updated — there's no live read from Stripe.
 */
const PLAN_PRICE: Record<string, number> = { solo: 29, team: 39 };

export type FunnelStep = {
  label: string;
  count: number;
  pctOfPrevious: number | null;
  pctOfFirst: number | null;
};

export type AdminMetrics = {
  funnel: FunnelStep[];
  pageViewsTrackingSince: string | null;
  mrr: number;
  planCounts: { solo: number; team: number };
  activeSubscriptions: number;
  trialingSubscriptions: number;
  trialToPaid: { converted: number; totalEverTrialed: number; rate: number | null };
  cancellations: {
    workspaceName: string;
    plan: string;
    tenureDays: number | null;
    canceledAround: string;
  }[];
};

export async function fetchAdminMetrics(): Promise<AdminMetrics> {
  const admin = getSupabaseAdmin();

  const [
    pageViewsRes,
    oldestPageViewRes,
    profilesRes,
    pipelinesRes,
    ownerMembershipsRes,
    clientInvitesRes,
    billingRes,
    workspacesRes,
  ] = await Promise.all([
    admin
      .from("page_views")
      .select("id", { count: "exact", head: true })
      .eq("path", "/auth/signup"),
    admin
      .from("page_views")
      .select("created_at")
      .eq("path", "/auth/signup")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("pipelines").select("workspace_id"),
    admin
      .from("workspace_memberships")
      .select("workspace_id, user_id")
      .eq("role", "owner"),
    admin.from("client_invites").select("invited_by"),
    admin
      .from("workspace_billing")
      .select(
        "workspace_id, subscription_status, plan, trial_ends_at, created_at, updated_at",
      ),
    admin.from("workspaces").select("id, name"),
  ]);

  for (const [label, res] of [
    ["page_views count", pageViewsRes],
    ["profiles count", profilesRes],
    ["pipelines", pipelinesRes],
    ["owner memberships", ownerMembershipsRes],
    ["client_invites", clientInvitesRes],
    ["workspace_billing", billingRes],
    ["workspaces", workspacesRes],
  ] as const) {
    if (res.error) {
      throw new Error(`[admin-metrics] ${label} query failed: ${res.error.message}`);
    }
  }

  const visitedCount = pageViewsRes.count ?? 0;
  const signedUpCount = profilesRes.count ?? 0;

  // ── Step 3: created a pipeline — distinct owners of a workspace that
  // has at least one pipeline. ──────────────────────────────────────────
  const workspaceIdsWithPipeline = new Set(
    (pipelinesRes.data ?? []).map((p) => p.workspace_id),
  );
  const pipelineCreators = new Set(
    (ownerMembershipsRes.data ?? [])
      .filter((m) => workspaceIdsWithPipeline.has(m.workspace_id))
      .map((m) => m.user_id),
  );

  // ── Step 4: invited a client — distinct inviters. ──────────────────
  const inviters = new Set(
    (clientInvitesRes.data ?? [])
      .map((c) => c.invited_by)
      .filter((id): id is string => !!id),
  );

  // ── Step 5: selected a plan (has a workspace_billing row, any status)
  const workspaceIdsWithBilling = new Set(
    (billingRes.data ?? []).map((b) => b.workspace_id),
  );
  const planSelectors = new Set(
    (ownerMembershipsRes.data ?? [])
      .filter((m) => workspaceIdsWithBilling.has(m.workspace_id))
      .map((m) => m.user_id),
  );

  const rawCounts = [
    visitedCount,
    signedUpCount,
    pipelineCreators.size,
    inviters.size,
    planSelectors.size,
  ];
  const labels = [
    "Visited signup page",
    "Signed up",
    "Created a pipeline",
    "Invited a client",
    "Selected a plan (Solo/Team)",
  ];
  const funnel: FunnelStep[] = rawCounts.map((count, i) => ({
    label: labels[i],
    count,
    pctOfPrevious:
      i === 0 || rawCounts[i - 1] === 0
        ? null
        : Math.round((count / rawCounts[i - 1]) * 1000) / 10,
    pctOfFirst:
      rawCounts[0] === 0 ? null : Math.round((count / rawCounts[0]) * 1000) / 10,
  }));

  // ── Plan / MRR / trial breakdowns ──────────────────────────────────
  const billing = billingRes.data ?? [];
  const active = billing.filter((b) => b.subscription_status === "active");
  const trialing = billing.filter((b) => b.subscription_status === "trialing");
  const everTrialed = billing.filter((b) => b.trial_ends_at !== null);
  const convertedFromTrial = everTrialed.filter(
    (b) => b.subscription_status === "active",
  );

  const planCounts = { solo: 0, team: 0 };
  for (const b of [...active, ...trialing]) {
    if (b.plan === "solo") planCounts.solo += 1;
    else if (b.plan === "team") planCounts.team += 1;
  }

  const seatCounts = await Promise.all(
    active.map((b) => computeAgencySeatCount(b.workspace_id)),
  );
  const mrr = active.reduce((sum, b, i) => {
    const price = PLAN_PRICE[b.plan] ?? 0;
    return sum + price * (seatCounts[i] ?? 0);
  }, 0);

  // ── Cancellations + approximate tenure ─────────────────────────────
  const workspaceNameById = new Map(
    (workspacesRes.data ?? []).map((w) => [w.id, w.name]),
  );
  const cancellations = billing
    .filter((b) => b.subscription_status === "canceled")
    .map((b) => {
      const start = new Date(b.created_at).getTime();
      const end = new Date(b.updated_at).getTime();
      const tenureDays =
        Number.isFinite(start) && Number.isFinite(end) && end >= start
          ? Math.round((end - start) / (1000 * 60 * 60 * 24))
          : null;
      return {
        workspaceName: workspaceNameById.get(b.workspace_id) ?? "(unknown workspace)",
        plan: b.plan,
        tenureDays,
        canceledAround: b.updated_at,
      };
    })
    .sort((a, b) => (a.canceledAround < b.canceledAround ? 1 : -1));

  return {
    funnel,
    pageViewsTrackingSince: oldestPageViewRes.data?.created_at ?? null,
    mrr,
    planCounts,
    activeSubscriptions: active.length,
    trialingSubscriptions: trialing.length,
    trialToPaid: {
      converted: convertedFromTrial.length,
      totalEverTrialed: everTrialed.length,
      rate:
        everTrialed.length === 0
          ? null
          : Math.round((convertedFromTrial.length / everTrialed.length) * 1000) / 10,
    },
    cancellations,
  };
}
