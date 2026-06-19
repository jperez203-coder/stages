"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
/**
 * FB-1: useSearchParams was added to the inner component below to read
 * ?invite= / ?next= for the invite handoff. Next.js 16 requires any
 * Client Component tree that calls useSearchParams to live inside a
 * Suspense boundary during prerender — otherwise the prerender errors
 * with "useSearchParams() should be wrapped in a suspense boundary."
 * Same Suspense-wrapper posture SignInPanel uses for WorkspaceSelector.
 * The fallback mirrors the in-flight spinner shell so there's no visual
 * flicker between Suspense fallback and the actual inner render.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <AuthShell title="Signing you in…" subtitle="Hold on a moment.">
          <div className="h-32" />
        </AuthShell>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
  //
  // FB-1: when ?invite=<token> or ?next=<path> rode along on the OAuth
  // redirectTo (e.g. user clicked "Sign in with Google" from an invite
  // page that augmented signInWithGoogle's redirectTo), route the user
  // straight to that destination instead of bouncing through /auth/signin
  // and WorkspaceSelector. Same precedence as WorkspaceSelector: ?invite
  // > ?next > default. Falls back to /auth/signin (where WorkspaceSelector
  // takes over) when neither URL param is present — preserves existing
  // OAuth-without-invite behavior.
  useEffect(() => {
    if (session.status !== "authenticated") return;
    const inviteToken = searchParams.get("invite");
    if (inviteToken) {
      router.replace(`/accept-invite/${inviteToken}`);
      return;
    }
    const nextPath = searchParams.get("next");
    if (nextPath && nextPath.startsWith("/")) {
      router.replace(nextPath);
      return;
    }
    router.replace("/auth/signin");
  }, [session.status, router, searchParams]);

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
