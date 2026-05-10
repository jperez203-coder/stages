"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Three-state session model. `loading` is the brief window after mount where
 * the Supabase client is checking localStorage and (if present) refreshing the
 * stored token. UI should render a placeholder rather than flashing the
 * sign-in form during this window.
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

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
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
