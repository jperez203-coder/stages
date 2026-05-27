"use client";

import { useState } from "react";
import Link from "next/link";
import { AtSign } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { supabase } from "@/lib/supabase";

/**
 * /portal/signin — self-service magic-link request for returning clients.
 *
 * Why this page exists: clients enter Stages via a one-time invite magic
 * link at /portal/accept/[token]. Once their session expires (Supabase
 * refresh-token timeout), they have NO way back in unless the agency
 * manually re-invites them. This page gives clients a self-service
 * recovery path — type your email, get a fresh magic link.
 *
 * Anti-enumeration design (CRITICAL):
 *   1. `shouldCreateUser: false` — Supabase will only send a link if an
 *      auth.users row with this email already exists. Without this,
 *      anyone could become a "user" by typing any email here, bypassing
 *      the agency-controlled invite gate.
 *   2. Always show the SAME success message regardless of whether
 *      Supabase succeeded or returned an error. Surfacing "no user
 *      found" would let an attacker enumerate which emails are real
 *      portal clients. Errors get console.error'd for debugging; users
 *      see only the neutral "if that email is on file…" copy.
 *
 * On magic-link click, the user lands at /select-workspace (via
 * emailRedirectTo). That page already routes a client to /portal/
 * [pipelineId] when their only context is a client membership (or to
 * the workspace chooser when they have multiple).
 *
 * Visual treatment mirrors /auth/signin's SignInForm: same AuthShell
 * chrome (dotted-grid + panel-card + Stages wordmark), same `.field`
 * input class, same `.btn-primary` button. Dark mode only.
 */
export default function PortalSignInPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit = email.includes("@") && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // shouldCreateUser:false is the security gate — only send a link
        // if this email is already an auth.users row. Without this, this
        // page would let anyone enroll as a Stages user with no agency
        // invite. NON-NEGOTIABLE — see header comment.
        shouldCreateUser: false,
        // Land them on /select-workspace post-auth. That route already
        // detects client-only users and redirects them to their portal
        // (or shows a chooser when they have multiple memberships).
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/select-workspace`
            : undefined,
      },
    });
    if (otpError) {
      // Anti-enumeration: log for ops visibility, DO NOT surface to the
      // UI. The submitted state below shows the same neutral copy
      // whether Supabase sent a link or silently dropped the request.
      console.error("[/portal/signin] signInWithOtp:", otpError.message);
    }
    setSubmitting(false);
    setSubmitted(true);
  };

  const reset = () => {
    setEmail("");
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle="If that email is on a client portal, a magic link is on its way."
      >
        <div
          className="mb-5 p-4 rounded-lg border border-stages-border text-[13px] text-zinc-300 leading-relaxed"
          style={{ background: "rgba(16,140,233,0.06)" }}
        >
          The link can take a minute or two to arrive. It will expire
          after one hour.
        </div>

        <div className="text-[13px] text-zinc-500 text-center">
          Wrong email?{" "}
          <button
            type="button"
            onClick={reset}
            className="text-stages-blue hover:underline font-medium"
          >
            Try again
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-zinc-800 text-[13px] text-zinc-500 text-center">
          Are you an agency?{" "}
          <Link
            href="/auth/signin"
            className="text-stages-blue hover:underline font-medium"
          >
            Sign in here
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sign in to your client portal"
      subtitle="Enter your email and we'll send you a magic link."
    >
      <form onSubmit={submit}>
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Email</span>
        </label>
        <div className="relative mb-5">
          <AtSign
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            autoFocus
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="field"
            style={{ paddingLeft: "40px" }}
            disabled={submitting}
          />
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary w-full justify-center"
        >
          {submitting ? "Sending…" : "Send magic link"}
        </button>

        <div className="mt-5 pt-4 border-t border-zinc-800 text-[13px] text-zinc-500 text-center">
          Are you an agency?{" "}
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
