"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LogOut, Plus } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { supabase } from "@/lib/supabase";

const MAX_NAME_LENGTH = 80;

/**
 * Shape of `create_workspace_with_owner` RPC's return value. See migration
 * 20260511120000_create_workspace_with_owner.sql for the source-of-truth
 * definition.
 */
type CreateResult = {
  id: string;
  slug: string;
  name: string;
};

/**
 * Workspace creation form. Extracted from page.tsx (2026-05-26) when the
 * server-side gate was added to that route (C1 — pure-client paywall
 * bypass fix). The page's server component runs the gate first; this
 * client component runs only if the gate allowed the caller through.
 *
 * Two entry points share this form:
 *   1. Fresh sign-ups with 0 contexts. WorkspaceSelector's auto-redirect
 *      lands them at /onboarding/create-workspace; the page-level gate
 *      allows them (zero contexts = not the bypass case); this form renders.
 *   2. Existing users clicking "Create new workspace" in the AppShell
 *      header dropdown (only visible when hasAnyAgencyContext === true
 *      per the 2026-05-26 A1+A3 fix).
 *
 * Both paths end at /w/[new-slug] with the new workspace as the active
 * one and last_active_workspace_id persisted.
 *
 * Atomicity comes from a Postgres RPC (security definer) that does both
 * inserts inside one transaction. The RPC ALSO contains a pure-client
 * block as defense-in-depth (so a direct PostgREST call bypassing this
 * form still gets rejected). See migration 20260605120000.
 *
 * Slug generation + collision suffixing is handled by the
 * workspaces_auto_slug trigger — clients don't pre-check.
 */
export function CreateWorkspaceForm() {
  const router = useRouter();
  const session = useSession();
  // Reused for the client-side duplicate-name pre-check. Already fetched
  // for any user landing here from the post-login router or the AppShell
  // header dropdown, so no extra round-trip.
  const contexts = useUserContexts();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect anonymous users to sign in. Same pattern as WorkspaceSelector —
  // this form is reachable via the parent server component, which itself
  // doesn't auth-gate (it does CONTEXT gating); the session check stays
  // here for the "auth forgotten / signed out in another tab" case.
  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace("/auth/signin");
    }
  }, [session.status, router]);

  const trimmed = name.trim();
  const tooLong = trimmed.length > MAX_NAME_LENGTH;
  const empty = trimmed === "";
  const canSubmit =
    !empty && !tooLong && !submitting && session.status === "authenticated";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (session.status !== "authenticated") return;

    setSubmitting(true);
    setError(null);

    // Client-side duplicate-name pre-check. Compares against workspaces the
    // user owns (source='workspace' + role='owner') with the same trim +
    // case-insensitive match the server backstop uses. Skipped if contexts
    // hasn't finished loading yet — the RPC backstop in
    // 20260512120000_block_duplicate_workspace_names.sql catches anything
    // that slips through, the user just pays a network round-trip for it.
    if (contexts.status === "ready") {
      const trimmedLower = trimmed.toLowerCase();
      const conflict = contexts.contexts.some(
        (c) =>
          c.type === "agency" &&
          c.source === "workspace" &&
          c.role === "owner" &&
          c.workspaceName.trim().toLowerCase() === trimmedLower,
      );
      if (conflict) {
        setError(
          "You already have a workspace with this name. Pick a different name.",
        );
        setSubmitting(false);
        return;
      }
    }

    const { data, error: rpcError } = await supabase.rpc(
      "create_workspace_with_owner",
      { workspace_name: trimmed },
    );

    if (rpcError) {
      setError(rpcError.message);
      setSubmitting(false);
      return;
    }

    const result = data as CreateResult | null;
    if (!result?.slug || !result?.id) {
      setError(
        "Workspace was created but the response was malformed. Please refresh.",
      );
      setSubmitting(false);
      return;
    }

    // Persist last-active so a returning sign-in lands here directly. Uses
    // .select() to detect silent RLS denials per the Phase F pattern; failure
    // is non-fatal so we proceed to the new workspace regardless.
    const { error: profileError, data: profileData } = await supabase
      .from("profiles")
      .update({ last_active_workspace_id: result.id })
      .eq("id", session.user.id)
      .select();
    if (profileError) {
      console.error(
        "Failed to persist last_active_workspace_id after create:",
        profileError.message,
      );
    } else if (!profileData || profileData.length === 0) {
      console.warn(
        "last_active_workspace_id update affected 0 rows after create — RLS denial or missing profile row?",
      );
    }

    router.push(`/w/${result.slug}`);
  };

  const signOut = () => {
    void supabase.auth.signOut();
  };

  // Loading window: session resolving, or we just sent a redirect to
  // /auth/signin and are waiting for the navigation to flush.
  if (session.status === "loading" || session.status === "anonymous") {
    return (
      <AuthShell title="Loading…" subtitle="">
        <div className="h-32" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create a workspace"
      subtitle="Name it whatever fits. You can rename later."
    >
      <form onSubmit={submit}>
        <label className="block mb-1.5">
          <span className="text-[13px] text-zinc-400">Workspace name</span>
        </label>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Agency"
          // Hard maxLength prevents UI-side typing past the limit. The
          // server still enforces the same cap defensively (the validation
          // in the RPC catches any direct-SQL caller bypassing the UI).
          maxLength={MAX_NAME_LENGTH}
          className="field mb-2"
          disabled={submitting}
        />
        <p className="text-[12px] text-zinc-600 mb-5 leading-relaxed">
          Up to {MAX_NAME_LENGTH} characters.
        </p>

        {tooLong && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              Workspace name is too long ({trimmed.length} of{" "}
              {MAX_NAME_LENGTH} characters).
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary w-full justify-center mb-4"
        >
          <Plus size={14} strokeWidth={2.5} />
          {submitting ? "Creating…" : "Create workspace"}
        </button>

        <button
          type="button"
          onClick={signOut}
          disabled={submitting}
          className="btn-ghost w-full justify-center"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
