"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * One identity attached to the current user's auth.users row. Stages MVP
 * supports two: 'email' (password + email) and 'google'. Schema also allows
 * future additions ('apple', 'microsoft', etc.) — provider stays a string
 * to leave that door open without a type change.
 */
export type LinkedIdentity = {
  id: string;
  provider: string;
  createdAt: string;
  /** Email associated with this identity (from `identity_data.email`). For
   *  the 'email' provider this is the user's password-login email. For
   *  'google', it's the Google account's email — which must match the
   *  user's auth.users.email for Supabase to allow the link. */
  email: string | null;
};

export type LinkedIdentitiesState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      identities: LinkedIdentity[];
      /**
       * True if the user can sign in with email + password. Supabase has
       * a quirk: when you call `updateUser({ password })` on a user that
       * already has a non-email identity (e.g., Google) at the same email
       * address, the password hash is stored on `auth.users.encrypted_password`
       * but NO `email` identity row is created. `identities` alone can't
       * tell you "this user has a password set" in that case.
       *
       * The signal we use: `user_metadata.has_password` (a flag we maintain
       * ourselves when setting passwords via /settings/account), OR the
       * presence of an `email` identity (for users who signed up via
       * /auth/signup, where Supabase DOES create the identity row).
       *
       * Existing legacy users who set a password before the metadata flag
       * existed will report hasPassword=false here even though they CAN
       * sign in. The wipe-and-redo path through /settings/account fixes
       * that — once they re-set the password through our UI, the flag is
       * set and hasPassword goes true.
       */
      hasPassword: boolean;
      refetch: () => Promise<void>;
    };

/**
 * Returns the list of identities linked to the current authenticated user.
 * Subscribes to onAuthStateChange so events that mutate identities
 * (USER_UPDATED after linkIdentity or updateUser({ password }), TOKEN_REFRESHED,
 * etc.) trigger an automatic refetch. Caller also gets a manual `refetch()`
 * for explicit triggers (e.g., after a successful inline form submit).
 */
export function useLinkedIdentities(): LinkedIdentitiesState {
  const [state, setState] = useState<LinkedIdentitiesState>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }
      const user = data.user;
      if (!user) {
        setState({ status: "error", message: "Not authenticated" });
        return;
      }
      const identities: LinkedIdentity[] = (user.identities ?? []).map((i) => {
        const idData = i.identity_data as Record<string, unknown> | undefined;
        const emailField = idData?.email;
        return {
          id: i.id,
          provider: i.provider,
          createdAt: i.created_at ?? "",
          email: typeof emailField === "string" ? emailField : null,
        };
      });
      const hasEmailIdentity = identities.some((i) => i.provider === "email");
      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const hasPasswordMetadata = metadata.has_password === true;
      const hasPassword = hasEmailIdentity || hasPasswordMetadata;
      setState({
        status: "ready",
        identities,
        hasPassword,
        refetch: load,
      });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    void load();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [load]);

  return state;
}
