"use client";

import { useState } from "react";
import Link from "next/link";
import { AtSign, Eye, EyeOff, Lock } from "lucide-react";
import { GoogleGLogo } from "@/components/auth/GoogleGLogo";
import { supabase } from "@/lib/supabase";
import { signInWithGoogle } from "@/lib/auth";

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.includes("@") && password.length > 0 && !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }
    // Success — useSession in the parent panel detects the new session via
    // onAuthStateChange and swaps to AuthSuccessState. Don't reset submitting
    // here; the form unmounts on the swap.
  };

  const handleGoogleClick = async () => {
    setSubmitting(true);
    setError(null);
    const { error: oauthError } = await signInWithGoogle();
    if (oauthError) {
      // Rare — most OAuth errors surface on /auth/callback after the round
      // trip to Google. This catches the immediate-rejection case (e.g. a
      // misconfigured Supabase provider).
      setError(oauthError.message);
      setSubmitting(false);
      return;
    }
    // Success — the browser is being redirected to Google's consent screen.
    // No further action; this tab is on its way out.
  };

  return (
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

      <div className="flex items-baseline justify-between mb-1.5">
        <label>
          <span className="text-[13px] text-zinc-400">Password</span>
        </label>
        <Link
          href="/auth/forgot-password"
          className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Forgot password?
        </Link>
      </div>
      <div className="relative mb-5">
        <Lock
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
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
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-zinc-800" />
        <span className="text-[11px] uppercase tracking-wider text-zinc-600">or</span>
        <div className="flex-1 h-px bg-zinc-800" />
      </div>

      <button
        type="button"
        onClick={handleGoogleClick}
        disabled={submitting}
        className="btn-ghost w-full justify-center"
      >
        <GoogleGLogo size={16} />
        Continue with Google
      </button>

      <div className="mt-5 pt-4 border-t border-zinc-800 text-[13px] text-zinc-500 text-center">
        Don&apos;t have an account?{" "}
        <Link
          href="/auth/signup"
          className="text-stages-blue hover:underline font-medium"
        >
          Sign up
        </Link>
      </div>
    </form>
  );
}
