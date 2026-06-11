import { redirect } from "next/navigation";
import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getWorkspaceSeatCountSSR } from "@/lib/seat-count";
import { formatTrialRemaining } from "@/lib/email";
import { WorkspaceSettingsTabs } from "@/components/settings/WorkspaceSettingsTabs";
import { ManageBillingButton } from "@/components/billing/ManageBillingButton";

/**
 * Workspace billing settings at /w/[slug]/settings/billing.
 *
 * Server-rendered. Reads:
 *   - workspace_memberships.role (owner/admin gate)
 *   - workspace_billing (status, plan, trial_ends_at, current_period_end,
 *     stripe_subscription_id, stripe_customer_id-via-user_billing-join)
 *   - user_billing.stripe_customer_id (proxies founding/non-founding billing
 *     identity presence for the empty-state branching)
 *   - profiles.is_founding_member (for the FOUNDING MEMBER badge)
 *   - seat count via getWorkspaceSeatCountSSR (RLS-respecting)
 *
 * Four render states (precedence top to bottom):
 *   1. Not signed in → /auth/signin redirect (handled at the auth layer)
 *   2. Not owner/admin of THIS workspace → "You don't have access" card
 *   3. Subscribed (status in trialing/active/past_due) → plan + seats +
 *      Manage billing CTA
 *   4. Not subscribed (canceled, or no workspace_billing row) → empty
 *      state with link back to dashboard (where the StartTrialBanner OR
 *      FoundingTrialEndingBanner will surface based on persona)
 *
 * Founding badge: rendered top-right of the plan card when
 * profiles.is_founding_member = true. Text is short ("FOUNDING MEMBER")
 * because the strikethrough pricing math on the same card already
 * communicates the 50%-off context. The longer "50% OFF FOREVER"
 * variant lives in the upgrade modal (Slice 5), where copy is selling.
 *
 * Manage billing CTA → POST /api/billing/portal-session →
 * window.location to the Stripe-hosted portal URL. Handled by the
 * <ManageBillingButton /> client component (separate file).
 *
 * STATUS SUBHEADER per locked decision: status-specific text rather than
 * generic "Active subscription," because "Active" mid-trial reads as
 * "I'm being charged":
 *   - trialing → "On free trial"
 *   - active   → "Paid subscription"
 *   - past_due → "Payment issue"  (red urgency caption added below the
 *                                  pricing block)
 */

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function BillingSettingsPage({ params }: PageProps) {
  const { slug } = await params;
  const supa = await createSupabaseServerClient();

  // ── Auth ────────────────────────────────────────────────────────────────
  const { data: userResult } = await supa.auth.getUser();
  const user = userResult?.user;
  if (!user) {
    redirect(`/auth/signin?next=/w/${encodeURIComponent(slug)}/settings/billing`);
  }
  const userId = user.id;

  // ── Resolve workspace + membership ──────────────────────────────────────
  // Joined query: workspace_memberships → workspaces. Returns null when
  // the user is not a workspace member of this slug (same pattern as the
  // dashboard page).
  const wsMemRes = await supa
    .from("workspace_memberships")
    .select("role, workspace:workspaces!inner(id, name, slug, type)")
    .eq("user_id", userId)
    .eq("workspace.slug", slug)
    .maybeSingle();

  type WsRow = {
    id: string;
    name: string;
    slug: string;
    type: "agency" | "personal";
  };
  const wsRaw = wsMemRes.data?.workspace as unknown;
  const ws: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  if (!wsMemRes.data || !ws) {
    // Not a workspace member at all — bounce them out. Same posture as
    // the dashboard's not-a-member fallback (deliberate non-disclosure of
    // workspace existence to non-members).
    redirect(`/w/${encodeURIComponent(slug)}`);
  }

  // WT-5: personal workspaces are free — no plan, no trial, no Stripe.
  // Render a simple info card explaining that. Placed BEFORE the
  // owner/admin gate because personal workspaces are solo-by-definition
  // (only one membership row, always role='owner'), so the role gate
  // doesn't add anything for the personal case. Anyone who can read the
  // workspace can read this card.
  if (ws.type === "personal") {
    return (
      <WorkspaceSettingsTabs activeTab="billing" slug={slug}>
        <PersonalWorkspaceCard />
      </WorkspaceSettingsTabs>
    );
  }

  const role = wsMemRes.data.role;
  const isOwnerOrAdmin = role === "owner" || role === "admin";

  // ── Not owner/admin → render restricted state (NOT a redirect, NOT a
  //    404 — clean explanation per locked spec) ──────────────────────────
  if (!isOwnerOrAdmin) {
    return (
      <WorkspaceSettingsTabs activeTab="billing" slug={slug}>
        <RestrictedCard workspaceSlug={slug} />
      </WorkspaceSettingsTabs>
    );
  }

  // ── Owner/admin: fetch the billing state for display ───────────────────
  // Three parallel reads. RLS lets owner/admin see workspace_billing
  // (slice 1). user_billing is self-read (owner can read their own row).
  // Profile read for is_founding_member badge driver.
  // Plus seat count via the SSR-RLS-respecting helper.
  const [billingRes, userBillingRes, profileRes, seatCount] = await Promise.all([
    supa
      .from("workspace_billing")
      .select(
        "subscription_status, stripe_subscription_id, plan, trial_ends_at, current_period_end",
      )
      .eq("workspace_id", ws.id)
      .maybeSingle(),

    supa
      .from("user_billing")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle(),

    supa
      .from("profiles")
      .select("is_founding_member")
      .eq("id", userId)
      .maybeSingle(),

    getWorkspaceSeatCountSSR(ws.id),
  ]);

  const billing = billingRes.data;
  const stripeCustomerId = userBillingRes.data?.stripe_customer_id ?? null;
  const isFounder = profileRes.data?.is_founding_member === true;

  const status = billing?.subscription_status ?? null;
  const isSubscribed =
    status === "trialing" || status === "active" || status === "past_due";

  // ── Empty state — no active subscription ───────────────────────────────
  if (!isSubscribed) {
    return (
      <WorkspaceSettingsTabs activeTab="billing" slug={slug}>
        <EmptyState workspaceSlug={slug} />
      </WorkspaceSettingsTabs>
    );
  }

  // ── Subscribed state — plan + seats + manage-billing cards ─────────────
  const plan = (billing?.plan as "solo" | "team" | null) ?? "solo";
  const trialEndsAt = billing?.trial_ends_at ?? null;
  const currentPeriodEnd = billing?.current_period_end ?? null;

  return (
    <WorkspaceSettingsTabs activeTab="billing" slug={slug}>
      <PlanCard
        plan={plan}
        status={status as "trialing" | "active" | "past_due"}
        trialEndsAt={trialEndsAt}
        currentPeriodEnd={currentPeriodEnd}
        isFounder={isFounder}
      />
      <SeatsCard seatCount={seatCount} workspaceSlug={slug} />
      <ManageBillingCard
        workspaceId={ws.id}
        hasStripeCustomer={stripeCustomerId !== null}
        workspaceSlug={slug}
        isFounder={isFounder}
      />
    </WorkspaceSettingsTabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// State cards
// ─────────────────────────────────────────────────────────────────────────

/**
 * WT-5: personal-workspace info card. Plain one-sentence explainer with
 * the Sparkles icon (matches the EmptyState's visual idiom — same icon
 * tile, same headline scale). No upgrade CTA — personal workspaces are
 * a separate category, not a tier to upgrade from.
 */
function PersonalWorkspaceCard() {
  return (
    <div className="panel-card p-8 text-center max-w-[480px] mx-auto mt-12">
      <div className="flex justify-center mb-4">
        <Sparkles size={32} className="text-stages-blue" />
      </div>
      <div className="text-[18px] font-semibold text-zinc-100 mb-2">
        Personal workspace
      </div>
      <p className="text-[14px] text-zinc-500 leading-snug">
        This is a Personal workspace. Personal workspaces are free and
        don&apos;t require a subscription.
      </p>
    </div>
  );
}

function RestrictedCard({ workspaceSlug }: { workspaceSlug: string }) {
  return (
    <div className="panel-card p-8 text-center max-w-[480px] mx-auto mt-12">
      <div className="flex justify-center mb-4">
        <Lock size={28} className="text-zinc-500" strokeWidth={1.75} />
      </div>
      <div className="text-[18px] font-semibold text-zinc-100 mb-2">
        You don&apos;t have access
      </div>
      <p className="text-[14px] text-zinc-500 mb-6 leading-snug">
        Only workspace owners and admins can manage billing.
      </p>
      <Link
        href={`/w/${encodeURIComponent(workspaceSlug)}`}
        className="text-[13px] text-zinc-400 hover:text-zinc-200"
      >
        Back to dashboard
      </Link>
    </div>
  );
}

function EmptyState({ workspaceSlug }: { workspaceSlug: string }) {
  return (
    <div className="panel-card p-8 text-center max-w-[480px] mx-auto mt-12">
      <div className="flex justify-center mb-4">
        <Sparkles size={32} className="text-stages-blue" />
      </div>
      <div className="text-[18px] font-semibold text-zinc-100 mb-2">
        No active subscription
      </div>
      <p className="text-[14px] text-zinc-500 mb-6 leading-snug">
        Start a 14-day free trial from your dashboard to unlock writes and
        manage billing.
      </p>
      <Link
        href={`/w/${encodeURIComponent(workspaceSlug)}`}
        className="btn-primary inline-flex"
      >
        Back to dashboard →
      </Link>
    </div>
  );
}

function PlanCard({
  plan,
  status,
  trialEndsAt,
  currentPeriodEnd,
  isFounder,
}: {
  plan: "solo" | "team";
  status: "trialing" | "active" | "past_due";
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  isFounder: boolean;
}) {
  const planName = plan === "solo" ? "Stages Solo" : "Stages Team";
  const basePrice = plan === "solo" ? "$29" : "$39";
  const foundingPrice = plan === "solo" ? "$14.50" : "$19.50";

  const subheader =
    status === "trialing"
      ? "On free trial"
      : status === "active"
        ? "Paid subscription"
        : "Payment issue";

  // Date formatting via Intl for locale correctness. Use the "first charge"
  // date semantics: trialing → trial_ends_at; active → current_period_end
  // (next charge); past_due → current_period_end (when access stops).
  const referenceDate =
    status === "trialing"
      ? trialEndsAt
      : currentPeriodEnd;
  const referenceDateText = referenceDate
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(referenceDate))
    : null;

  // "Trial ends in 12 days" via the shared formatTrialRemaining helper —
  // same util the Slice 5 founding banner + day-28 email use. One source of
  // truth for the relative-time math.
  const remainingPhrase =
    status === "trialing" && trialEndsAt
      ? formatTrialRemaining(new Date(trialEndsAt))
      : null;

  return (
    <div className="panel-card p-6 mb-4">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="text-[18px] font-semibold text-zinc-100">
            {planName}
          </div>
          <div
            className={`text-[13px] mt-0.5 ${
              status === "past_due" ? "text-stages-red" : "text-zinc-500"
            }`}
          >
            {subheader}
          </div>
        </div>
        {isFounder && (
          <div
            className="flex-shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-semibold tracking-wide uppercase"
            style={{
              background: "rgba(110, 91, 232, 0.14)",
              color: "#9586EE",
              border: "1px solid rgba(110, 91, 232, 0.45)",
            }}
          >
            ⊛ Founding member
          </div>
        )}
      </div>

      {/* Pricing block — strikethrough math when founder, plain price
          otherwise. */}
      <div className="mb-3">
        {isFounder ? (
          <>
            <span className="text-[15px] text-zinc-500 line-through mr-2">
              {basePrice}
            </span>
            <span className="text-[20px] font-semibold text-zinc-100">
              {foundingPrice}
            </span>
            <span className="text-[13px] text-zinc-400 ml-1.5">
              / seat / month
            </span>
          </>
        ) : (
          <>
            <span className="text-[20px] font-semibold text-zinc-100">
              {basePrice}
            </span>
            <span className="text-[13px] text-zinc-400 ml-1.5">
              / seat / month
            </span>
          </>
        )}
      </div>

      {/* Trial / billing-cycle copy. Status-specific. */}
      {status === "trialing" && remainingPhrase && referenceDateText && (
        <div className="text-[13px] text-zinc-400">
          Trial ends {remainingPhrase} · first charge on {referenceDateText}
        </div>
      )}
      {status === "active" && referenceDateText && (
        <div className="text-[13px] text-zinc-400">
          Next charge on {referenceDateText}
        </div>
      )}
      {status === "past_due" && (
        <>
          {referenceDateText && (
            <div className="text-[13px] text-zinc-400 mb-1.5">
              Last charge attempt: {referenceDateText}
            </div>
          )}
          <div className="text-[13px] text-stages-red">
            ⚠ Update your payment method to avoid losing access.
          </div>
        </>
      )}
    </div>
  );
}

function SeatsCard({
  seatCount,
  workspaceSlug,
}: {
  seatCount: number | null;
  workspaceSlug: string;
}) {
  return (
    <div className="panel-card p-6 mb-4">
      <div className="text-[14px] font-semibold text-zinc-100 mb-2">
        Agency seats
      </div>
      <div className="text-[24px] font-semibold text-zinc-100 mb-2">
        {seatCount !== null ? (
          <>
            {seatCount} <span className="text-[14px] font-normal text-zinc-500">used</span>
          </>
        ) : (
          <span className="text-[14px] font-normal text-zinc-500">
            Seat count unavailable
          </span>
        )}
      </div>
      <p className="text-[13px] text-zinc-500 mb-4 leading-snug">
        Seats are billed based on your active workspace members. Updated
        daily by an automatic sync.
      </p>
      <Link
        href={`/w/${encodeURIComponent(workspaceSlug)}/settings/team`}
        className="text-[13px] text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1"
      >
        Manage members →
      </Link>
    </div>
  );
}

function ManageBillingCard({
  workspaceId,
  hasStripeCustomer,
  workspaceSlug,
  isFounder,
}: {
  workspaceId: string;
  hasStripeCustomer: boolean;
  workspaceSlug: string;
  isFounder: boolean;
}) {
  return (
    <div className="panel-card p-6">
      <div className="text-[14px] font-semibold text-zinc-100 mb-2">
        Manage your subscription
      </div>
      <p className="text-[13px] text-zinc-500 mb-5 leading-snug">
        Cancel, switch plans, update payment method, or view past invoices
        in the Stripe billing portal.
      </p>
      <ManageBillingButton
        workspaceId={workspaceId}
        hasStripeCustomer={hasStripeCustomer}
        workspaceSlug={workspaceSlug}
        isFounder={isFounder}
      />
    </div>
  );
}
