"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AtSign, Eye, EyeOff, Lock, User } from "lucide-react";
import { GoogleGLogo } from "@/components/auth/GoogleGLogo";
import { supabase } from "@/lib/supabase";
import { signInWithGoogle } from "@/lib/auth";

type Props = {
  /**
   * Called once Supabase accepts the sign-up. Lets the parent panel swap to
   * the "check your email" state when email confirmation is required (the
   * default Supabase behavior — session is null until the user clicks the
   * confirmation link).
   */
  onSignedUp?: (email: string) => void;
  /**
   * When provided, the email field is pre-filled with this value and locked
   * (readOnly + visually muted). Used when the user arrived from /accept-
   * invite/[token]; the email must match the invite or the
   * accept_workspace_invite RPC will reject at the server. See
   * SignUpPanel.tsx → InviteLock for the full rationale and the defense-in-
   * depth note.
   */
  lockedEmail?: string;
};

// Minimum password length. Modern guidance (NIST 800-63B) discourages
// mandatory mixed-case/symbol rules in favour of length + breached-password
// lookup; Supabase has the latter built in.
const MIN_PASSWORD_LENGTH = 8;

export function SignUpForm({ onSignedUp, lockedEmail }: Props) {
  // FB-1: read ?invite=<token> from the URL. When present, the user
  // arrived from /accept-invite/[token] → "Create an account"; we
  // need to thread the token through Supabase's emailRedirectTo so
  // the post-confirmation landing carries the invite context even
  // when the confirmation email opens in a different browser/profile
  // than the one where signup was initiated.
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  // When lockedEmail is provided we initialize state from it AND ignore
  // input changes (the input is readOnly, but defensive against React
  // controlled-input gotchas).
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // ReactNode (not just string) so we can render an inline link to /auth/signin
  // for the "email already registered" case.
  const [error, setError] = useState<ReactNode | null>(null);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const isLocked = !!lockedEmail;
  // Required-name check uses the TRIMMED value so a string of spaces
  // doesn't pass. The same trim is applied before sending to Supabase
  // so what lands in raw_user_meta_data matches what gated submission.
  const trimmedName = fullName.trim();
  const canSubmit =
    trimmedName.length > 0 &&
    email.includes("@") &&
    password.length >= MIN_PASSWORD_LENGTH &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) {
      // Friendly inline error specifically for the empty-name case so the
      // user knows WHY the disabled button is disabled — the email +
      // password fields have their own visible hints, but name needs its
      // own.
      if (trimmedName.length === 0) {
        setError("Please enter your full name.");
      }
      return;
    }
    setSubmitting(true);
    setError(null);
    // emailRedirectTo lands the confirmation-link click on /auth/signin,
    // where useSession detects the new session via the URL hash (the
    // Supabase client is configured with detectSessionInUrl: true) and
    // swaps the panel to the AuthSuccessState. Without this, Supabase
    // sends the user to the project's default Site URL (/) which renders
    // the old in-memory LoginScreen — confusing.
    //
    // `options.data.full_name` lands in auth.users.raw_user_meta_data,
    // which the existing handle_new_user() trigger (20260510120000)
    // reads to populate profiles.display_name on insert — same path
    // Google OAuth signups already use. So this single change closes
    // the email+password signup hole without any trigger or RPC
    // changes.
    // FB-1: when an invite token was carried in via ?invite=, embed a
    // ?next=/accept-invite/<token> in emailRedirectTo. The confirmation
    // email's link will land at /auth/signin with the invite path in
    // the URL — WorkspaceSelector (or the SignIn panel pre-auth path)
    // honors ?next= and routes there post-auth, bypassing the standard
    // resolveDestination tree. Survives the localStorage-cross-browser
    // gap because the path is encoded in the link itself.
    //
    // No invite token → unchanged behavior. The next-param scrub is
    // belt-and-suspenders: encodeURIComponent on the token (already a
    // UUID, but defensive) ensures the redirectTo URL parses correctly
    // in case a future token format includes URL-reserved chars.
    const emailRedirectTo = inviteToken
      ? `${window.location.origin}/auth/signin?next=${encodeURIComponent(
          `/accept-invite/${inviteToken}`,
        )}`
      : `${window.location.origin}/auth/signin`;

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: { full_name: trimmedName },
      },
    });
    if (signUpError) {
      setError(signUpError.message);
      setSubmitting(false);
      return;
    }
    // Email-enumeration protection check. When email confirmation is ON
    // (default) AND the email is already registered, Supabase returns a
    // fake-success response with an empty `identities` array — no error,
    // no useful user object. We detect that here so the user gets a clear
    // "you already have an account, sign in instead" message rather than
    // the misleading "check your email" state.
    //
    // This is the documented way to handle the case while preserving most
    // of the enumeration protection. (A pre-signup database query would be
    // strictly worse — it'd give attackers an unrestricted oracle.)
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setError(
        <>
          This email is already registered.{" "}
          <Link href="/auth/signin" className="underline font-medium">
            Sign in instead
          </Link>
          .
        </>,
      );
      setSubmitting(false);
      return;
    }
    // Two success shapes:
    //   * data.session != null → email confirmation is OFF in this project,
    //     user is signed in immediately. useSession picks up the change.
    //   * data.session == null → email confirmation is ON (default). The
    //     auth.users row exists but the user must click the confirmation
    //     link before they can sign in. Tell the parent panel to swap to
    //     the "check your email" state.
    if (!data.session) {
      onSignedUp?.(email);
    }
    // Don't reset submitting on success — the form unmounts when the panel
    // swaps to the success state, and we want the button to stay disabled
    // during that transition.
  };

  const handleGoogleClick = async () => {
    setSubmitting(true);
    setError(null);
    const { error: oauthError } = await signInWithGoogle();
    if (oauthError) {
      // Rare — most OAuth errors surface on /auth/callback after the round
      // trip to Google. This catches the immediate-rejection case.
      setError(oauthError.message);
      setSubmitting(false);
      return;
    }
    // Success — the browser is being redirected to Google's consent screen.
  };

  return (
    <form onSubmit={submit}>
      {/* Full name — required. Lands in auth.users.raw_user_meta_data via
          options.data.full_name; the handle_new_user() trigger picks it
          up and writes profiles.display_name on insert. autoFocus moved
          here from email since this is now the first field the user
          types regardless of whether email is locked. */}
      <label className="block mb-1.5">
        <span className="text-[13px] text-zinc-400">Full name</span>
      </label>
      <div className="relative mb-4">
        <User
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          autoFocus
          type="text"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Casey Smith"
          className="field"
          style={{ paddingLeft: "40px" }}
          disabled={submitting}
        />
      </div>

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
          style={{
            paddingLeft: "40px",
            // Locked styling: slightly muted so it reads as informational
            // rather than editable. Tab-skipped via readOnly.
            ...(isLocked ? { color: "#9CA3AF", cursor: "not-allowed" } : {}),
          }}
          disabled={submitting}
          readOnly={isLocked}
          aria-readonly={isLocked}
        />
      </div>

      <label className="block mb-1.5">
        <span className="text-[13px] text-zinc-400">Password</span>
      </label>
      <div className="relative mb-1.5">
        <Lock
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
        />
        <input
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`${MIN_PASSWORD_LENGTH}+ characters`}
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
        className={`text-[12px] mb-5 ${
          passwordTooShort ? "text-stages-red" : "text-zinc-600"
        }`}
      >
        At least {MIN_PASSWORD_LENGTH} characters.
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
        {submitting ? "Creating account…" : "Create account"}
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
        Already have an account?{" "}
        <Link
          href="/auth/signin"
          className="text-stages-blue hover:underline font-medium"
        >
          Sign in
        </Link>
      </div>
    </form>
  );
}
