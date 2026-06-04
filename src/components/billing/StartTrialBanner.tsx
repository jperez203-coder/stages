"use client";

import { useEffect, useState } from "react";
import { Sparkles, X, Check } from "lucide-react";

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

const PLAN_DEFS: Array<{
  key: Plan;
  name: string;
  price: string;
  tagline: string;
  bullets: string[];
}> = [
  {
    key: "solo",
    name: "Solo",
    price: "$29",
    tagline: "For solo founders and freelancers",
    bullets: [
      "One agency seat (you)",
      "Unlimited client portals",
      "Unlimited pipelines",
      "Custom templates",
    ],
  },
  {
    key: "team",
    name: "Team",
    price: "$39",
    tagline: "For agencies with multiple teammates",
    bullets: [
      "Multiple agency seats",
      "Everything in Solo",
      "Priority support",
      "Workspace-level team chat (soon)",
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
        className="panel-card w-full max-w-[640px] p-6"
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
  return (
    <div
      className="p-4 rounded-lg flex flex-col"
      style={{
        background: "#1F1F22",
        border: "1px solid #36363A",
      }}
    >
      <div className="text-[15px] font-semibold text-white">{def.name}</div>
      <div className="text-[12.5px] text-zinc-500 mt-0.5">{def.tagline}</div>
      <div className="mt-3 mb-3">
        <span className="text-[28px] font-semibold text-white">
          {def.price}
        </span>
        <span className="text-[13px] text-zinc-400 ml-1">/ seat / month</span>
      </div>
      <ul className="space-y-1.5 mb-4 flex-1">
        {def.bullets.map((b) => (
          <li
            key={b}
            className="flex items-start gap-2 text-[12.5px] text-zinc-300"
          >
            <Check
              size={12}
              className="flex-shrink-0 mt-1 text-stages-green"
              strokeWidth={3}
            />
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
