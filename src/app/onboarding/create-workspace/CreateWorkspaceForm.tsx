"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Building2, LogOut, Plus, User } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { supabase } from "@/lib/supabase";

const MAX_NAME_LENGTH = 80;
const MAX_COMPANY_LENGTH = 80;

/**
 * Workspace-type selector visibility, computed server-side by the page
 * component (which has access to `fetchCallerContextSummary` cheaply)
 * and passed in as a prop. See page.tsx for the per-mode rationale.
 */
export type WorkspaceTypeSelectorMode =
  | "show-no-default"
  | "show-with-agency-default"
  | "hide-force-personal"
  // WL-3a: Flow A signup case — the user landed here from
  // /select-workspace because their only context is the WL-2
  // auto-personal. Selector renders with agency pre-selected; the
  // Personal card is shown but in its existing at-limit disabled
  // state (hasPersonalWorkspace=true for them by construction). They
  // can name an agency and submit immediately.
  | "force-agency";

type WorkspaceType = "agency" | "personal";

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
type Props = {
  /** Server-computed signal — true when this is the caller's first
   *  workspace creation (no `workspace_memberships` rows with role='owner'
   *  exist yet). Drives whether the Company name input renders. Asked
   *  exactly once; editable later in /settings/account. */
  showCompanyNameField?: boolean;
  /** Workspace-type selector visibility + default-selection behavior.
   *  See page.tsx for the per-mode rationale; the form just renders
   *  the appropriate UI and writes the chosen type through to the
   *  create_workspace_with_owner RPC. */
  selectorMode: WorkspaceTypeSelectorMode;
  /** WT-5: server-computed flag — true when the caller already owns a
   *  personal workspace (1-per-user cap reached). Renders the Personal
   *  card in a disabled state with a tooltip. The actual cap is
   *  enforced by the RPC raising 23505; this prop is the UX affordance
   *  that prevents the user from hitting that error in the first place.
   *  Defaults to false because callers without the flag (zero-context
   *  signups, pre-WT-5 mounts) shouldn't be blocked. */
  hasPersonalWorkspace?: boolean;
};

