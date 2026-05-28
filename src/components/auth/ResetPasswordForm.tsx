"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Eye, EyeOff, Lock } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase";

// Match the signup rule (SignUpForm MIN_PASSWORD_LENGTH) so the two
// password-entry surfaces enforce the same minimum.
const MIN_PASSWORD_LENGTH = 8;

/**
 * Reset-password form — three states:
 *
 *   STATE 1 (verifying): the global Supabase client auto-exchanges the PKCE
 *     ?code= recovery token at module load (detectSessionInUrl). useSession
 *     reports loading → (briefly) anonymous → authenticated, same sequence
 *     /auth/callback documents. We do NOT call exchangeCodeForSession
 *     manually — that races the SDK's internal exchange.
 *   STATE 2 (authenticated): recovery session established → new-password
 *     form. updateUser({ password }) on submit, then route to /auth/signin
 *     so the WorkspaceSelector orchestrator places the now-signed-in user.
 *   STATE 3 (invalid/expired): never authenticated within 8s (mirror of the
 *     callback's safety net). Most commonly the PKCE code verifier is
 *     missing because the link was opened in a different browser than the
 *     one that requested it.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const session = useSession();
  const [timedOut, setTimedOut] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Safety net: if the recovery session never establishes within 8s, treat
  // the link as invalid/expired. Cleared the moment we authenticate.
  useEffect(() => {
    if (session.status === "authenticated") return;
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [session.status]);

  const tooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirm &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }
    setDone(true);
    // The recovery session is now a full session. Route through /auth/signin
    // so its authenticated branch (WorkspaceSelector) places the user in
    // their default workspace — same handoff /auth/callback uses.
    setTimeout(() => router.replace("/auth/signin"), 1500);
  };

  // ── STATE 2 — authenticated (recovery session live) ────────────────────
  if (session.status === "authenticated") {
    if (done) {
      return (
        <div className="p-3 rounded-lg border border-stages-green/40 bg-stages-green/10 text-[13px] text-stages-green leading-snug flex items-start gap-2">
          <Check size={14} className="flex-shrink-0 mt-0.5" />
          <span>Password updated. Redirecting…</span>
        </div>
      );
    }
    return (
      <form onSubmit={submit}>
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">New password</span>
        </label>
        <div className="relative mb-1.5">
          <Lock
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            autoFocus
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="field"
            style={{ paddingLeft: "40px", paddingRight: "40px" }}
            disabled={submitting}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p
          className={`text-[12px] mb-4 ${
            tooShort ? "text-stages-amber" : "text-zinc-600"
          }`}
        >
          At least {MIN_PASSWORD_LENGTH} characters.
        </p>

        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Confirm password</span>
        </label>
        <div className="relative mb-1.5">
          <Lock
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="field"
            style={{ paddingLeft: "40px" }}
            disabled={submitting}
          />
        </div>
        <p
          className={`text-[12px] mb-5 ${
            mismatch ? "text-stages-amber" : "text-transparent"
          }`}
        >
          {/* Reserve the line so the layout doesn't jump when the hint shows. */}
          {mismatch ? "Passwords don't match." : " "}
        </p>

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
          {submitting ? "Updating…" : "Update password"}
        </button>
      </form>
    );
  }

  // ── STATE 3 — invalid / expired link ───────────────────────────────────
  if (timedOut) {
    return (
      <div>
        <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>This reset link is invalid or has expired.</span>
        </div>
        <p className="text-[12px] text-zinc-500 mb-5 leading-relaxed">
          If you opened this link on a different device than the one you
          requested it from, please request a new one in this browser.
        </p>
        <Link
          href="/auth/forgot-password"
          className="btn-primary w-full justify-center"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  // ── STATE 1 — verifying (SDK exchanging the ?code=) ────────────────────
  return (
    <div className="text-center py-6">
      <p className="text-[13px] text-zinc-500">Verifying your reset link…</p>
    </div>
  );
}
