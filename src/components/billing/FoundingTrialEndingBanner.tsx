"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, X, Check, Home } from "lucide-react";
import { useUserContexts } from "@/hooks/useUserContexts";

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

// Tile content. Subtitle + iconSrc + bullets mirror the PlanPickerModal
// defs in StartTrialBanner.tsx verbatim — same audience descriptor, same
// marketing-site PNG icons, same 6-bullet feature lists — so the founder
// modal reads as the standard modal plus the founding-specific elements
// (badge, strikethrough pricing, founding CTA copy). The two basePrice /
// foundingPrice / ctaCopy fields are the only intentional copy drift
// from PlanPickerModal — they encode the founder-specific pricing math.
const PLAN_DEFS: Array<{
  key: Plan;
  name: string;
  /** Short audience descriptor — rendered with a Home icon prefix to
   *  match the marketing site treatment. Copy verbatim from
   *  PlanPickerModal so the founder modal feels like the same tile
   *  with a discount layer on top. */
  subtitle: string;
  /** Plan icon — same PNGs PlanPickerModal serves so the brand visual
   *  carries from marketing → standard plan modal → founding plan
   *  modal at the conversion moment. Files live in public/. */
  iconSrc: string;
  basePrice: string;
  foundingPrice: string;
  ctaCopy: string;
  bullets: string[];
}> = [
  {
    key: "solo",
    name: "Solo",
    subtitle: "Freelancers / solopreneurs",
    iconSrc: "/solo-icon.png",
    basePrice: "$29",
    foundingPrice: "$14.50",
    ctaCopy: "Start with $14.50/seat/mo",
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
    subtitle: "Agencies / consultancies",
    iconSrc: "/team-icon.png",
    basePrice: "$39",
    foundingPrice: "$19.50",
    ctaCopy: "Start with $19.50/seat/mo",
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
  // WT-5: self-suppress on personal workspaces. Personal workspaces
  // don't have a workspace_billing row (WT-4 trigger skip) so the
  // dashboard precedence shouldn't mount this banner — defense in
  // depth against pre-WT-4 rows or future drift.
  const contexts = useUserContexts();

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

  // WT-5: personal-workspace self-suppress. Placed after all hook
  // calls so the rules-of-hooks order stays stable across renders.
  if (contexts.status === "ready") {
    const ctx = contexts.contexts.find(
      (c) => c.type === "agency" && c.workspaceId === workspaceId,
    );
    if (ctx?.workspaceType === "personal") return null;
  }

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
 *
 * Exported so the billing tab's <ManageBillingButton /> can mount it
 * in place for founders hitting the "No Stripe customer yet" 404
 * branch — mirrors the parallel PlanPickerModal export from
 * StartTrialBanner.tsx for Track B users. The modal is self-contained:
 * no URL-param coupling (that lives in FoundingTrialEndingBanner's
 * effect) so it safely mounts anywhere.
 */
export function FoundingPlanPickerModal({
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

/**
 * Tile markup mirrors PlanPickerModal's PlanTile (StartTrialBanner.tsx)
 * for visual parity at the conversion moment — same container padding +
 * border, same 48×48 PNG-icon block, same 28px plan-name typography,
 * same Home-icon-prefixed audience subtitle, same 40px price weight,
 * same green filled-checkbox feature list, same full-width btn-primary
 * CTA. Founder-specific elements (badge pill + strikethrough base
 * price + founding CTA copy) overlay this base. Duplicated inline
 * rather than extracted into a shared subcomponent per the strategy
 * direction not to touch PlanPickerModal — option (b) in the brief.
 */
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
      className="p-6 rounded-lg flex flex-col"
      style={{
        background: "#1F1F22",
        border: "1px solid #36363A",
      }}
    >
      {/* Founding badge above the icon row. Subtle stages-blue
          treatment so it reinforces the offer without dominating the
          plan-name typography. Preserved styling from the pre-alignment
          tile. */}
      <div
        className="self-start mb-3 px-2 py-0.5 rounded-full text-[10.5px] font-semibold tracking-wide uppercase"
        style={{
          background: "rgba(16, 140, 233, 0.14)",
          color: "#5BB6F5",
          border: "1px solid rgba(16, 140, 233, 0.35)",
        }}
      >
        Founding member — 50% off forever
      </div>

      {/* Header row — 48×48 PNG icon block + 28px plan name. Same
          treatment as PlanPickerModal so the brand visual carries
          across marketing → standard modal → founding modal. */}
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

      {/* Subtitle row — Home icon + audience descriptor, mirroring
          PlanPickerModal's "🏠 Freelancers / solopreneurs" pattern. */}
      <div className="flex items-center gap-1.5 text-[13px] text-zinc-500 mb-4">
        <Home size={13} className="flex-shrink-0" />
        <span>{def.subtitle}</span>
      </div>

      {/* Pricing block — strikethrough base price on a small upper
          line, 40px founding price baseline-aligned with the "per seat
          / month" suffix on the lower line. Matches PlanPickerModal's
          price weight + suffix treatment. */}
      <div className="mb-5">
        <div className="text-[13px] text-zinc-500 leading-tight mb-1">
          <span style={{ textDecoration: "line-through" }}>
            {def.basePrice}
          </span>
          <span className="ml-1">/ seat / month</span>
        </div>
        <div className="flex items-baseline">
          <span className="text-[40px] font-bold text-zinc-100 leading-none">
            {def.foundingPrice}
          </span>
          <span className="text-[13px] text-zinc-400 ml-2">
            per seat / month
          </span>
        </div>
      </div>

      {/* Feature list — 6 bullets per plan, parity with PlanPickerModal.
          Filled green checkbox square (16×16, rounded-sm, bg #15B981,
          inner Check icon at strokeWidth 3.5) replaces the prior plain
          Check icon. flex-1 pushes the CTA to the bottom of the tile so
          both tiles' CTAs align even if their bullet copy lengths
          differ. */}
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

      {/* CTA — full-width btn-primary with founder-specific dollar copy
          ("Start with $14.50/seat/mo" / "Start with $19.50/seat/mo"),
          preserving the founder offer's headline number at the moment
          of conversion. */}
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
