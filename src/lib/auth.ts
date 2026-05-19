"use client";

import { supabase } from "@/lib/supabase";

/**
 * localStorage key used to carry a pending accept-invite token through the
 * sign-in / sign-up dance. Single constant exported so the writer
 * (/accept-invite/[token]/page.tsx) and the reader
 * (src/components/auth/WorkspaceSelector.tsx) can never drift apart on a
 * typo. Don't reference the literal string anywhere else.
 */
const PENDING_ACCEPT_INVITE_KEY = "pending-accept-invite";

/**
 * Anonymous-user-clicks-"Sign in"-on-the-invite-page writes the token to
 * localStorage so WorkspaceSelector can route them back to /accept-invite/
 * [token] after auth. No-op in SSR contexts or when localStorage is
 * unavailable (private mode, quota exceeded) — the recipient just has to
 * navigate back manually in those cases.
 */
export function setPendingAcceptInvite(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_ACCEPT_INVITE_KEY, token);
  } catch {
    // localStorage unavailable; downstream UX gracefully degrades.
  }
}

/**
 * Reads the pending-accept-invite token AND clears it in one step.
 * Clear-on-read is the contract — if a future caller re-reads without
 * setting first, it'll be gone. This prevents stale tokens from
 * sticking around after a successful accept (or any post-auth flow that
 * isn't the invite flow) and silently re-routing the user later.
 */
export function consumePendingAcceptInvite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const token = window.localStorage.getItem(PENDING_ACCEPT_INVITE_KEY);
    if (token) {
      window.localStorage.removeItem(PENDING_ACCEPT_INVITE_KEY);
    }
    return token;
  } catch {
    return null;
  }
}

/**
 * Reads the pending-accept-invite token WITHOUT clearing it. Used by the
 * sign-up page to fetch the invite preview and lock the email field to the
 * invited address. The actual consume-and-route happens later in
 * WorkspaceSelector — calling consumePendingAcceptInvite from /auth/signup
 * would clear the token before the post-auth router could route back.
 */
export function peekPendingAcceptInvite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PENDING_ACCEPT_INVITE_KEY);
  } catch {
    return null;
  }
}

/**
 * Kicks off the Google OAuth flow. Redirects the browser to Google's consent
 * screen, which (after the user authorises) redirects to Supabase's auth
 * callback, which redirects to OUR /auth/callback with the PKCE code.
 *
 * Same call from both sign-in and sign-up surfaces — Supabase creates a new
 * auth.users row on first sign-in, signs in to the existing row thereafter,
 * and auto-links to an existing email+password user when the Google email is
 * verified (which it always is for real Google accounts).
 *
 * Returns the result of signInWithOAuth so the caller can surface any
 * immediate errors (rare — most OAuth errors surface on the callback page).
 */
export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
}
