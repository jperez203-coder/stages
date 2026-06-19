"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Clock,
  LogIn,
  LogOut,
  UserPlus,
} from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { setPendingAcceptInvite } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/**
 * /accept-invite/[token] — public landing page for workspace invite links.
 *
 * State-driven render. The page fetches invite details via the
 * `get_workspace_invite_preview` RPC (security definer + granted to anon +
 * authenticated, so it works even before the recipient has signed in),
 * then branches on preview status × session state to show one of seven
 * tailored UIs. Only four of those land in 6d-i — the three authenticated
 * branches (wrong email, already member, accept-button matching email)
 * are stubbed under a single placeholder state and wire in 6d-iii.
 *
 * Routing: outside the /w/[slug]/* tree, so AppShell doesn't apply — every
 * state renders inside AuthShell, same chrome as /auth/signin and friends.
 *
 * Token preservation through sign-in / sign-up (the "anonymous user clicks
 * 'Sign in' on this page → comes back here authenticated" flow) lands in
 * 6d-ii. For 6d-i the buttons are plain links with no localStorage step,
 * so an anonymous user clicking 'Sign in' will end up on /auth/signin and
 * have to navigate back manually.
 */

// UUID format check — the route param could be anything if the user types
// gibberish into the URL bar. Pre-validating saves an RPC roundtrip for
// obvious non-tokens and collapses them into the not_found UI.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InvitePreview = {
  status: "pending" | "expired" | "accepted" | "not_found";
  workspace_name?: string;
  workspace_slug?: string;
  email?: string;
  role?: "admin" | "member";
  inviter_display_name?: string | null;
  inviter_email?: string | null;
  inviter_is_active_member?: boolean;
  expires_at?: string;
  accepted_at?: string | null;
  /** FB-2: true when an auth.users row exists for the invited email
   *  (case-insensitive match). Drives the conditional CTA — primary
   *  becomes "Sign in to accept" for existing accounts, "Create an
   *  account" for new ones. Optional so a pre-FB-2 client safely no-ops
   *  if the field is missing. Defaults to false at render time (treat
   *  "we don't know" as "probably a new user" — promotes Create which
   *  is the safer guess for fresh outbound invites). */
  recipient_has_account?: boolean;
};

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "fetched"; preview: InvitePreview };

