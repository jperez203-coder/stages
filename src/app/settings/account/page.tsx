"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Lock,
  User,
  X,
  Zap,
} from "lucide-react";
import { GoogleGLogo } from "@/components/auth/GoogleGLogo";
import { useSession } from "@/hooks/useSession";
import {
  useLinkedIdentities,
  type LinkedIdentity,
  type LinkedIdentitiesState,
} from "@/hooks/useLinkedIdentities";
import { supabase } from "@/lib/supabase";

const MIN_PASSWORD_LENGTH = 8;
const BANNER_DISMISSED_KEY = "settings-add-password-banner-dismissed";

/**
 * /settings/account — account-level settings.
 *
 * Surfaces:
 *   * Linked accounts section — currently-linked identities + add affordances
 *     for unlinked providers (Add password via supabase.auth.updateUser;
 *     Add Google via supabase.auth.linkIdentity).
 *
 * Sections coming in 8c:
 *   * Dismissible banner at top when user has only a non-email identity
 *     (gentle nudge toward setting a password for faster sign-in next time).
 *
 * Permissions: must be signed in. Anonymous → /auth/signin redirect.
 *
 * IMPORTANT: Supabase requires the new identity's email to MATCH the
 * existing user's email when linking. For Add Google, the Google account
 * authorising must have the same email as the user's current auth.users
 * row. Cross-email linking is rejected with a clear error.
 */
export default function AccountSettingsPage() {
  const session = useSession();
  const router = useRouter();
  const linked = useLinkedIdentities();
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Banner dismissal state. "loading" prevents the initial-render flash
  // (we can't read localStorage during SSR / first render). Once mounted,
  // the effect below resolves it to "show" or "dismissed".
  const [bannerState, setBannerState] = useState<
    "loading" | "show" | "dismissed"
  >("loading");
  // Lifted expanded-state for the password form so the banner's "Set
  // password" button can trigger it. EmailIdentityCard becomes a
  // controlled component for this one piece of state.
  const [passwordFormExpanded, setPasswordFormExpanded] = useState(false);
  const passwordCardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const dismissed =
      window.localStorage.getItem(BANNER_DISMISSED_KEY) === "true";
    setBannerState(dismissed ? "dismissed" : "show");
  }, []);

  const dismissBanner = () => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(BANNER_DISMISSED_KEY, "true");
      } catch {
        // localStorage unavailable (private browsing edge case); banner
        // re-appears next session. Acceptable degradation.
      }
    }
    setBannerState("dismissed");
  };

  const triggerSetPassword = () => {
    setPasswordFormExpanded(true);
    // Smooth-scroll to the password card so users on small screens don't
    // have to hunt for the now-expanded form below the banner.
    passwordCardRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace("/auth/signin");
    }
  }, [session.status, router]);

  // Catch OAuth error params that Supabase appends to the redirect URL when
  // a linkIdentity flow fails (e.g., email mismatch, user cancels at Google,
  // provider rejection). Errors can be in either the query string (PKCE
  // flow) or the URL hash (implicit flow) depending on Supabase's flow
  // config — check both.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const queryParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    );
    const errParam =
      queryParams.get("error") || hashParams.get("error");
    const errDescription =
      queryParams.get("error_description") ||
      hashParams.get("error_description");
    if (errParam) {
      setOauthError(errDescription || errParam);
      // Clean the URL so a refresh doesn't keep showing the error.
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  if (session.status !== "authenticated") {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-[13px] text-zinc-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[24px] font-semibold mb-1">Account</h1>
        <p className="text-[14px] text-zinc-500">
          Your sign-in methods and account-level preferences.
        </p>
      </header>

      {oauthError && (
        <div className="mb-6 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium mb-0.5">
              Couldn&apos;t link account
            </div>
            <div className="text-[12px] text-stages-red/80">{oauthError}</div>
          </div>
          <button
            onClick={() => setOauthError(null)}
            className="text-[12px] text-stages-red/80 hover:text-stages-red transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Add-password nudge banner. Only shows when:
            * bannerState === "show" — user hasn't dismissed it this browser
            * identities are loaded — avoid flashing the banner during the
              brief load window before we know hasPassword
            * !hasPassword — they're magic-link-only (or Google-only without
              a password). Password users don't need the nudge.
          Dismissal is persisted in localStorage (BANNER_DISMISSED_KEY).
          "Set password" expands + scrolls to the password card below. */}
      {bannerState === "show" &&
        linked.status === "ready" &&
        !linked.hasPassword && (
          <AddPasswordBanner
            onSetPassword={triggerSetPassword}
            onDismiss={dismissBanner}
          />
        )}

      {/* Profile section — stacked ABOVE Linked accounts per the
          stacked-section pattern already established by the
          add-password banner. Linked accounts is scoped to auth
          methods; profile metadata (the user's name) is orthogonal
          and deserves its own card. */}
      <ProfileSection userId={session.user.id} />

      <LinkedAccountsSection
        userEmail={session.user.email ?? ""}
        state={linked}
        passwordExpanded={passwordFormExpanded}
        onPasswordExpandedChange={setPasswordFormExpanded}
        passwordCardRef={passwordCardRef}
      />
    </div>
  );
}

