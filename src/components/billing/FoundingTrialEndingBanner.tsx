"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, X, Check } from "lucide-react";

/**
 * Track A founding member upgrade banner — two visual states, one
 * component. The dashboard page determines `variant` and `remainingPhrase`
 * server-side (RLS-protected reads); this component just renders.
 *
 * VARIANTS
 * ────────
 * pre_expiry: status='trialing' AND stripe_subscription_id IS NULL AND
 *   trial_ends_at within 72h. Heading uses formatTrialRemaining()-derived
 *   phrase ("in 3 days" / "tomorrow" / etc.). Urgency-leaning sub-copy.
 *
 * post_expiry: status='canceled' AND is_founding_member=true. Heading
 *   confirms the trial ended. Sub-copy reassures that founding member
 *   status is permanent and the offer remains.
 *
 * Both variants render the same CTA ("Claim 50% off lifetime →") and
 * open the same plan-picker modal. The /api/billing/founding-upgrade
 * route handles pre/post-expiry branching internally, so the modal
 * doesn't need to know which variant triggered it.
 *
 * EMAIL CTA AUTO-OPEN
 * ───────────────────
 * Day-28 emails link to /w/{slug}?founding=upgrade. On mount, the
 * banner reads the query param and auto-opens the modal if present,
 * then router.replace()'s to strip the param (refresh doesn't re-fire).
 *
 * NO LOCALSTORAGE DISMISSAL
 * ─────────────────────────
 * Like StartTrialBanner from Slice 2 — billing nudges are hard until
 * resolved. The banner disappears the moment status flips (the
 * server-side gate flips and the page re-renders).
 *
 * VISUAL TREATMENT
 * ────────────────
 * Stages-blue palette + Sparkles icon, matching StartTrialBanner. Card
 * shape mirrors MissingNameBanner's rounded panel. Modal copy and pricing
 * tiles are founding-specific: strikethrough base price, founding badge
 * per tile, specific-dollar CTA copy.
 */

type Plan = "solo" | "team";
type Variant = "pre_expiry" | "post_expiry";

type CheckoutResponse = {
  url?: string;
  error?: string;
  status?: string;
  stripe_subscription_id?: string;
  workspace_id?: string;
  occurred_at?: string;
  support_hint?: string;
};

const PLAN_DEFS: Array<{
  key: Plan;
  name: string;
  tagline: string;
  basePrice: string;
  foundingPrice: string;
  ctaCopy: string;
  bullets: string[];
}> = [
  {
    key: "solo",
    name: "Solo",
    tagline: "For solo founders and freelancers",
    basePrice: "$29",
    foundingPrice: "$14.50",
    ctaCopy: "Start with $14.50/seat/mo",
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
    tagline: "For agencies with multiple teammates",
    basePrice: "$39",
    foundingPrice: "$19.50",
    ctaCopy: "Start with $19.50/seat/mo",
    bullets: [
      "Multiple agency seats",
      "Everything in Solo",
      "Priority support",
      "Workspace-level team chat (soon)",
    ],
  },
];

