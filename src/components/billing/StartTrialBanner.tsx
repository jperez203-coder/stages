"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  X,
  Check,
  BarChart3,
  Building2,
  Home,
  type LucideIcon,
} from "lucide-react";

/**
 * Dashboard banner inviting workspace owners/admins to start their
 * 14-day Stages free trial. Mounts only when the dashboard page's
 * server-side gate determines:
 *   * caller is workspace owner OR admin (RLS-aligned check), AND
 *   * workspace_billing.subscription_status is NULL (no row) or
 *     'canceled' (NOT in trialing / active / past_due — those mean
 *     billing is already provisioned).
 *
 * The page does the visibility check; this component just renders
 * when mounted. That keeps the banner stateless about "should I show?"
 * and lets the page batch the billing-status query alongside the rest
 * of its parallel data fetch.
 *
 * Clicking "Choose a plan" opens a modal with Solo / Team tiles. Each
 * tile's "Start 14-day trial" button POSTs to /api/billing/checkout
 * with { workspace_id, plan } and redirects (via window.location.href)
 * to the Stripe-hosted Checkout URL returned in the response.
 *
 * Visual treatment mirrors MissingNameBanner (rounded card, icon tile,
 * text + button) but uses the stages-blue token (#108CE9) — primary
 * actions / feature CTAs — rather than stages-amber (the "needs
 * attention / incomplete" token used by MissingNameBanner).
 *
 * No localStorage dismissal. Billing is a hard nudge until provisioned;
 * a dismissed banner that re-appears the next session would be more
 * confusing than informative. The user can simply not click; the
 * banner disappears the moment the trial is provisioned (status →
 * 'trialing' after the webhook fires).
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
  /** Plan icon, rendered inside the 48×48 tile-header block. Lucide
   *  monochrome — Solo's "colored bars" on the marketing site is
   *  aesthetic detail, not functional info; the icon CONCEPT is the
   *  recognition signal. */
  Icon: LucideIcon;
  bullets: string[];
}> = [
  {
    key: "solo",
    name: "Solo",
    price: "$29",
    subtitle: "Freelancers / solopreneurs",
    Icon: BarChart3,
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
    Icon: Building2,
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

export function StartTrialBanner({
  workspaceId,
  workspaceSlug: _workspaceSlug,
}: {
  workspaceId: string;
  /** Reserved for future use (e.g. linking to a workspace-specific
   *  /settings/billing landing once Slice 4 ships). Underscore-prefixed
   *  to silence the unused-var lint without removing the prop — the
   *  page mounts this banner with both pieces of context already in
   *  hand, and we'd rather not change the prop contract later. */
  workspaceSlug: string;
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

  return (
    <>
      <div
        className="mt-6 mb-2 p-4 rounded-lg flex items-start gap-3"
        style={{
          background: "rgba(16, 140, 233, 0.08)",
          border: "1px solid rgba(16, 140, 233, 0.35)",
        }}
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: "rgba(16, 140, 233, 0.18)" }}
        >
          <Sparkles size={16} className="text-stages-blue" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-zinc-100 mb-0.5">
            Start your 14-day free trial
          </div>
          <p className="text-[12.5px] text-zinc-400 leading-snug mb-3">
            Try Stages free for 14 days on any plan. Card required to
            start — you can change or cancel anytime before day 14.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary inline-flex"
          >
            Choose a plan
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
              14-day free trial. Card on file. Cancel anytime before day 14.
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
  const Icon = def.Icon;
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
          first); matches the marketing-site visual rhythm. */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center"
          style={{
            background: "#1F1F22",
            border: "1px solid #36363A",
          }}
        >
          <Icon size={24} className="text-zinc-100" />
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
        {loading ? "Starting…" : "Start 14-day trial"}
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