// ─── Profile section ───────────────────────────────────────────────────────

/**
 * Display-name editor. Reads + writes profiles.display_name for the
 * signed-in user. Pre-fills from the current row on mount; Save is
 * disabled until the trimmed input differs from the current value
 * (avoids no-op writes + makes "is there something to save?" obvious).
 *
 * No DB migration is needed for this surface — profiles.display_name
 * exists and is already read by every display site. We're just giving
 * users a way to fill it in (or change it) without touching SQL.
 */
function ProfileSection({ userId }: { userId: string }) {
  const [savedName, setSavedName] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setLoadError(error.message);
        setLoadStatus("error");
        return;
      }
      const current = ((data?.display_name as string | null) ?? "").trim();
      setSavedName(current);
      setFullName(current);
      setLoadStatus("ready");
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // Clear the "Saved" indicator on the next keystroke so users get
  // honest "you have unsaved changes" feedback after editing post-save.
  useEffect(() => {
    if (!justSaved) return;
    if (fullName.trim() !== savedName) setJustSaved(false);
  }, [fullName, savedName, justSaved]);

  const trimmedName = fullName.trim();
  const canSave =
    loadStatus === "ready" &&
    trimmedName.length > 0 &&
    trimmedName !== savedName &&
    !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSavedName(trimmedName);
    setJustSaved(true);
  };

  return (
    <section className="mb-8">
      <h2 className="text-[15px] font-semibold mb-1">Profile</h2>
      <p className="text-[13px] text-zinc-500 mb-4">
        The name your teammates and clients see across Stages.
      </p>

      <div className="panel-card p-5">
        {loadStatus === "loading" && (
          <div className="text-[13px] text-zinc-500">Loading…</div>
        )}

        {loadStatus === "error" && (
          <div className="flex items-start gap-2 text-[13px] text-stages-red">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Couldn&apos;t load your profile: {loadError}</span>
          </div>
        )}

        {loadStatus === "ready" && (
          <>
            <label className="block mb-1.5">
              <span className="text-[13px] text-zinc-400">Full name</span>
            </label>
            <div className="relative mb-4">
              <User
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Casey Smith"
                className="field"
                style={{ paddingLeft: "40px" }}
                disabled={saving}
              />
            </div>

            {saveError && (
              <div className="mb-3 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{saveError}</span>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="btn-primary justify-center"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {justSaved && (
                <span
                  className="inline-flex items-center gap-1 text-[12px] text-stages-green"
                  // Small fade-in; sits next to the button so the
                  // success state is local rather than a floating toast.
                  // Doesn't auto-disappear — clears on the next edit so
                  // the user sees "saved → unsaved changes" honestly.
                  role="status"
                  aria-live="polite"
                >
                  <Check size={12} strokeWidth={3} />
                  Saved
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─── Linked accounts ────────────────────────────────────────────────────────

function LinkedAccountsSection({
  userEmail,
  state,
  passwordExpanded,
  onPasswordExpandedChange,
  passwordCardRef,
}: {
  userEmail: string;
  state: LinkedIdentitiesState;
  /** Controlled expanded-state for the inline password form. Lifted to
   *  the page so the banner's "Set password" CTA can open it. */
  passwordExpanded: boolean;
  onPasswordExpandedChange: (v: boolean) => void;
  /** Attached to the password card so the banner can scroll to it. */
  passwordCardRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold mb-1">Linked accounts</h2>
      <p className="text-[13px] text-zinc-500 mb-4">
        Manage how you sign in to your Stages account.
      </p>

      {state.status === "loading" && (
        <div className="panel-card p-6 text-[13px] text-zinc-500">Loading…</div>
      )}

      {state.status === "error" && (
        <div className="panel-card p-6 flex items-start gap-2 text-[13px] text-stages-red">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn&apos;t load identities: {state.message}</span>
        </div>
      )}

      {state.status === "ready" && (
        <div className="space-y-3">
          <EmailIdentityCard
            userEmail={userEmail}
            hasPassword={state.hasPassword}
            emailIdentity={
              state.identities.find((i) => i.provider === "email") ?? null
            }
            onLinked={state.refetch}
            expanded={passwordExpanded}
            onExpandedChange={onPasswordExpandedChange}
            cardRef={passwordCardRef}
          />
          <GoogleIdentityCard
            identity={
              state.identities.find((i) => i.provider === "google") ?? null
            }
            userEmail={userEmail}
          />
        </div>
      )}
    </section>
  );
}

// ─── Email + password card ──────────────────────────────────────────────────

function EmailIdentityCard({
  userEmail,
  hasPassword,
  emailIdentity,
  onLinked,
  expanded,
  onExpandedChange,
  cardRef,
}: {
  userEmail: string;
  /** Combined signal from useLinkedIdentities (identity row OR metadata flag). */
  hasPassword: boolean;
  /** The 'email' identity row if it exists; for the "Set up with X" subtitle. */
  emailIdentity: LinkedIdentity | null;
  onLinked: () => Promise<void>;
  /** Controlled — owned by AccountSettingsPage so the banner can open it. */
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  /** Attached to the outer card so the banner can scroll to it on "Set password". */
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  // `linked` derived from the combined hasPassword signal — NOT from
  // emailIdentity alone. Users who set passwords on top of a Google
  // identity won't have an `email` identity row but DO have a password.
  // See useLinkedIdentities.ts header for the full explanation.
  const linked = hasPassword;
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH && !submitting;

  const cancel = () => {
    onExpandedChange(false);
    setPassword("");
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    // updateUser sets the password hash on auth.users. The `data` field
    // updates user_metadata — we set has_password=true so the UI can
    // detect "password is set" on subsequent renders.
    //
    // Note: when the user already has a non-email identity at the same
    // email (e.g., Google), Supabase does NOT create a separate `email`
    // identity row. The password hash lives on auth.users; only the
    // metadata flag tells the UI "password works for this user."
    // useLinkedIdentities derives `hasPassword` from a combined check
    // (metadata flag OR `email` identity row) — see its header.
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { has_password: true },
    });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }
    setPassword("");
    onExpandedChange(false);
    setSubmitting(false);
    await onLinked();
  };

  return (
    <div ref={cardRef} className="panel-card p-4">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "#2A2A2D", border: "1px solid #36363A" }}
        >
          <Lock size={18} className="text-zinc-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium text-zinc-200">
            Password sign-in
          </div>
          <div className="text-[12px] text-zinc-500 mt-0.5 truncate">
            {linked
              ? `Set up with ${emailIdentity?.email ?? userEmail}`
              : "Add a password for faster sign-in next time."}
          </div>
        </div>
        {linked ? (
          <span className="text-[11px] uppercase tracking-wider text-stages-green font-medium flex-shrink-0">
            Linked
          </span>
        ) : !expanded ? (
          <button
            onClick={() => onExpandedChange(true)}
            className="btn-ghost flex-shrink-0"
          >
            Set password
          </button>
        ) : null}
      </div>

      {expanded && !linked && (
        <form
          onSubmit={submit}
          className="mt-4 pt-4"
          style={{ borderTop: "1px solid #36363A" }}
        >
          <p className="text-[12px] text-zinc-500 mb-3">
            You&apos;ll sign in with this password using{" "}
            <span className="text-zinc-300 font-medium">{userEmail}</span>.
          </p>
          <div className="relative mb-1.5">
            <Lock
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <input
              autoFocus
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`${MIN_PASSWORD_LENGTH}+ characters`}
              className="field"
              style={{ paddingLeft: "40px", paddingRight: "40px" }}
              disabled={submitting}
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p
            className={`text-[12px] mb-4 ${
              tooShort ? "text-stages-red" : "text-zinc-600"
            }`}
          >
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>

          {error && (
            <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={submitting}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {submitting ? "Setting password…" : "Set password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Google card ────────────────────────────────────────────────────────────

function GoogleIdentityCard({
  identity,
  userEmail,
}: {
  identity: LinkedIdentity | null;
  userEmail: string;
}) {
  const linked = !!identity;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    // linkIdentity initiates an OAuth flow. With auto-redirect (default),
    // the browser navigates to Google's consent screen. After consent
    // and the Supabase callback, the user lands back at redirectTo
    // (/settings/account). detectSessionInUrl: true picks up any tokens
    // in the URL, USER_UPDATED fires on the auth state subscription,
    // useLinkedIdentities refetches, the new identity appears.
    //
    // IMPORTANT: the Google account being authorised MUST have the same
    // email as the current Supabase user (auth.users.email). Cross-email
    // linking is rejected — the error surfaces in the URL params on
    // return and is displayed by the parent page's oauthError state.
    const { error: linkError } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/settings/account`
            : undefined,
      },
    });
    if (linkError) {
      // Pre-redirect failure (rare — usually a SDK config issue, not an
      // OAuth-side problem). The OAuth-side failures surface on the
      // return via URL params.
      setError(linkError.message);
      setConnecting(false);
      return;
    }
    // Auto-redirect underway. Leave `connecting` true so the button
    // stays disabled until the browser navigates away.
  };

  return (
    <div className="panel-card p-4">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "#2A2A2D", border: "1px solid #36363A" }}
        >
          <GoogleGLogo size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium text-zinc-200">Google</div>
          <div className="text-[12px] text-zinc-500 mt-0.5 truncate">
            {linked && identity?.email
              ? `Connected to ${identity.email}`
              : linked
              ? "Connected"
              : `Connect a Google account matching ${userEmail}.`}
          </div>
        </div>
        {linked ? (
          <span className="text-[11px] uppercase tracking-wider text-stages-green font-medium flex-shrink-0">
            Linked
          </span>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            className="btn-ghost flex-shrink-0"
          >
            <GoogleGLogo size={14} />
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

// ─── Add-password banner ────────────────────────────────────────────────────

/**
 * Nudge banner shown to users who don't have a password set yet — i.e.,
 * magic-link clients who upgraded to an agency account, or users who only
 * have Google. Without a password they need a fresh magic link every login
 * (or lose access if they lose Google). The banner is dismissible (sticky
 * via localStorage, scoped to BANNER_DISMISSED_KEY) and the CTA expands +
 * scrolls to the inline password form below.
 *
 * Intentionally rendered above "Linked accounts" so it's the first thing
 * a magic-link-only user sees on this page.
 */
function AddPasswordBanner({
  onSetPassword,
  onDismiss,
}: {
  onSetPassword: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="mb-6 p-4 rounded-lg flex items-start gap-3"
      style={{
        background: "rgba(16, 140, 233, 0.08)",
        border: "1px solid rgba(16, 140, 233, 0.35)",
      }}
    >
      <div
        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: "rgba(16, 140, 233, 0.18)" }}
      >
        <Zap size={16} className="text-stages-blue" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-zinc-100 mb-0.5">
          Sign in faster next time
        </div>
        <p className="text-[12.5px] text-zinc-400 leading-snug mb-3">
          You&apos;re currently signing in without a password. Set one so you
          don&apos;t need a fresh magic link every time — and so you don&apos;t
          lose access if anything happens to your Google account.
        </p>
        <button onClick={onSetPassword} className="btn-primary">
          Set password
        </button>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1 -mr-1 -mt-1"
      >
        <X size={14} />
      </button>
    </div>
  );
}
