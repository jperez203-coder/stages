"use client";

import { useState } from "react";
import { PlanPickerModal } from "@/components/billing/StartTrialBanner";
import { FoundingPlanPickerModal } from "@/components/billing/FoundingTrialEndingBanner";
import { useUserContexts } from "@/hooks/useUserContexts";

/**
 * Manage-billing CTA on /w/[slug]/settings/billing.
 *
 * On click:
 *   1. POSTs to /api/billing/portal-session with { workspace_id }.
 *   2. On 200 → window.location.href = response.url (Stripe-hosted portal).
 *   3. On error → revert button, render inline error caption mapped from
 *      the route's status code + error code.
 *
 * The "no_billing_yet" 404 case renders a "Start a trial first →"
 * affordance that opens the SAME plan-picker modal the dashboard's
 * banners use — mounted in place over the billing tab. Pre-fix this
 * was a <Link> back to /w/[slug] which dumped the user on the dashboard
 * and forced them to hunt for the right banner to retrigger the modal.
 *
 * FOUNDER BRANCHING (added 2026-06-08): the modal rendered depends on
 * isFounder, mirroring the dashboard's banner-precedence rule
 * (computed server-side in /w/[slug]/page.tsx):
 *
 *   isFounder=true  → FoundingPlanPickerModal — strikethrough base
 *                     pricing + $14.50 / $19.50 founding tiles.
 *                     Routes through /api/billing/founding-upgrade
 *                     with the lifetime 50%-off coupon applied.
 *   isFounder=false → PlanPickerModal — Track B Solo $29 / Team $39.
 *                     Routes through /api/billing/checkout.
 *
 * Same source of truth as the dashboard (profiles.is_founding_member),
 * read server-side in billing/page.tsx and passed in as a prop. No
 * new lookup — matches the FoundingTrialEndingBanner mount pattern.
 *
 * Other errors get a generic retry caption.
 *
 * `hasStripeCustomer` prop is the server-side hint about whether the
 * 404 no_billing_yet case is likely. The button DOES NOT pre-disable
 * itself when hasStripeCustomer is false — server's the source of
 * truth for that branch, and the button still hits the API to get the
 * authoritative answer. The prop is reserved for future "Start trial
 * first" prominence; currently unused but kept on the contract.
 *
 * `workspaceSlug` is no longer used since the affordance opens a modal
 * in place (the pre-fix <Link> needed it for the /w/[slug] href).
 * Kept on the contract for the same reason as hasStripeCustomer.
 */

type ApiResponse = {
  url?: string;
  error?: string;
};

export function ManageBillingButton({
  workspaceId,
  hasStripeCustomer: _hasStripeCustomer,
  workspaceSlug: _workspaceSlug,
  isFounder,
}: {
  workspaceId: string;
  hasStripeCustomer: boolean;
  workspaceSlug: string;
  isFounder: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    code: "session_expired" | "no_billing_yet" | "stripe_unreachable" | "generic";
    message: string;
  } | null>(null);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  // WT-5: self-suppress on personal workspaces. Defense in depth —
  // the billing settings page renders a different state for personal
  // workspaces (the "Personal workspace — free, no subscription" info
  // card) and wouldn't mount this button. The check here protects
  // against future mount points that don't gate at the parent.
  const contexts = useUserContexts();

  const handleClick = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/billing/portal-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });

      let json: ApiResponse = {};
      try {
        json = (await res.json()) as ApiResponse;
      } catch {
        // Body wasn't JSON — fall to the generic error branch below.
      }

      if (res.ok && json.url) {
        // Redirect to Stripe Portal. Button is unmounting; no need to
        // unset loading.
        window.location.href = json.url;
        return;
      }

      // Map status + error code → user-facing copy. Matches the route's
      // documented response codes:
      //   401 not_authenticated   → session_expired
      //   403 not_authorized      → generic (shouldn't happen — page
      //                             gates server-side already, but
      //                             safety net)
      //   404 no_billing_yet      → distinct branch with the
      //                             plan-picker affordance
      //   404 workspace_not_found → generic
      //   502 stripe_error        → stripe_unreachable
      //   500 / other             → generic
      if (res.status === 401) {
        setError({
          code: "session_expired",
          message: "Your session expired — please sign in again.",
        });
      } else if (res.status === 404 && json.error === "no_billing_yet") {
        setError({
          code: "no_billing_yet",
          message: "", // Rendered as a custom JSX block below.
        });
      } else if (res.status === 502) {
        setError({
          code: "stripe_unreachable",
          message:
            "Stripe is unreachable right now — please try again in a moment.",
        });
      } else {
        setError({
          code: "generic",
          message: "Couldn't open billing portal. Please try again.",
        });
      }
      setLoading(false);
    } catch (e) {
      // Network failure or other thrown exception.
      console.error("[ManageBillingButton] fetch threw:", e);
      setError({
        code: "generic",
        message: "Couldn't open billing portal. Please try again.",
      });
      setLoading(false);
    }
  };

  // WT-5: personal-workspace self-suppress. Placed after all hook
  // calls so the rules-of-hooks order stays stable.
  if (contexts.status === "ready") {
    const ctx = contexts.contexts.find(
      (c) => c.type === "agency" && c.workspaceId === workspaceId,
    );
    if (ctx?.workspaceType === "personal") return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="btn-primary inline-flex"
        style={{
          opacity: loading ? 0.7 : 1,
          cursor: loading ? "wait" : "pointer",
        }}
      >
        {loading ? "Opening Stripe billing…" : "Manage billing →"}
      </button>

      {error && error.code === "no_billing_yet" && (
        <div className="mt-3 text-[13px] text-stages-red">
          ⚠ No Stripe customer yet.{" "}
          <button
            type="button"
            onClick={() => setShowPlanPicker(true)}
            className="underline hover:text-zinc-200"
          >
            Start a trial first →
          </button>
        </div>
      )}
      {error && error.code !== "no_billing_yet" && (
        <div className="mt-3 text-[13px] text-stages-red">
          ⚠ {error.message}
        </div>
      )}

      {showPlanPicker &&
        (isFounder ? (
          <FoundingPlanPickerModal
            workspaceId={workspaceId}
            onClose={() => setShowPlanPicker(false)}
          />
        ) : (
          <PlanPickerModal
            workspaceId={workspaceId}
            onClose={() => setShowPlanPicker(false)}
          />
        ))}
    </>
  );
}