export default function AcceptInvitePage() {
  const params = useParams();
  const session = useSession();
  // useUserContexts gives us the user's existing memberships, used for the
  // "already a member" pre-check below. Cheap because the contexts fetch
  // would happen anyway when the user lands on /w/[slug] post-accept.
  const contexts = useUserContexts();
  const token =
    typeof params?.token === "string" ? params.token : null;
  const isValidToken = !!token && UUID_REGEX.test(token);

  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "loading",
  });

  useEffect(() => {
    if (!isValidToken || !token) {
      // Collapse non-UUID URLs into the not_found UI without burning a
      // server round-trip. Distinguishing "invalid format" from "valid
      // but missing" doesn't help the recipient — both mean "this link
      // doesn't work."
      setPreviewState({
        status: "fetched",
        preview: { status: "not_found" },
      });
      return;
    }
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc(
        "get_workspace_invite_preview",
        { invite_token: token },
      );
      if (!active) return;
      if (error) {
        setPreviewState({ status: "error", message: error.message });
        return;
      }
      setPreviewState({
        status: "fetched",
        preview: (data ?? { status: "not_found" }) as InvitePreview,
      });
    })();
    return () => {
      active = false;
    };
  }, [token, isValidToken]);

  // Loading window — covers both the preview fetch and the brief initial
  // session.status === "loading". Single placeholder avoids flashing
  // multiple intermediate states during page mount.
  if (
    previewState.status === "loading" ||
    session.status === "loading"
  ) {
    return <LoadingState />;
  }

  if (previewState.status === "error") {
    return <FetchErrorState message={previewState.message} />;
  }

  const { preview } = previewState;

  if (preview.status === "not_found") {
    return <NotFoundState />;
  }
  if (preview.status === "expired") {
    return <ExpiredState preview={preview} />;
  }
  if (preview.status === "accepted") {
    return <AcceptedState preview={preview} />;
  }

  // preview.status === "pending"
  if (session.status === "anonymous") {
    return <PendingAnonymousState preview={preview} token={token ?? ""} />;
  }

  // Authenticated branch. Three sub-states:
  //   1. Wrong email (signed in as someone other than the invitee)
  //   2. Already a member of this workspace
  //   3. Ready to accept
  // useUserContexts is needed for #2; if it's still loading, show a
  // placeholder rather than risk rendering the accept button to someone
  // who's already a member and then having the RPC raise.
  if (contexts.status === "loading") {
    return <LoadingState />;
  }

  const currentEmail = session.user.email ?? "";
  const emailMatches =
    !!preview.email &&
    preview.email.trim().toLowerCase() === currentEmail.trim().toLowerCase();

  if (!emailMatches) {
    return (
      <WrongAccountState
        preview={preview}
        currentEmail={currentEmail}
        token={token ?? ""}
      />
    );
  }

  // Already-a-member check. Match by workspace_slug — the preview RPC
  // doesn't return workspace_id, but slug is unique case-insensitively
  // (workspaces_slug_lower_idx) so it's a safe identifier.
  const alreadyMember =
    contexts.status === "ready" &&
    contexts.contexts.some(
      (c) =>
        c.workspaceSlug === preview.workspace_slug && c.type === "agency",
    );

  if (alreadyMember) {
    return <AlreadyMemberState preview={preview} />;
  }

  // WL-3b: 1-agency-cap preflight. If the user already belongs to any
  // agency workspace_membership AND this invite is for an agency
  // (every pending invite today, since WT-4 blocks personal-target
  // invites at the accept RPC), render an info state instead of the
  // accept button. The user can leave their current agency or
  // decline. The accept_workspace_invite RPC raises 23505 from the
  // WL-1 cap as the security floor; this preflight is purely UX so
  // the user doesn't click Accept and get a raw error message.
  //
  // Predicate: any workspace-sourced agency context. workspaceType
  // is set for every agency context post-WT-5; the defensive
  // fallback `?? "agency"` here keeps in-flight contexts (type
  // undefined for a frame) from sneaking past, since the accept RPC
  // would still raise on them.
  const existingAgencyContext =
    contexts.status === "ready"
      ? contexts.contexts.find(
          (c) =>
            c.type === "agency" &&
            c.source === "workspace" &&
            (c.workspaceType ?? "agency") === "agency",
        )
      : null;

  if (existingAgencyContext) {
    return (
      <AlreadyInAgencyState
        preview={preview}
        existingAgencyName={existingAgencyContext.workspaceName}
        existingAgencySlug={existingAgencyContext.workspaceSlug}
      />
    );
  }

  return (
    <ReadyToAcceptState
      preview={preview}
      token={token ?? ""}
      userId={session.user.id}
    />
  );
}

// ─── Loading + error ───────────────────────────────────────────────────────

function LoadingState() {
  return (
    <AuthShell title="Loading invite…" subtitle="Hold on a moment.">
      <div className="h-32" />
    </AuthShell>
  );
}

