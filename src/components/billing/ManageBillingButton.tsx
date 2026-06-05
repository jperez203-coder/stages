"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Manage-billing CTA on /w/[slug]/settings/billing.
 *
 * On click:
 *   1. POSTs to /api/billing/portal-session with { workspace_id }.
 *   2. On 200 → window.location.href = response.url (Stripe-hosted portal).
 *   3. On error → revert button, render inline error caption mapped from
 *      the route's status code + error code.
 *
 * The "no_billing_yet" 404 case shows a different inline UX — explicit
 * link back to the dashboard where StartTrialBanner (Track B) or
 * FoundingTrialEndingBanner (Track A) will surface the trial-start flow.
 * Other errors get a generic retry caption.
 *
 * `hasStripeCustomer` prop is the server-side hint about whether the
 * 404 no_billing_yet case is likely. The button DOES NOT pre-disable
 * itself when hasStripeCustomer is false — server's the source of truth
 * for that branch, and the button still hits the API to get the
 * authoritative answer. The prop is purely a UI hint for future
 * "Start trial first" prominence; currently unused but reserved.
 */

type ApiResponse = {
  url?: string;
  error?: string;
};

export function ManageBillingButton({
  workspaceId,
  hasStripeCustomer: _hasStripeCustomer,
  workspaceSlug,
}: {
  workspaceId: string;
  hasStripeCustomer: boolean;
  workspaceSlug: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    code: "session_expired" | "no_billing_yet" | "stripe_unreachable" | "generic";
    message: string;
  } | null>(null);

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
      //   404 no_billing_yet      → distinct branch with dashboard link
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
          <Link
            href={`/w/${encodeURIComponent(workspaceSlug)}`}
            className="underline hover:text-zinc-200"
          >
            Start a trial first →
          </Link>
        </div>
      )}
      {error && error.code !== "no_billing_yet" && (
        <div className="mt-3 text-[13px] text-stages-red">
          ⚠ {error.message}
        </div>
      )}
    </>
  );
}