export function CreateWorkspaceForm({
  showCompanyNameField = false,
  selectorMode,
  hasPersonalWorkspace = false,
}: Props) {
  const router = useRouter();
  const session = useSession();
  // Reused for the client-side duplicate-name pre-check. Already fetched
  // for any user landing here from the post-login router or the AppShell
  // header dropdown, so no extra round-trip.
  const contexts = useUserContexts();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  // WT-3 + WL-3a: initialise workspaceType from selectorMode.
  //   'show-no-default'           → null      (must pick before submit)
  //   'show-with-agency-default'  → 'agency'  (default-but-changeable)
  //   'hide-force-personal'       → 'personal' (locked, no UI shown)
  //   'force-agency'              → 'agency'  (Personal card stays
  //                                            visible but disabled via
  //                                            the existing
  //                                            hasPersonalWorkspace
  //                                            at-limit affordance — for
  //                                            Flow A signups the prop
  //                                            is true by construction)
  const [workspaceType, setWorkspaceType] = useState<WorkspaceType | null>(
    selectorMode === "show-with-agency-default" ||
      selectorMode === "force-agency"
      ? "agency"
      : selectorMode === "hide-force-personal"
        ? "personal"
        : null,
  );
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
  // workspaceType non-null is part of canSubmit. In 'show-with-agency-
  // default' and 'hide-force-personal' modes the initial value is non-
  // null, so the button is enabled from first render. In 'show-no-
  // default' mode the button stays disabled until the user picks.
  const canSubmit =
    !empty &&
    !tooLong &&
    !submitting &&
    session.status === "authenticated" &&
    workspaceType !== null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    if (session.status !== "authenticated") return;
    // Defensive — canSubmit already encodes workspaceType !== null, but
    // the explicit check narrows the type for the RPC call below AND
    // surfaces a user-facing error if some future bypass enables submit
    // without a selection.
    if (workspaceType === null) {
      setError("Please select a workspace type.");
      return;
    }

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
      {
        workspace_name: trimmed,
        // WT-3: write the selector's chosen type through to the RPC.
        // The new parameter defaults to 'agency' server-side (WT-2), so
        // omitting it would silently land an agency workspace even when
        // the user picked personal — always pass explicitly.
        workspace_type: workspaceType,
      },
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

    // First-workspace company_name capture. Same non-fatal post-RPC
    // pattern as last_active_workspace_id above — if this fails the
    // user still gets to their new workspace, and they can fill it in
    // later from /settings/account. Asked at most once (gated on the
    // server-side first-workspace check); written only when the field
    // is shown AND the user entered a non-empty value.
    const trimmedCompany = companyName.trim();
    if (showCompanyNameField && trimmedCompany !== "") {
      const { error: companyError } = await supabase
        .from("profiles")
        .update({ company_name: trimmedCompany })
        .eq("id", session.user.id);
      if (companyError) {
        console.error(
          "[onboarding] company_name save failed:",
          companyError?.message,
          "code:",
          companyError?.code,
          "details:",
          companyError?.details,
          "hint:",
          companyError?.hint,
        );
      }
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
        {/* WT-3: workspace-type selector. Placed above the name field
            because the type decision dictates downstream feature
            visibility (team invites, client portals, plan options) —
            choosing it first frames the rest of the form. Hidden
            entirely in 'hide-force-personal' mode where the type is
            locked. */}
        {selectorMode !== "hide-force-personal" && (
          <div className="mb-5">
            <label className="block mb-2.5">
              <span className="text-[13px] text-zinc-400">Workspace type</span>
            </label>
            <div
              role="radiogroup"
              aria-label="Workspace type"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            >
              <WorkspaceTypeCard
                kind="agency"
                title="Agency"
                description="For agencies with team members and client portals. Invite teammates, manage clients, use Solo or Team plan."
                Icon={Building2}
                selected={workspaceType === "agency"}
                onSelect={() => setWorkspaceType("agency")}
                disabled={submitting}
              />
              <WorkspaceTypeCard
                kind="personal"
                title="Personal"
                description="Solo workspace for your own work. No team invites, no client portals. Solo plan only."
                Icon={User}
                selected={workspaceType === "personal"}
                onSelect={() => setWorkspaceType("personal")}
                disabled={submitting}
                atLimit={hasPersonalWorkspace}
                atLimitTooltip="You already have a personal workspace. Delete it first to create another."
              />
            </div>
            {selectorMode === "show-no-default" && workspaceType === null && (
              <p className="text-[12px] text-zinc-500 mt-2 leading-relaxed">
                Choose your workspace type to continue.
              </p>
            )}
          </div>
        )}

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

        {/* Company name — asked exactly once, on the user's first
            workspace creation (server-gated via showCompanyNameField).
            Optional; clients see it in invite emails and the portal
            pill. Editable later in /settings/account. */}
        {showCompanyNameField && (
          <>
            <label className="block mb-1.5">
              <span className="text-[13px] text-zinc-400">
                Company name <span className="text-zinc-600">(optional)</span>
              </span>
            </label>
            <div className="relative mb-2">
              <Building2
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc"
                maxLength={MAX_COMPANY_LENGTH}
                className="field"
                style={{ paddingLeft: "40px" }}
                disabled={submitting}
              />
            </div>
            <p className="text-[12px] text-zinc-600 mb-5 leading-relaxed">
              Your clients will see this in invites.
            </p>
          </>
        )}

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

// ─── WorkspaceTypeCard (WT-3) ───────────────────────────────────────────────

/**
 * One card in the workspace-type selector pair. Rendered as a
 * <button role="radio"> so the pair behaves as a radiogroup — Tab
 * focuses the first card, then Tab moves to the next focusable, and
 * Space/Enter activates. aria-checked exposes the selection state to
 * screen readers.
 *
 * Selected state lifts a 1px stages-blue border + a very light blue
 * tint over the standard #1F1F22 card background. Hover (when not
 * selected) lifts the border to #4A4A50, matching the panel-card
 * pattern used elsewhere in AuthShell.
 */
function WorkspaceTypeCard({
  kind,
  title,
  description,
  Icon,
  selected,
  onSelect,
  disabled,
  atLimit = false,
  atLimitTooltip,
}: {
  kind: "agency" | "personal";
  title: string;
  description: string;
  Icon: typeof Building2;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
  /** WT-5: when true, the card is rendered locked at reduced opacity
   *  with the atLimitTooltip on hover. Distinct from `disabled` (which
   *  is the global form-submitting lock — applies to both cards). */
  atLimit?: boolean;
  atLimitTooltip?: string;
}) {
  // Locked overrides the "selectable" affordances. Click is a no-op so
  // even keyboard activation (Space/Enter) leaves workspaceType
  // untouched — the at-limit user can never select Personal via the
  // UI. Server-side RPC raise is the security floor (WT-4).
  const locked = atLimit || disabled;
  const handleClick = atLimit ? undefined : onSelect;
  // WT-5 follow-up: the at-limit tooltip uses a CSS hover overlay
  // instead of the browser's native title attribute. Native title
  // showed inconsistently on aria-disabled buttons across browsers
  // (Jordan's verification: tooltip not visible in production), so
  // the overlay is the more reliable pattern. Wraps the button in a
  // `relative group` so the overlay can position relative to the card
  // and the button's hover triggers `group-hover` on the wrapper.
  const card = (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={atLimit || undefined}
      aria-label={
        atLimit && atLimitTooltip
          ? `${title} workspace — ${atLimitTooltip}`
          : `${title} workspace`
      }
      onClick={handleClick}
      disabled={disabled}
      className="text-left p-3.5 rounded-lg flex flex-col gap-1.5 transition-colors w-full"
      style={{
        background: selected ? "rgba(16, 140, 233, 0.06)" : "#1F1F22",
        border: selected
          ? "1px solid #108CE9"
          : "1px solid #36363A",
        opacity: locked ? 0.5 : 1,
        cursor: atLimit
          ? "not-allowed"
          : disabled
            ? "not-allowed"
            : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!locked && !selected) {
          e.currentTarget.style.borderColor = "#4A4A50";
        }
      }}
      onMouseLeave={(e) => {
        if (!locked && !selected) {
          e.currentTarget.style.borderColor = "#36363A";
        }
      }}
      data-kind={kind}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
          style={{
            background: selected
              ? "rgba(16, 140, 233, 0.18)"
              : "rgba(255, 255, 255, 0.04)",
            border: selected
              ? "1px solid rgba(16, 140, 233, 0.30)"
              : "1px solid #36363A",
          }}
        >
          <Icon
            size={14}
            className={selected ? "text-stages-blue" : "text-zinc-400"}
          />
        </div>
        <div className="text-[14px] font-semibold text-zinc-100">{title}</div>
      </div>
      <p className="text-[12px] text-zinc-500 leading-snug">{description}</p>
    </button>
  );

  if (atLimit && atLimitTooltip) {
    return (
      <div className="relative group">
        {card}
        {/* Tooltip — fades in on hover OR keyboard focus within the
            wrapper. pointer-events-none on the tooltip itself so it
            doesn't intercept the user's cursor + cause flicker.
            Positioned just below the card with a 6px gap so it doesn't
            overlap the next card in the grid. role="tooltip" + the
            aria-describedby on the button (not needed here because the
            tooltip text is already mirrored into aria-label) gives
            screen readers redundant access to the same explanation. */}
        <div
          role="tooltip"
          className="absolute left-0 right-0 top-full mt-1.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity duration-150 z-10 px-3 py-2 rounded-md text-[12px] leading-snug"
          style={{
            background: "#1A1A1C",
            color: "#E4E4E7",
            border: "1px solid #36363A",
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}
        >
          {atLimitTooltip}
        </div>
      </div>
    );
  }

  return card;
}
