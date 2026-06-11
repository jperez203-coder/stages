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
  Mail,
  User,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/lib/supabase";

/**
 * /portal/accept/[token] — landing page for CLIENT invite links.
 *
 * Mirrors /accept-invite/[token] in shape but with three locked differences:
 *   1. Anonymous-state UX is a single "email me a sign-in link" button
 *      (preview.email is read-only) — NO sign-in / sign-up choice. Clients
 *      don't have password accounts. signInWithOtp sends a Supabase magic
 *      link; clicking it brings them back here authenticated.
 *   2. Accept routes to /portal/[pipeline_id] (not /w/[slug]). Portal
 *      destination is an internal stub for now; real client portal lands
 *      in Phase 4.
 *   3. Calls accept_client_invite (not accept_workspace_invite). Inserts
 *      a pipeline_memberships row with role='client'.
 *
 * Eight states + a loading/error pair (total 10):
 *   * Loading — preview fetch or session loading
 *   * Fetch error — preview RPC errored
 *   * Not found — token doesn't resolve
 *   * Expired — past expires_at
 *   * Accepted — single-use already exercised
 *   * Pending + anonymous — request magic link form
 *   * Pending + magic-link-sent — confirmation, check inbox
 *   * Pending + authenticated + wrong email — switch accounts
 *   * Pending + authenticated + already a pipeline member — info state
 *   * Pending + authenticated + email matches + not a member — Accept button
 *
 * Outside the /w/[slug]/* tree, so no AppShell — every state renders in
 * AuthShell (same chrome as auth pages).
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ClientInvitePreview = {
  status: "pending" | "expired" | "accepted" | "not_found";
  pipeline_id?: string;
  pipeline_name?: string;
  workspace_name?: string;
  workspace_slug?: string;
  email?: string;
  inviter_display_name?: string | null;
  inviter_email?: string | null;
  inviter_is_active_pipeline_member?: boolean;
  expires_at?: string;
  accepted_at?: string | null;
  /** PI-2: invite role returned by get_client_invite_preview. PI-5b
   *  uses this to branch the pre-accept UI (headline / body / CTA
   *  copy) and the post-accept routing target. Optional + defaults to
   *  'client' for resilience — pre-PI-2 RPC versions and pre-PI-1
   *  invites (where the column default 'client' applies) both
   *  collapse to the existing client-side behavior. */
  role?: "admin" | "member" | "client";
};

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "fetched"; preview: ClientInvitePreview };

export default function PortalAcceptPage() {
  const params = useParams();
  const session = useSession();
  const token =
    typeof params?.token === "string" ? params.token : null;
  const isValidToken = !!token && UUID_REGEX.test(token);

  const [previewState, setPreviewState] = useState<PreviewState>({
    status: "loading",
  });

  useEffect(() => {
    if (!isValidToken || !token) {
      setPreviewState({
        status: "fetched",
        preview: { status: "not_found" },
      });
      return;
    }
    let active = true;
    void (async () => {
      const { data, error } = await supabase.rpc(
        "get_client_invite_preview",
        { invite_token: token },
      );
      if (!active) return;
      if (error) {
        setPreviewState({ status: "error", message: error.message });
        return;
      }
      setPreviewState({
        status: "fetched",
        preview: (data ?? { status: "not_found" }) as ClientInvitePreview,
      });
    })();
    return () => {
      active = false;
    };
  }, [token, isValidToken]);

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

  if (preview.status === "not_found") return <NotFoundState />;
  if (preview.status === "expired") return <ExpiredState preview={preview} />;
  if (preview.status === "accepted") return <AcceptedState preview={preview} />;

  // preview.status === "pending"
  if (session.status === "anonymous") {
    return <PendingAnonymousState preview={preview} token={token ?? ""} />;
  }

  // Authenticated. Three sub-branches.
  return (
    <PendingAuthenticatedBranch
      preview={preview}
      token={token ?? ""}
      currentUserId={session.user.id}
      currentEmail={session.user.email ?? ""}
    />
  );
}

// ─── Loading + fetch error ──────────────────────────────────────────────────

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

// ─── Status states ──────────────────────────────────────────────────────────

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
      </div>
    </AuthShell>
  );
}

