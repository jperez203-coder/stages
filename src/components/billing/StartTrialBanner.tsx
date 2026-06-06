"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Sparkles, X, Check, Home, AlertCircle } from "lucide-react";

/**
 * Dashboard banner for Track B (non-founder) trial states. Two
 * variants share the same modal but render different banner cards:
 *
 *   pre_expiry: workspace_billing.subscription_status='trialing' AND
 *     stripe_subscription_id IS NULL AND trial_ends_at > now() AND
 *     NOT is_founding_member. Stages-blue Sparkles treatment with
 *     remaining-time copy "Your free trial ends in X days /
 *     tomorrow / in X hours" via the formatTrialRemaining helper.
 *
 *   expired (Slice 6 NEW): same as above except trial_ends_at <=
 *     now(). Stages-red AlertCircle treatment, urgent copy "Your
 *     trial has ended" + "Add a card to restore your workspace and
 *     continue working." When this variant shows, billing-guard.ts
 *     enforces read-only writes for the same workspace via gate 5
 *     in evaluateWritability — banner promise is truthful.
 *
 * The dashboard page does the visibility check + variant selection
 * server-side; this component just renders. Page passes:
 *   workspaceId, workspaceSlug, variant, remainingPhrase (pre_expiry only)
 *
 * Clicking the CTA opens a shared plan picker modal. Each tile's
 * "Continue with Solo $29/mo" / "Continue with Team $39/mo" button
 * POSTs to /api/billing/checkout with { workspace_id, plan } and
 * redirects (via window.location.href) to the Stripe-hosted Checkout
 * URL returned in the response.
 *
 * BANNER PRECEDENCE (computed by the dashboard page IIFE):
 *   Founders → FoundingTrialEndingBanner (Slice 5, separate component)
 *   Track B + has Stripe sub → no banner (Stripe is managing)
 *   Track B + trialing + pre-deadline → THIS, variant="pre_expiry"
 *   Track B + trialing + post-deadline → THIS, variant="expired"
 *   Track B + canceled/past_due/etc → no banner (rare; guard blocks)
 *
 * Visual treatment mirrors MissingNameBanner (rounded card, icon tile,
 * text + button) but in two distinct palettes — stages-blue (#108CE9)
 * for pre_expiry; stages-red (#F43F5E) for expired.
 *
 * No localStorage dismissal. Billing is a hard nudge until provisioned;
 * a dismissed banner that re-appears the next session would be more
 * confusing than informative. The user can simply not click; the
 * banner disappears the moment the trial is provisioned (status →
 * 'trialing' after the webhook fires) — at which point stripe_
 * subscription_id is non-null and the precedence tree hides the
 * banner.
 */

type Plan = "solo" | "team";

type CheckoutResponse = {
  url?: string;
  error?: string;
  status?: string;
};

// Plan tile content. Copy + icons aligned to the marketing-site pricing
// section so the in-app conversion surface doesn't introduce visual
// drift at the moment of card capture. Subtitle and bullets are
// verbatim from trystages.com's pricing tiles; modal title + 14-day
// subtitle + CTA copy stay in-app-specific (transactional context the
// marketing site doesn't have).
const PLAN_DEFS: Array<{
  key: Plan;
  name: string;
  price: string;
  /** Short audience descriptor — rendered with a Home icon prefix to
   *  match the marketing site treatment. */
  subtitle: string;
  /** Plan icon — public path to the actual marketing-site PNG. Using
   *  the same asset trystages.com renders so brand visual consistency
   *  carries across marketing → app at the conversion moment. Files
   *  live in public/ and are served at their root path. */
  iconSrc: string;
  bullets: string[];
}> = [
  {
    key: "solo",
    name: "Solo",
    price: "$29",
    subtitle: "Freelancers / solopreneurs",
    iconSrc: "/solo-icon.png",
    bullets: [
      "Unlimited pipelines",
      "Unlimited client seats",
      "Unlimited channels",
      "Pre-built pipeline snapshots",
      "File uploads & stage notes",
      "Deadlines and status tracking",
    ],
  },
  {
    key: "team",
    name: "Team",
    price: "$39",
    subtitle: "Agencies / consultancies",
    iconSrc: "/team-icon.png",
    bullets: [
      "Everything in Solo",
      "Multiple members",
      "Role permission (admin/member)",
      "Per-pipeline access controls",
      "Shared workspace history",
      "Priority support",
    ],
  },
];

export type StartTrialBannerVariant = "pre_expiry" | "expired";

