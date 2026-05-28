"use client";

import { useState } from "react";
import Link from "next/link";
import { AtSign, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Forgot-password request form. Sends a Supabase recovery email whose link
 * lands on /auth/reset-password (the SDK auto-exchanges the PKCE ?code=
 * there via detectSessionInUrl — see ResetPasswordForm + /auth/callback).
 *
 * Anti-enumeration (mandatory): we ALWAYS show the same neutral success
 * state regardless of whether the email is registered, so an attacker can't
 * probe which addresses have accounts. Supabase's resetPasswordForEmail
 * already returns success either way (it doesn't reveal existence); the only
 * error we surface is a rate-limit (429), which leaks nothing about a
 * specific account. Network/unknown failures collapse to a generic retry
 * message — never to "no such user".
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim();
  const canSubmit = trimmed.includes("@") && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        trimmed,
        { redirectTo: `${window.location.origin}/auth/reset-password` },
      );
      // Only surface a rate-limit — it reveals nothing about whether this
      // specific email exists. Any other error (including the theoretical
      // user-not-found, which Supabase doesn't actually return) collapses
      // into the neutral success state below.
      if (resetError && resetError.status === 429) {
        setError("Too many requests. Please wait a minute and try again.");
        setSubmitting(false);
        return;
      }
      setSent(true);
      setSubmitting(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div>
        <div className="mb-5 p-3 rounded-lg border border-stages-green/40 bg-stages-green/10 text-[13px] text-stages-green leading-snug flex items-start gap-2">
          <Check size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            If an account exists for that email, a reset link is on the way.
            Check your inbox.
          </span>
        </div>
        <div className="text-[13px] text-zinc-500 text-center">
          <Link
            href="/auth/signin"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
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
          placeholder="you@company.com"
          className="field"
          style={{ paddingLeft: "40px" }}
          disabled={submitting}
        />
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="btn-primary w-full justify-center"
      >
        {submitting ? "Sending…" : "Send reset link"}
      </button>

      <div className="mt-5 pt-4 border-t border-zinc-800 text-[13px] text-zinc-500 text-center">
        <Link
          href="/auth/signin"
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
