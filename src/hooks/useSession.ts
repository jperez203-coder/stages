"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Three-state session model. `loading` is the brief window after mount where
 * the Supabase client is reading the session cookies and (if present)
 * refreshing the stored token. UI should render a placeholder rather than
 * flashing the sign-in form during this window.
 *
 * Storage moved from localStorage to cookies in Phase 4a step 2 when the
 * client switched to @supabase/ssr's createBrowserClient (paired with the
 * server's createSupabaseServerClient so SSR can see the session).
 */
export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: User };

/**
 * Subscribes to Supabase auth state. Re-renders the consumer whenever the
 * session changes (sign-in, sign-out, token refresh, magic-link callback,
 * external sign-out from another tab, etc.).
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState(
        data.session?.user
          ? { status: "authenticated", user: data.session.user }
          : { status: "anonymous" },
      );
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState(
        session?.user
          ? { status: "authenticated", user: session.user }
          : { status: "anonymous" },
      );
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
