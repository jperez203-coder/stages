"use client";

import { supabase } from "@/lib/supabase";

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