function FetchErrorState({ message }: { message: string }) {
  return (
    <AuthShell
      title="Something went wrong"
      subtitle="We couldn't load this invite."
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-red/10">
          <AlertCircle size={22} className="text-stages-red" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed break-words">
          {message}
        </p>
        <Link href="/auth/signin" className="btn-ghost w-full justify-center">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

// ─── Preview status states ─────────────────────────────────────────────────

function NotFoundState() {
  return (
    <AuthShell
      title="Invite not valid"
      subtitle="This link is no longer active."
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-red/10">
          <AlertCircle size={22} className="text-stages-red" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          This invite is no longer valid. It may have been revoked, or the
          link is broken. Contact the person who invited you for a new one.
        </p>
        <Link href="/auth/signin" className="btn-ghost w-full justify-center">
          <LogIn size={14} />
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

function ExpiredState({ preview }: { preview: InvitePreview }) {
  const inviterName =
    preview.inviter_display_name || preview.inviter_email || "your inviter";
  const expiredAt = preview.expires_at ? new Date(preview.expires_at) : null;
  const expiredAtLabel = expiredAt
    ? expiredAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "earlier";

  return (
    <AuthShell
      title="Invite expired"
      subtitle={
        preview.workspace_name
          ? `Your invite to ${preview.workspace_name} has expired.`
          : "This invite has expired."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-amber/10">
          <Clock size={22} className="text-stages-amber" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          <span className="text-zinc-100 font-medium">{inviterName}</span>{" "}
          invited you to{" "}
          <span className="text-zinc-100 font-medium">
            {preview.workspace_name ?? "a workspace"}
          </span>
          , but the invite expired on {expiredAtLabel}.
        </p>
        {preview.inviter_email && (
          <p className="text-[12px] text-zinc-500 mb-5">
            Contact{" "}
            <span className="text-zinc-400">{preview.inviter_email}</span> to
            send a new one.
          </p>
        )}
        <Link href="/auth/signin" className="btn-ghost w-full justify-center">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  );
}

function AcceptedState({ preview }: { preview: InvitePreview }) {
  // Per the locked decision: hide inviter context for the accepted state.
  // The recipient already joined; who invited them is no longer useful.
  return (
    <AuthShell
      title="Already accepted"
      subtitle={
        preview.workspace_name
          ? `You've already joined ${preview.workspace_name}.`
          : "You've already accepted this invite."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-green/10">
          <Check size={22} className="text-stages-green" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          You&apos;ve already accepted this invite. Sign in to open{" "}
          <span className="text-zinc-100 font-medium">
            {preview.workspace_name ?? "your workspace"}
          </span>
          .
        </p>
        <Link href="/auth/signin" className="btn-primary w-full justify-center">
          <LogIn size={14} />
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}

function PendingAnonymousState({
  preview,
  token,
}: {
  preview: InvitePreview;
  token: string;
}) {
  const inviterName =
    preview.inviter_display_name || preview.inviter_email || "Someone";
  const inviterSuffix = preview.inviter_is_active_member ? "" : " (no longer in this workspace)";
  const role = preview.role ?? "member";

  // FB-1: token preservation across the email-confirmation browser handoff.
  // Two-layer scheme that survives both same-browser and cross-browser flows:
  //
  //   1. localStorage write (preserveToken below) — survives in-session
  //      navigation between /accept-invite, /auth/signin, /auth/signup,
  //      and the post-auth WorkspaceSelector mount. Consumed by
  //      WorkspaceSelector via consumePendingAcceptInvite. Works when the
  //      whole flow stays in one browser session (incl. email confirmation
  //      OFF + immediate sign-in).
  //
  //   2. URL query param (?invite=<token>) embedded in the CTA hrefs —
  //      survives the cross-browser email-confirmation handoff. When email
  //      confirmation is ON, Supabase emails a link to /auth/signin which
  //      may open in a different browser/profile than the one where the
  //      user typed the password. localStorage is sandboxed per browser,
  //      so layer 1 is empty there. SignUpForm reads ?invite= and threads
  //      it through emailRedirectTo as ?next=/accept-invite/<token>; the
  //      post-confirm landing carries the token in the URL the email
  //      client opened, regardless of localStorage state.
  //
  // WorkspaceSelector prefers URL params over localStorage. Both layers
  // coexist; either alone is sufficient to recover the invite context.
  const preserveToken = () => {
    setPendingAcceptInvite(token);
  };

  const signupHref = `/auth/signup?invite=${encodeURIComponent(token)}`;
  const signinHref = `/auth/signin?invite=${encodeURIComponent(token)}`;

  return (
    <AuthShell
      title="You're invited"
      subtitle={
        preview.workspace_name
          ? `Join ${preview.workspace_name} on Stages.`
          : "Join the workspace on Stages."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
          <UserPlus size={22} className="text-stages-blue" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          <span className="text-zinc-100 font-medium">
            {inviterName}
          </span>
          <span className="text-zinc-500">{inviterSuffix}</span> invited you to{" "}
          <span className="text-zinc-100 font-medium">
            {preview.workspace_name ?? "a workspace"}
          </span>{" "}
          as a{" "}
          <span className="text-zinc-100 font-medium">{role}</span>.
        </p>
        {preview.email && (
          <p className="text-[12px] text-zinc-500 mb-5">
            Sent to {preview.email}
          </p>
        )}
        {/* onClick fires synchronously BEFORE Next.js's router-handled
            navigation, so localStorage.setItem completes before /auth/signin
            (or /auth/signup) mounts. WorkspaceSelector reads + clears the
            token in its post-auth useEffect to route the user back here. */}
        {/* FB-2: conditional CTA based on recipient_has_account.
            - existing account → primary "Sign in to accept" + small
              text link to Create (rare second-account case)
            - new email → primary "Create an account" + small text
              link to Sign in (for users with an account at a
              different email who want to manually switch)
            Both primary CTAs continue to carry ?invite=<token> from
            FB-1 — preserved via signinHref / signupHref. When the
            preview RPC predates FB-2 (pre-migration apply window),
            recipient_has_account is undefined and falls back to false
            → we promote Create. That's the safer guess for fresh
            outbound invites; an existing-account recipient still has
            a one-click path to Sign in via the secondary link. */}
        {preview.recipient_has_account ? (
          <div className="space-y-3">
            <Link
              href={signinHref}
              onClick={preserveToken}
              className="btn-primary w-full justify-center"
            >
              <LogIn size={14} />
              Sign in to accept
            </Link>
            <p className="text-[12px] text-zinc-500 text-center">
              Need an account?{" "}
              <Link
                href={signupHref}
                onClick={preserveToken}
                className="text-stages-blue hover:underline font-medium"
              >
                Create one
              </Link>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Link
              href={signupHref}
              onClick={preserveToken}
              className="btn-primary w-full justify-center"
            >
              <UserPlus size={14} />
              Create an account
            </Link>
            <p className="text-[12px] text-zinc-500 text-center">
              Already have an account?{" "}
              <Link
                href={signinHref}
                onClick={preserveToken}
                className="text-stages-blue hover:underline font-medium"
              >
                Sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </AuthShell>
  );
}

// ─── Wrong account ─────────────────────────────────────────────────────────

function WrongAccountState({
  preview,
  currentEmail,
  token,
}: {
  preview: InvitePreview;
  currentEmail: string;
  token: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  /**
   * One-click "switch accounts" flow: preserve the invite token in
   * localStorage, sign out (so useSession flips to anonymous), then push
   * to /auth/signin. After the user signs in with the correct email,
   * WorkspaceSelector reads the preserved token and routes back here —
   * this time as the matching-email user. Render LoadingState during the
   * in-flight window so the intermediate PendingAnonymousState doesn't
   * briefly flash before the navigation lands.
   */
  const switchAccount = async () => {
    setSwitching(true);
    // FB-1: belt-and-suspenders — write the token to localStorage AND
    // include it in the signin URL, matching the same two-layer pattern
    // PendingState uses. If signout flips the user into another browser
    // context (rare; sign-out is local-only by default), the URL layer
    // still carries the invite through to post-auth routing.
    setPendingAcceptInvite(token);
    await supabase.auth.signOut();
    router.push(`/auth/signin?invite=${encodeURIComponent(token)}`);
  };

  if (switching) {
    return (
      <AuthShell
        title="Switching accounts…"
        subtitle="Signing you out so you can sign back in."
      >
        <div className="h-32" />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Wrong account"
      subtitle="This invite was sent to a different email address."
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-amber/10">
          <AlertCircle size={22} className="text-stages-amber" />
        </div>
        <div className="text-[12px] text-left bg-stages-card border border-stages-border rounded-lg p-3 mb-5 space-y-1">
          <div>
            <span className="text-zinc-500">Invite for:</span>{" "}
            <span className="text-zinc-200 break-all">{preview.email}</span>
          </div>
          <div>
            <span className="text-zinc-500">Signed in as:</span>{" "}
            <span className="text-zinc-200 break-all">{currentEmail}</span>
          </div>
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          Sign out and sign in as{" "}
          <span className="text-zinc-100 font-medium break-all">
            {preview.email}
          </span>{" "}
          to accept this invite.
        </p>
        <button
          type="button"
          onClick={switchAccount}
          className="btn-primary w-full justify-center"
        >
          <LogOut size={14} />
          Sign out and switch accounts
        </button>
      </div>
    </AuthShell>
  );
}

// ─── Already a member ──────────────────────────────────────────────────────

function AlreadyMemberState({ preview }: { preview: InvitePreview }) {
  return (
    <AuthShell
      title="You're already in"
      subtitle={
        preview.workspace_name
          ? `You're already a member of ${preview.workspace_name}.`
          : "You're already a member of this workspace."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-green/10">
          <Check size={22} className="text-stages-green" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          No action needed — your existing membership in{" "}
          <span className="text-zinc-100 font-medium">
            {preview.workspace_name ?? "this workspace"}
          </span>{" "}
          is still active.
        </p>
        {preview.workspace_slug ? (
          <Link
            href={`/w/${preview.workspace_slug}`}
            className="btn-primary w-full justify-center"
          >
            Open {preview.workspace_name ?? "workspace"}
          </Link>
        ) : (
          <Link
            href="/select-workspace"
            className="btn-primary w-full justify-center"
          >
            Choose a workspace
          </Link>
        )}
      </div>
    </AuthShell>
  );
}

// ─── Already in an agency (WL-3b preflight for the 1-agency cap) ──────────

/**
 * WL-3b: rendered when the actor already belongs to an agency
 * workspace and tries to accept an invite to a (different) agency.
 * The accept_workspace_invite RPC raises 23505 (WL-1 cap) as the
 * security floor; this state is purely UX so the user sees a clear
 * explanation BEFORE hitting Accept and getting a raw error.
 *
 * Names render the invited agency + the existing agency so the user
 * can identify the trade-off. No auto-decline — the user chooses
 * between staying in their current agency (do nothing here) or
 * leaving the current agency first (handled separately in workspace
 * settings; not linked from here to avoid drive-by decisions).
 */
function AlreadyInAgencyState({
  preview,
  existingAgencyName,
  existingAgencySlug,
}: {
  preview: InvitePreview;
  existingAgencyName: string;
  existingAgencySlug: string;
}) {
  const invitedName = preview.workspace_name ?? "another agency";
  return (
    <AuthShell
      title="You're already in an agency"
      subtitle="You can only belong to one agency workspace at a time."
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-amber/10">
          <AlertCircle size={22} className="text-stages-amber" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          This invite is for{" "}
          <span className="text-zinc-100 font-medium">{invitedName}</span>,
          but you&apos;re already a member of{" "}
          <span className="text-zinc-100 font-medium">
            {existingAgencyName}
          </span>
          . To accept, leave your current agency first — or just stay where
          you are.
        </p>
        <Link
          href={`/w/${existingAgencySlug}`}
          className="btn-primary w-full justify-center"
        >
          Open {existingAgencyName}
        </Link>
      </div>
    </AuthShell>
  );
}


// ─── Ready to accept ───────────────────────────────────────────────────────

function ReadyToAcceptState({
  preview,
  token,
  userId,
}: {
  preview: InvitePreview;
  token: string;
  userId: string;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviterName =
    preview.inviter_display_name || preview.inviter_email || "Someone";
  const inviterSuffix = preview.inviter_is_active_member
    ? ""
    : " (no longer in this workspace)";
  const role = preview.role ?? "member";

  /**
   * Calls accept_workspace_invite RPC. The server validates everything
   * atomically: email match (already pre-checked client-side but the RPC
   * is the real gate), single-use, expiry, already-member. On success it
   * inserts workspace_memberships + marks accepted_at in one transaction.
   *
   * After success: write last_active_workspace_id (same pattern as create-
   * workspace flow and Phase F switcher), then route to /w/[slug] where
   * AppShell mounts with the freshly-accepted workspace as active.
   */
  const accept = async () => {
    setAccepting(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc(
      "accept_workspace_invite",
      { invite_token: token },
    );

    if (rpcError) {
      setError(rpcError.message);
      setAccepting(false);
      return;
    }

    const result = data as {
      workspace_id: string;
      workspace_slug: string;
      workspace_name: string;
      role: string;
    } | null;

    if (!result?.workspace_slug || !result?.workspace_id) {
      setError(
        "Acceptance succeeded but the response was malformed. Please refresh and try again.",
      );
      setAccepting(false);
      return;
    }

    // Persist last_active so the next sign-in lands directly on the newly-
    // joined workspace. Non-fatal if it fails — same .select() + 0-row
    // check pattern as Phase F / create-workspace.
    const { error: profErr, data: profData } = await supabase
      .from("profiles")
      .update({ last_active_workspace_id: result.workspace_id })
      .eq("id", userId)
      .select();
    if (profErr) {
      console.error(
        "Failed to persist last_active_workspace_id after accept:",
        profErr.message,
      );
    } else if (!profData || profData.length === 0) {
      console.warn(
        "last_active_workspace_id update affected 0 rows after accept — RLS denial or missing profile row?",
      );
    }

    router.push(`/w/${result.workspace_slug}`);
  };

  return (
    <AuthShell
      title="Accept invitation"
      subtitle={
        preview.workspace_name
          ? `Join ${preview.workspace_name} as a ${role}.`
          : `Join the workspace as a ${role}.`
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
          <UserPlus size={22} className="text-stages-blue" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          <span className="text-zinc-100 font-medium">{inviterName}</span>
          <span className="text-zinc-500">{inviterSuffix}</span> invited you
          to{" "}
          <span className="text-zinc-100 font-medium">
            {preview.workspace_name ?? "a workspace"}
          </span>{" "}
          as a <span className="text-zinc-100 font-medium">{role}</span>.
        </p>
        {error && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2 text-left">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <button
          type="button"
          onClick={accept}
          disabled={accepting}
          className="btn-primary w-full justify-center"
        >
          <Check size={14} />
          {accepting ? "Accepting…" : "Accept invitation"}
        </button>
      </div>
    </AuthShell>
  );
}
