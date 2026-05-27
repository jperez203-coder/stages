"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AtSign, Check } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase";

/**
 * /upgrade — waitlist capture for paid-agency plans. Phase 1, pre-Stripe.
 *
 * Three entry points today, distinguished by ?source=:
 *   * `switcher_cta`     — empty switcher CTA card (PIECE C of phase 1)
 *   * `switcher_empty`   — alias for switcher_cta (older link shape)
 *   * `c1_block`         — pure clients bouncing off the C1 gate at
 *                          /onboarding/create-workspace (PIECE D)
 *
 * The page is purely interest capture — no Stripe, no checkout. A row
 * lands in upgrade_interest (INSERT-only RLS pinned to auth.uid()).
 *
 * Suspense wrapper is required because the inner form reads
 * useSearchParams for the `source` tag. Without the Suspense boundary
 * Next.js 16's static-prerender pass bails out (same lesson as
 * /select-workspace; learned the hard way on the Vercel build).
 */
export default function UpgradePage() {
  return (
    <Suspense fallback={<UpgradeFallback />}>
      <UpgradePageInner />
    </Suspense>
  );
}

function UpgradeFallback() {
  return (
    <AuthShell
      title="Loading…"
      subtitle="Getting the waitlist form ready."
    >
      <div className="h-32" />
    </AuthShell>
  );
}

type PlanInterest = "solo" | "team" | "not_sure";

function UpgradePageInner() {
  const session = useSession();
  const searchParams = useSearchParams();
  const source = searchParams.get("source") ?? "switcher_cta";

  // Default email = signed-in user's email when available, editable.
  const [email, setEmail] = useState("");
  const [planInterest, setPlanInterest] =
    useState<PlanInterest>("not_sure");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill email once the session resolves.
  useEffect(() => {
    if (session.status === "authenticated" && session.user.email && !email) {
      setEmail(session.user.email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  const canSubmit = email.includes("@") && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    if (session.status !== "authenticated") {
      // The upgrade_interest INSERT policy requires auth.uid() — so an
      // anonymous user can't post. Show a friendly nudge instead of a
      // raw RLS error. /auth/signin keeps the standard path; clients
      // who landed here without a session can sign in there too (and
      // existing client magic-link entry remains at /portal/signin).
      setError(
        "Please sign in first so we can save your spot. Use the link below.",
      );
      setSubmitting(false);
      return;
    }

    // plan_interest column is `text null` — store as 'solo' / 'team' /
    // null when the user picked "Not sure yet" so admin queries can
    // distinguish "deliberately undecided" from "didn't see the field."
    const planValue: string | null =
      planInterest === "not_sure" ? null : planInterest;

    const { error: insertErr } = await supabase
      .from("upgrade_interest")
      .insert({
        user_id: session.user.id,
        email: email.trim(),
        source,
        plan_interest: planValue,
        notes: notes.trim() || null,
      });

    setSubmitting(false);
    if (insertErr) {
      console.error("[/upgrade] insert failed:", insertErr.message);
      setError(
        "Something went wrong saving your spot. Please try again in a moment.",
      );
      return;
    }
    setSubmittedEmail(email.trim());
  };

  // ─── Success state ──────────────────────────────────────────────────────
  if (submittedEmail) {
    return (
      <AuthShell
        title="You're on the list"
        subtitle={`We'll email ${submittedEmail} when paid plans launch.`}
      >
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-green/10">
            <Check size={22} className="text-stages-green" />
          </div>
          <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
            Thanks — you'll be among the first to know.
          </p>
          <BackLink />
        </div>
      </AuthShell>
    );
  }

  // ─── Form ───────────────────────────────────────────────────────────────
  return (
    <AuthShell
      title="Get your own Stages workspace"
      subtitle="You're currently using Stages as a client. Want to use it to run your own agency? We're rolling out paid plans — drop your email and we'll let you know."
    >
      {/* Pricing preview cards — purely informational, no checkout. */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <PlanCard
          name="Solo"
          price="$29"
          unit="seat/month"
          caption="For individual operators"
        />
        <PlanCard
          name="Team"
          price="$39"
          unit="seat/month"
          caption="For agency teams"
        />
      </div>
      <div
        className="mb-5 px-3 py-2 rounded-lg text-[12px] text-stages-amber text-center"
        style={{
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.25)",
        }}
      >
        First 50 founding members: 50% off, lifetime.
      </div>

      <form onSubmit={submit}>
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Email</span>
        </label>
        <div className="relative mb-4">
          <AtSign
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="field"
            style={{ paddingLeft: "40px" }}
            disabled={submitting}
          />
        </div>

        <fieldset className="mb-4">
          <legend className="text-[13px] text-zinc-400 mb-1.5">
            Which plan are you interested in?
          </legend>
          <div className="grid grid-cols-3 gap-2">
            <PlanChip
              label="Solo"
              active={planInterest === "solo"}
              onClick={() => setPlanInterest("solo")}
              disabled={submitting}
            />
            <PlanChip
              label="Team"
              active={planInterest === "team"}
              onClick={() => setPlanInterest("team")}
              disabled={submitting}
            />
            <PlanChip
              label="Not sure yet"
              active={planInterest === "not_sure"}
              onClick={() => setPlanInterest("not_sure")}
              disabled={submitting}
            />
          </div>
        </fieldset>

        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">
            What would you use Stages for?{" "}
            <span className="text-zinc-600">(optional)</span>
          </span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Tell us about your agency / what you'd like to track…"
          rows={2}
          className="field mb-5"
          style={{ resize: "none" }}
          disabled={submitting}
          maxLength={500}
        />

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug">
            {error}{" "}
            <Link
              href="/auth/signin"
              className="text-stages-blue hover:underline font-medium"
            >
              Sign in
            </Link>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary w-full justify-center"
        >
          {submitting ? "Saving…" : "Add me to the list"}
        </button>

        <div className="mt-5 pt-4 border-t border-zinc-800 text-[13px] text-zinc-500 text-center">
          Already have an agency account?{" "}
          <Link
            href="/auth/signin"
            className="text-stages-blue hover:underline font-medium"
          >
            Sign in here
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

// ─── Small inline subcomponents ─────────────────────────────────────────────

function PlanCard({
  name,
  price,
  unit,
  caption,
}: {
  name: string;
  price: string;
  unit: string;
  caption: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #36363A",
        borderRadius: 10,
        padding: "12px 14px",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div className="text-[12px] uppercase tracking-wider font-semibold text-zinc-500">
        {name}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[20px] font-semibold text-white">{price}</span>
        <span className="text-[11px] text-zinc-500">/ {unit}</span>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500 leading-tight">
        {caption}
      </div>
    </div>
  );
}

function PlanChip({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[12px] font-medium transition-colors"
      style={{
        padding: "8px 4px",
        borderRadius: 8,
        background: active ? "rgba(16,140,233,0.15)" : "rgba(255,255,255,0.04)",
        color: active ? "#108CE9" : "rgba(255,255,255,0.75)",
        border: active
          ? "1px solid rgba(16,140,233,0.45)"
          : "1px solid rgba(255,255,255,0.08)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

/**
 * Success-state back link. For clients we'd ideally route back to their
 * portal directly, but the v1 surface keeps it simple: a single "back to
 * sign in" anchor that covers every persona. Polishing this to be
 * context-aware (portal vs agency vs anonymous) can come with the
 * Stripe-billing slice when this page transitions from waitlist to
 * actual checkout.
 */
function BackLink() {
  return (
    <Link
      href="/auth/signin"
      className="text-[13px] text-stages-blue hover:underline font-medium"
    >
      Back to sign in
    </Link>
  );
}