export function FoundingTrialEndingBanner({
  workspaceId,
  workspaceSlug: _workspaceSlug,
  variant,
  remainingPhrase,
}: {
  workspaceId: string;
  /** Reserved for future use (deep-linking out to billing details when
   *  Slice 4 ships). Underscore-prefixed to silence the unused-var lint
   *  without changing the prop contract. */
  workspaceSlug: string;
  variant: Variant;
  /** Required for pre_expiry; ignored for post_expiry. Computed by the
   *  server page via formatTrialRemaining(trial_ends_at). */
  remainingPhrase: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Auto-open on ?founding=upgrade (email CTA target). Strip the param
  // so a refresh doesn't re-trigger.
  useEffect(() => {
    if (searchParams.get("founding") === "upgrade") {
      setOpen(true);
      // router.replace with the same path minus the param.
      // useSearchParams is read-only; build the new querystring manually.
      const next = new URLSearchParams(searchParams.toString());
      next.delete("founding");
      const tail = next.toString();
      router.replace(window.location.pathname + (tail ? `?${tail}` : ""));
    }
    // searchParams is stable enough; router is stable. Only re-fire if
    // the param presence changes (which it shouldn't post-mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close modal on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const isPreExpiry = variant === "pre_expiry";
  const heading = isPreExpiry
    ? `Your founding trial ends ${remainingPhrase ?? "soon"}`
    : "Your founding trial ended — you can still claim 50% off lifetime";
  const subCopy = isPreExpiry
    ? "Lock in 50% off Stages forever by adding your card today. You'll keep founding pricing for life, even after we raise base prices."
    : "Your workspace is read-only until you claim 50% off lifetime. Card on file unlocks writes again — and you stay at half price forever.";

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
            {heading}
          </div>
          <p className="text-[12.5px] text-zinc-400 leading-snug mb-3">
            {subCopy}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="btn-primary inline-flex"
          >
            Claim 50% off lifetime →
          </button>
        </div>
      </div>

      {open && (
        <FoundingPlanPickerModal
          workspaceId={workspaceId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Plan-picker modal — pricing tiles with strikethrough base + founding
 * coupon-applied price + per-tile founding badge + specific-dollar CTA
 * copy. POSTs to /api/billing/founding-upgrade and redirects to the
 * returned Checkout URL.
 */
function FoundingPlanPickerModal({
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
      const res = await fetch("/api/billing/founding-upgrade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, plan }),
      });
      let json: CheckoutResponse = {};
      try {
        json = (await res.json()) as CheckoutResponse;
      } catch {
        // Body wasn't JSON — server bug or transport error. Fall to
        // the !res.ok branch's generic message.
      }
      if (!res.ok || !json.url) {
        setError(mapCheckoutError(res.status, json));
        setPendingPlan(null);
        return;
      }
      // Redirect to Stripe Checkout. We don't unset pendingPlan because
      // the page is unmounting.
      window.location.href = json.url;
    } catch (e) {
      console.error("[FoundingTrialEndingBanner] checkout fetch threw:", e);
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
              Choose your founding plan
            </div>
            <div className="text-[12.5px] text-zinc-400 mt-0.5">
              Card on file. 50% off forever — even after we raise base
              prices. Cancel anytime.
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
            <FoundingPlanTile
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

function FoundingPlanTile({
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
      {/* Founding badge above the price block. Subtle stages-blue
          treatment so it reinforces without dominating. */}
      <div
        className="self-start mb-2 px-2 py-0.5 rounded-full text-[10.5px] font-semibold tracking-wide uppercase"
        style={{
          background: "rgba(16, 140, 233, 0.14)",
          color: "#5BB6F5",
          border: "1px solid rgba(16, 140, 233, 0.35)",
        }}
      >
        Founding member — 50% off forever
      </div>

      <div className="text-[15px] font-semibold text-white">{def.name}</div>
      <div className="text-[12.5px] text-zinc-500 mt-0.5">{def.tagline}</div>

      {/* Strikethrough base price + primary founding price. Two-line
          stack so the comparison reads quickly. */}
      <div className="mt-3 mb-3">
        <div className="text-[13px] text-zinc-500 leading-tight">
          <span style={{ textDecoration: "line-through" }}>
            {def.basePrice}
          </span>
          <span className="ml-1 text-zinc-500">/ seat / month</span>
        </div>
        <div className="leading-none mt-1">
          <span className="text-[28px] font-semibold text-white">
            {def.foundingPrice}
          </span>
          <span className="text-[13px] text-zinc-400 ml-1">/ seat / month</span>
        </div>
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
        {loading ? "Starting…" : def.ctaCopy}
      </button>
    </div>
  );
}

function mapCheckoutError(status: number, body: CheckoutResponse): string {
  if (status === 401) return "Please sign in again.";
  if (status === 403 && body.error === "not_authorized") {
    return "Only workspace owners or admins can upgrade.";
  }
  if (status === 403 && body.error === "not_founding_member") {
    return "Founding offer is no longer available on this account. Use the regular Start Trial flow instead.";
  }
  if (status === 409 && body.error === "already_subscribed") {
    return "This workspace is already subscribed.";
  }
  if (status === 409 && body.error === "subscription_already_exists") {
    // Show the full support hint from the route's 409 body. That copy
    // includes the support email + ID + timestamp for the founder to
    // paste into the support thread.
    return body.support_hint ?? "A subscription mismatch occurred — email support@trystages.com for help.";
  }
  if (status === 502) {
    return "Stripe is unreachable right now — please try again in a moment.";
  }
  if (body.error) return body.error;
  return "Couldn't start checkout — please try again.";
}
