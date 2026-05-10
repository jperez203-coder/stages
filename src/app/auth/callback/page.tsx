"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { useSession } from "@/hooks/useSession";

/**
 * OAuth callback landing page.
 *
 * The handshake works like this:
 *   1. User clicks "Continue with Google" in our app.
 *   2. Browser → Google's OAuth consent screen.
 *   3. After consent, Google → Supabase's /auth/v1/callback with an auth code.
 *   4. Supabase processes that code (creates/links the auth.users row) and
 *      redirects to OUR /auth/callback?code=XYZ (PKCE).
 *   5. The Supabase JS client, configured with `detectSessionInUrl: true`
 *      and PKCE flow, consumes that code AUTOMATICALLY at module load —
 *      calls exchangeCodeForSession internally, sets the session, and
 *      cleans the URL via history.replaceState.
 *   6. This page's job is just to wait for the session to flip to
 *      authenticated (via useSession's onAuthStateChange subscription),
 *      then redirect to /auth/signin where AuthSuccessState renders.
 *
 * IMPORTANT: do NOT call exchangeCodeForSession manually here. The SDK has
 * already done it by the time this page mounts (the URL will look like
 * /auth/callback or /auth/callback# — no ?code= because the SDK stripped
 * it). A manual exchange would race the SDK's internal one and fail with
 * "No code in URL" or "code verifier not found." See PROGRESS.md entry for
 * Phase 3.4 step 3 for the full debugging story.
 *
 * The only thing we read from the URL ourselves is the OAuth `error` param
 * (set when the user clicks Cancel on Google's consent screen).
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Read OAuth-error params synchronously on first mount. These would only
  // be present in the URL if Google itself sent us back with an error
  // (most commonly: user clicked Cancel on the consent screen).
  useEffect(() => {
    const url = new URL(window.location.href);
    const errParam = url.searchParams.get("error");
    const errDescription = url.searchParams.get("error_description");
    if (errParam) {
      setError(errDescription || errParam);
    }
  }, []);

  // Redirect once the session is ready. The SDK consumes the URL token
  // asynchronously after the page mounts, so on first render session.status
  // is "loading", then "anonymous" (briefly, while the exchange is in
  // flight), then "authenticated". When it flips authenticated, we go.
  useEffect(() => {
    if (session.status === "authenticated") {
      router.replace("/auth/signin");
    }
  }, [session.status, router]);

  // Safety net. If the SDK exchange fails silently and the session never
  // flips authenticated, we'd otherwise sit on the spinner forever. After
  // 8 seconds with no session, surface a clear error.
  useEffect(() => {
    if (session.status === "authenticated" || error) return;
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [session.status, error]);

  const displayError =
    error ||
    (timedOut
      ? "Sign-in didn't complete. The Supabase client may have failed to exchange the OAuth code. Check the browser console for errors and try again."
      : null);

  if (displayError) {
    return (
      <AuthShell
        title="Sign-in failed"
        subtitle="We couldn't complete the Google sign-in."
      >
        <div className="text-center">
          <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-red/10">
            <AlertCircle size={22} className="text-stages-red" />
          </div>
          <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed break-words">
            {displayError}
          </p>
          <Link href="/auth/signin" className="btn-primary w-full justify-center">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Signing you in…" subtitle="Hold on a moment.">
      <div className="h-32" />
    </AuthShell>
  );
}