export function StartTrialBanner({
  workspaceId,
  workspaceSlug: _workspaceSlug,
  variant,
  remainingPhrase,
}: {
  workspaceId: string;
  /** Reserved for future use (e.g. linking to a workspace-specific
   *  /settings/billing landing once Slice 4 ships). Underscore-prefixed
   *  to silence the unused-var lint without removing the prop — the
   *  page mounts this banner with both pieces of context already in
   *  hand, and we'd rather not change the prop contract later. */
  workspaceSlug: string;
  /** Required as of Slice 6. The dashboard page determines which
   *  variant applies based on workspace_billing.trial_ends_at and
   *  passes it explicitly. No default — forces the caller to be
   *  conscious about which state they're rendering. */
  variant: StartTrialBannerVariant;
  /** Required when variant === "pre_expiry"; ignored otherwise. The
   *  dashboard page computes this via formatTrialRemaining(trial_ends_at)
   *  so the subtitle reads "Your free trial ends in 3 days" / "tomorrow"
   *  / "in 5 hours" etc. Null on expired variant (we don't render time
   *  in the past). */
  remainingPhrase: string | null;
}) {
  const [open, setOpen] = useState(false);

  // Close modal on Escape. Listener only attached while open to avoid
  // intercepting Escape in other UIs.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Variant-specific visual treatment. Both variants share the same
  // card shape (rounded-lg + p-4 + icon tile + text stack + CTA) but
  // use distinct palettes — blue for pre_expiry, red for expired.
  // CTA button is btn-primary blue in BOTH cases (locked decision —
  // red CTA on red banner reads as 'destructive action'; blue CTA on
  // red banner reads as 'fix this').
  const isExpired = variant === "expired";
  const cardBg = isExpired
    ? "rgba(244, 63, 94, 0.08)"
    : "rgba(16, 140, 233, 0.08)";
  const cardBorder = isExpired
    ? "1px solid rgba(244, 63, 94, 0.40)"
    : "1px solid rgba(16, 140, 233, 0.35)";
  const iconBg = isExpired
    ? "rgba(244, 63, 94, 0.18)"
    : "rgba(16, 140, 233, 0.18)";
  const iconColor = isExpired ? "text-stages-red" : "text-stages-blue";
  const heading = isExpired
    ? "Your trial has ended"
    : "Add your card to keep your workspace active";
  const subtitle = isExpired
    ? "Add a card to restore your workspace and continue working."
    : `Your free trial ends ${remainingPhrase ?? "soon"}`;
  const Icon = isExpired ? AlertCircle : Sparkles;

  return (
    <>
      <div
        className="mt-6 mb-2 p-4 rounded-lg flex items-start gap-3"
        style={{
          background: cardBg,
          border: cardBorder,
        }}
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: iconBg }}
        >
          <Icon size={16} className={iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-zinc-100 mb-0.5">
            {heading}
          </div>
          <p className="text-[12.5px] text-zinc-400 leading-snug mb-3">
            {subtitle}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary inline-flex"
          >
            Add card
          </button>
        </div>
      </div>

      {open && (
        <PlanPickerModal
          workspaceId={workspaceId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Modal overlay with Solo + Team plan tiles. Each tile's CTA POSTs to
 * /api/billing/checkout, then window.location.href to the returned
 * Stripe URL. Errors render inline beneath the tile that triggered
 * them.
 */
function PlanPickerModal({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = async (plan: Plan) => {
    setError(null);
    setPendingPlan(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, plan }),
      });
      let json: CheckoutResponse = {};
      try {
        json = (await res.json()) as CheckoutResponse;
      } catch {
        // Body wasn't JSON — server bug, fall through to res.ok branch
        // which will hit the generic error message below.
      }
      if (!res.ok || !json.url) {
        const msg = mapCheckoutError(res.status, json);
        setError(msg);
        setPendingPlan(null);
        return;
      }
      // Redirect to Stripe Checkout. The next thing the browser shows
      // is the Stripe-hosted page; we don't unset pendingPlan because
      // the page is unmounting.
      window.location.href = json.url;
    } catch (e) {
      console.error("[StartTrialBanner] checkout fetch threw:", e);
      setError("Something went wrong — please try again.");
      setPendingPlan(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        // Backdrop click closes the modal. Children stopPropagation
        // below so a click on a tile doesn't bubble here.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="panel-card w-[calc(100vw-2rem)] max-w-[760px] p-6"
        style={{
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[18px] font-semibold text-white">
              Choose your plan
            </div>
            <div className="text-[12.5px] text-zinc-400 mt-0.5">
              Add a card to keep your workspace active. Cancel anytime.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1 -mr-1 -mt-1"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PLAN_DEFS.map((p) => (
            <PlanTile
              key={p.key}
              def={p}
              loading={pendingPlan === p.key}
              disabled={pendingPlan !== null && pendingPlan !== p.key}
              onSelect={() => startCheckout(p.key)}
            />
          ))}
        </div>

        {error && (
          <div
            className="mt-4 px-3 py-2 rounded-md text-[12.5px]"
            style={{
              background: "rgba(244, 63, 94, 0.10)",
              border: "1px solid rgba(244, 63, 94, 0.45)",
              color: "#FECDD3",
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTile({
  def,
  loading,
  disabled,
  onSelect,
}: {
  def: (typeof PLAN_DEFS)[number];
  loading: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className="p-6 rounded-lg flex flex-col"
      style={{
        background: "#1F1F22",
        border: "1px solid #36363A",
      }}
    >
      {/* Header row — 48×48 icon block + plan name. The icon-block
          treatment + the larger plan-name typography are the two
          biggest visual shifts vs. the pre-polish tile. Plan name at
          28px gives it second-loudest-on-the-tile weight (price is
          first); matches the marketing-site visual rhythm. Inner icon
          is the actual marketing-site PNG (Apple-emoji-styled),
          loaded from /public via next/image for automatic
          optimization + lazy loading. */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center"
          style={{
            background: "#1F1F22",
            border: "1px solid #36363A",
          }}
        >
          <Image
            src={def.iconSrc}
            width={32}
            height={32}
            alt={`${def.name} icon`}
          />
        </div>
        <div className="text-[28px] font-bold text-zinc-100 leading-none">
          {def.name}
        </div>
      </div>

      {/* Subtitle with Home icon prefix — matches marketing site's
          "🏠 Freelancers / solopreneurs" pattern. */}
      <div className="flex items-center gap-1.5 text-[13px] text-zinc-500 mb-4">
        <Home size={13} className="flex-shrink-0" />
        <span>{def.subtitle}</span>
      </div>

      {/* Price block — 40px bold for the dollar amount, 13px zinc-400
          for "per seat / month". The two strings sit on the same
          baseline; ml-2 on the suffix keeps it visually attached to
          the price without crowding. */}
      <div className="mb-5 flex items-baseline">
        <span className="text-[40px] font-bold text-zinc-100 leading-none">
          {def.price}
        </span>
        <span className="text-[13px] text-zinc-400 ml-2">
          per seat / month
        </span>
      </div>

      {/* Feature list — 6 bullets per plan. flex-1 pushes the CTA to
          the bottom of the tile so both tiles' CTAs align even if
          their bullet copy lengths differ. Filled green checkmark
          square is the new visual replacement for the plain Check
          icon — matches the marketing site treatment. */}
      <ul className="space-y-2.5 mb-6 flex-1">
        {def.bullets.map((b) => (
          <li
            key={b}
            className="flex items-start gap-2 text-[13.5px] text-zinc-300"
          >
            <span
              className="flex-shrink-0 mt-0.5 w-4 h-4 rounded-sm flex items-center justify-center"
              style={{ background: "#15B981" }}
            >
              <Check size={11} className="text-white" strokeWidth={3.5} />
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onSelect}
        disabled={loading || disabled}
        className="btn-primary w-full"
        style={{
          opacity: disabled && !loading ? 0.5 : 1,
          cursor: loading ? "wait" : disabled ? "not-allowed" : "pointer",
        }}
      >
        {loading ? "Starting…" : `Continue with ${def.name} ${def.price}/mo`}
      </button>
    </div>
  );
}

function mapCheckoutError(status: number, body: CheckoutResponse): string {
  // Map server-side error responses to user-friendly text. The
  // server's `error` field is plain English already (set in
  // checkout/route.ts), so we mostly pass it through but with
  // status-specific overrides for the common cases.
  if (status === 401) return "Please sign in again.";
  if (status === 403) {
    return "Only workspace owners or admins can start a subscription.";
  }
  if (status === 409) {
    return body.status
      ? `This workspace already has an active subscription (${body.status}).`
      : "This workspace already has an active subscription.";
  }
  if (status === 502) {
    return "Stripe is unreachable right now — please try again in a moment.";
  }
  if (body.error) return body.error;
  return "Couldn't start checkout — please try again.";
}