function ExpiredState({ preview }: { preview: ClientInvitePreview }) {
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
        preview.pipeline_name
          ? `Your invite to ${preview.pipeline_name} has expired.`
          : "This invite has expired."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-amber/10">
          <Clock size={22} className="text-stages-amber" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          <span className="text-zinc-100 font-medium">{inviterName}</span>{" "}
          invited you to view{" "}
          <span className="text-zinc-100 font-medium">
            {preview.pipeline_name ?? "a project"}
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
      </div>
    </AuthShell>
  );
}

function AcceptedState({ preview }: { preview: ClientInvitePreview }) {
  return (
    <AuthShell
      title="Already accepted"
      subtitle={
        preview.pipeline_name
          ? `You've already accepted access to ${preview.pipeline_name}.`
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
            {preview.pipeline_name ?? "your project"}
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

// ─── Pending + anonymous (magic-link request form) ──────────────────────────

function PendingAnonymousState({
  preview,
  token,
}: {
  preview: ClientInvitePreview;
  token: string;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inviterName =
    preview.inviter_display_name || preview.inviter_email || "Someone";
  const inviterSuffix = preview.inviter_is_active_pipeline_member
    ? ""
    : " (no longer on this project)";

  const sendMagicLink = async () => {
    if (!preview.email) return;
    setSending(true);
    setError(null);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: preview.email,
      options: {
        // Land them back here so they can hit the authenticated branch.
        emailRedirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/portal/accept/${token}`
            : undefined,
      },
    });
    setSending(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="We sent you a sign-in link."
      >
        <div className="text-center">
          <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
            <Mail size={22} className="text-stages-blue" />
          </div>
          <p className="text-[13px] text-zinc-300 mb-1 leading-relaxed">
            We sent a sign-in link to{" "}
            <span className="text-zinc-100 font-medium break-all">
              {preview.email}
            </span>
            .
          </p>
          <p className="text-[12px] text-zinc-500 mb-5 leading-relaxed">
            Click the link in that email to sign in and finish accepting your
            invite to {preview.pipeline_name}.
          </p>
          <button
            onClick={() => {
              setSent(false);
              setError(null);
            }}
            className="btn-ghost w-full justify-center"
          >
            Resend the link
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="You're invited"
      subtitle={
        preview.workspace_name
          ? `From ${preview.workspace_name} on Stages.`
          : "Sign in to view your project."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
          <UserPlus size={22} className="text-stages-blue" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          <span className="text-zinc-100 font-medium">{inviterName}</span>
          <span className="text-zinc-500">{inviterSuffix}</span> invited you to
          view{" "}
          <span className="text-zinc-100 font-medium">
            {preview.pipeline_name ?? "a project"}
          </span>
          .
        </p>

        {/* Email is read-only — the invite is for a specific address; letting
            the user type a different one would just send them down a path
            that ends in the WrongAccountState. Cleaner to show it here so
            they know which inbox to check. */}
        <div className="mb-5 text-left">
          <label className="block text-[12px] text-zinc-500 mb-1.5">
            We&apos;ll email you a sign-in link at:
          </label>
          <input
            type="email"
            value={preview.email ?? ""}
            readOnly
            className="field"
            style={{ background: "#161618", cursor: "not-allowed" }}
          />
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={sendMagicLink}
          disabled={sending || !preview.email}
          className="btn-primary w-full justify-center"
        >
          <Mail size={14} />
          {sending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </div>
    </AuthShell>
  );
}

// ─── Pending + authenticated branch ─────────────────────────────────────────

function PendingAuthenticatedBranch({
  preview,
  token,
  currentUserId,
  currentEmail,
}: {
  preview: ClientInvitePreview;
  token: string;
  currentUserId: string;
  currentEmail: string;
}) {
  const emailMatches =
    !!preview.email &&
    preview.email.trim().toLowerCase() === currentEmail.trim().toLowerCase();

  // Check whether the authenticated user already has ANY pipeline_memberships
  // row for this pipeline (could be agency-side OR client — schema PK
  // disallows both for the same user). Done as a quick SELECT against
  // pipeline_memberships filtered to the caller; RLS lets them see their
  // own membership row via the existing pipeline_memberships_select policy
  // ("or user_id = (select auth.uid())").
  const [membershipChecked, setMembershipChecked] = useState(false);
  const [alreadyMember, setAlreadyMember] = useState(false);

  useEffect(() => {
    if (!preview.pipeline_id) {
      setMembershipChecked(true);
      return;
    }
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("pipeline_memberships")
        .select("role")
        .eq("pipeline_id", preview.pipeline_id)
        .eq("user_id", currentUserId)
        .maybeSingle();
      if (!active) return;
      setAlreadyMember(!!data);
      setMembershipChecked(true);
    })();
    return () => {
      active = false;
    };
  }, [preview.pipeline_id, currentUserId]);

  if (!emailMatches) {
    return <WrongAccountState preview={preview} currentEmail={currentEmail} />;
  }

  if (!membershipChecked) {
    return <LoadingState />;
  }

  if (alreadyMember) {
    return <AlreadyMemberState preview={preview} />;
  }

  return (
    <ReadyToAcceptState
      preview={preview}
      token={token}
      currentUserId={currentUserId}
    />
  );
}

// ─── Wrong account ──────────────────────────────────────────────────────────

function WrongAccountState({
  preview,
  currentEmail,
}: {
  preview: ClientInvitePreview;
  currentEmail: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const switchAccount = async () => {
    setSwitching(true);
    await supabase.auth.signOut();
    // Land them back on the same accept page (now anonymous) so they can
    // request a sign-in link for the right email.
    router.refresh();
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
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          You&apos;re signed in as{" "}
          <span className="text-zinc-100 font-medium break-all">
            {currentEmail}
          </span>
          , but this invite was sent to{" "}
          <span className="text-zinc-100 font-medium break-all">
            {preview.email}
          </span>
          . Sign out and request a sign-in link for the right address.
        </p>
        <button
          onClick={switchAccount}
          className="btn-primary w-full justify-center"
        >
          <LogOut size={14} />
          Sign out and switch
        </button>
      </div>
    </AuthShell>
  );
}

// ─── Already member ─────────────────────────────────────────────────────────

function AlreadyMemberState({ preview }: { preview: ClientInvitePreview }) {
  const destination = preview.pipeline_id
    ? `/portal/${preview.pipeline_id}`
    : "/";

  return (
    <AuthShell
      title="Already on this project"
      subtitle={
        preview.pipeline_name
          ? `You already have access to ${preview.pipeline_name}.`
          : "You already have access to this project."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-green/10">
          <UserCheck size={22} className="text-stages-green" />
        </div>
        <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
          You already have access to{" "}
          <span className="text-zinc-100 font-medium">
            {preview.pipeline_name ?? "this project"}
          </span>
          . No need to accept this invite again.
        </p>
        <Link href={destination} className="btn-primary w-full justify-center">
          Open project
        </Link>
      </div>
    </AuthShell>
  );
}

// ─── Ready to accept ────────────────────────────────────────────────────────

function ReadyToAcceptState({
  preview,
  token,
  currentUserId,
}: {
  preview: ClientInvitePreview;
  token: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Full name capture. Pre-filled from the user's existing
  // profiles.display_name if they already had one (e.g., signed up
  // through agency signup previously, or accepted another client
  // invite already). Still required — they can edit or accept as-is,
  // but can't leave it blank.
  const [fullName, setFullName] = useState("");
  const [nameLoaded, setNameLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", currentUserId)
        .maybeSingle();
      if (!active) return;
      setFullName(((data?.display_name as string | null) ?? "").trim());
      setNameLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [currentUserId]);

  const trimmedName = fullName.trim();
  const canAccept = nameLoaded && trimmedName.length > 0 && !accepting;

  const accept = async () => {
    if (!canAccept) {
      if (trimmedName.length === 0) {
        setError("Please enter your full name.");
      }
      return;
    }
    setAccepting(true);
    setError(null);
    // Write the profile's display_name BEFORE accepting the invite.
    // The accept_client_invite RPC reads display_name to write the
    // activity_events.actor_name snapshot ("X joined the project"),
    // so the name being in place first ensures the activity feed
    // shows the real name on the very first event — not a fallback
    // like "unknown" that we'd then have to live with forever in the
    // append-only activity log.
    const { error: profileErr } = await supabase
      .from("profiles")
      .update({ display_name: trimmedName })
      .eq("id", currentUserId);
    if (profileErr) {
      setError(
        `Couldn't save your name (${profileErr.message}). Please try again.`,
      );
      setAccepting(false);
      return;
    }
    const { data, error: rpcError } = await supabase.rpc(
      "accept_client_invite",
      { invite_token: token },
    );
    if (rpcError) {
      setError(rpcError.message);
      setAccepting(false);
      return;
    }
    const result = (data ?? null) as {
      pipeline_id?: string;
      workspace_slug?: string;
      role?: "admin" | "member" | "client";
    } | null;
    if (!result?.pipeline_id) {
      setError("Accept succeeded but the response was malformed. Refresh.");
      setAccepting(false);
      return;
    }
    // PI-5b: branch on the role the RPC echoed back. Client → portal
    // (unchanged behavior). Member / admin → agency canvas at
    // /w/{workspace_slug}/p/{pipeline_id}, which PI-5a widened the
    // route gate to accept pipeline-only memberships for.
    const acceptedRole = result.role ?? "client";
    if (acceptedRole === "client") {
      router.push(`/portal/${result.pipeline_id}`);
    } else {
      if (!result.workspace_slug) {
        setError(
          "Accept succeeded but the response was missing workspace_slug. Refresh and try again.",
        );
        setAccepting(false);
        return;
      }
      router.push(`/w/${result.workspace_slug}/p/${result.pipeline_id}`);
    }
  };

  const inviterName =
    preview.inviter_display_name || preview.inviter_email || "Someone";
  const inviterSuffix = preview.inviter_is_active_pipeline_member
    ? ""
    : " (no longer on this project)";

  // PI-5b: per-variant pre-accept copy. Role defaults to 'client' so
  // pre-PI-2 RPC versions (which don't return role in the preview)
  // produce the existing client-side UI bit-for-bit.
  const role = preview.role ?? "client";
  const isClient = role === "client";
  const isAdmin = role === "admin";

  const headline = isClient
    ? "Accept invitation"
    : isAdmin
      ? "You've been invited as an admin"
      : "You've been invited to join the team";

  const acceptButtonLabel = isClient ? "Accept invitation" : "Accept and join";

  return (
    <AuthShell
      title={headline}
      subtitle={
        preview.workspace_name
          ? `From ${preview.workspace_name} on Stages.`
          : "Confirm your access to the project."
      }
    >
      <div className="text-center">
        <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
          <UserPlus size={22} className="text-stages-blue" />
        </div>
        {isClient ? (
          <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
            <span className="text-zinc-100 font-medium">{inviterName}</span>
            <span className="text-zinc-500">{inviterSuffix}</span> invited
            you to view{" "}
            <span className="text-zinc-100 font-medium">
              {preview.pipeline_name ?? "a project"}
            </span>
            .
          </p>
        ) : (
          // PI-5b: workspace-centric framing for member / admin variants.
          // Drops the pipeline-name and "(no longer on this project)"
          // suffix per locked strategy copy.
          <p className="text-[13px] text-zinc-300 mb-5 leading-relaxed">
            <span className="text-zinc-100 font-medium">{inviterName}</span>{" "}
            from{" "}
            <span className="text-zinc-100 font-medium">
              {preview.workspace_name ?? "a workspace"}
            </span>{" "}
            invited you to join {isAdmin ? "as an admin" : "their team"} on
            Stages.
          </p>
        )}

        {/* Full name — required. Pre-filled from existing display_name
            when set, so a returning user (second invite) doesn't have
            to re-type. Disabled until the initial fetch completes so
            we don't show an empty box that then jumps to the name. */}
        <div className="text-left mb-4">
          <label className="block mb-1.5">
            <span className="text-[13px] text-zinc-400">Your full name</span>
          </label>
          <div className="relative">
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
              disabled={accepting || !nameLoaded}
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button
          onClick={accept}
          disabled={!canAccept}
          className="btn-primary w-full justify-center"
        >
          <Check size={14} />
          {accepting ? "Accepting…" : acceptButtonLabel}
        </button>
      </div>
    </AuthShell>
  );
}
