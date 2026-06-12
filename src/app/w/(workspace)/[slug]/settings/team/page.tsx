"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Inbox,
  Mail,
  RefreshCw,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useUserContexts, type UserContext } from "@/hooks/useUserContexts";
import {
  useTeamData,
  type TeamDataState,
  type TeamInvite,
  type TeamMember,
} from "@/hooks/useTeamData";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import { supabase } from "@/lib/supabase";
import { WorkspaceSettingsTabs } from "@/components/settings/WorkspaceSettingsTabs";

/**
 * Team settings page at /w/[slug]/settings/team.
 *
 * Permission gate: owner or admin of this workspace via workspace_memberships.
 * Member/non-member redirects to /w/[slug]. RLS enforces underneath — this
 * is the UX layer; bypassing the gate (URL manipulation, brittle redirect)
 * still yields empty queries + 4xx on the route handlers.
 *
 * Three sections, top to bottom:
 *   1. Invite form (stub in 6c-i; wires to /api/invites/send in 6c-ii)
 *   2. Pending invites table (Copy / Resend / Revoke actions all stubbed
 *      in 6c-i; wired in 6c-ii and 6c-iii)
 *   3. Members list (read-only — role changes / removal are out of scope
 *      for step 6 per the locked plan)
 *
 * AppShell wraps via /w/[slug]/layout.tsx from 6b — this page renders only
 * its own body.
 */
export default function TeamSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const slug =
    typeof params?.slug === "string" ? params.slug : null;
  const session = useSession();
  const contexts = useUserContexts();

  // Find the user's workspace-level agency membership for THIS slug. The
  // `source === "workspace"` filter is deliberate — a pipeline-level admin
  // (someone with pipeline_memberships role='admin' but no workspace row)
  // does NOT get workspace-settings access. Workspace settings require
  // workspace-level standing.
  const myContext: UserContext | null =
    contexts.status === "ready" && slug
      ? contexts.contexts.find(
          (c) =>
            c.workspaceSlug === slug &&
            c.type === "agency" &&
            c.source === "workspace" &&
            (c.role === "owner" || c.role === "admin"),
        ) ?? null
      : null;

  // Anonymous-session redirect (same pattern as WorkspaceSelector).
  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace("/auth/signin");
    }
  }, [session.status, router]);

  // No-access redirect. Fires once contexts have loaded; if the user has no
  // matching workspace-level admin/owner context for this slug, bounce to
  // /w/[slug] (the home route). The "wrong workspace" case is also handled
  // here — typing a slug you're not on bounces.
  useEffect(() => {
    if (contexts.status === "ready" && !myContext && slug) {
      router.replace(`/w/${slug}`);
    }
  }, [contexts.status, myContext, slug, router]);

  const teamData = useTeamData(myContext?.workspaceId ?? null);

  // Render a quiet placeholder during loading + during the redirect window.
  // Once contexts are ready and the user does have access, we render the
  // real page. The boolean simplifies the JSX below.
  const shouldRenderPage =
    session.status === "authenticated" &&
    contexts.status === "ready" &&
    myContext !== null;

  if (!shouldRenderPage) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-[13px] text-zinc-500">Loading…</div>
      </div>
    );
  }

  return (
    <WorkspaceSettingsTabs activeTab="team" slug={slug!}>
      <header className="mb-8">
        <p className="text-[14px] text-zinc-500">
          Manage who has access to{" "}
          <span className="text-zinc-300">{myContext.workspaceName}</span>.
        </p>
      </header>

      <section className="mb-10 panel-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={16} className="text-zinc-400" />
          <h2 className="text-[15px] font-semibold">Invite a teammate</h2>
        </div>
        <InviteForm
          workspaceId={myContext.workspaceId}
          workspaceName={myContext.workspaceName}
          viewerId={session.user.id}
          viewerName={
            (contexts.status === "ready"
              ? contexts.profile.displayName
              : null) ??
            session.user.email ??
            "Someone"
          }
          onSent={teamData.status === "ready" ? teamData.refetch : async () => {}}
        />
      </section>

      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} className="text-zinc-400" />
          <h2 className="text-[15px] font-semibold">Pending invites</h2>
          {teamData.status === "ready" && teamData.invites.length > 0 && (
            <span className="text-[12px] text-zinc-500">
              {teamData.invites.length}
            </span>
          )}
        </div>
        <PendingInvitesSection
          teamData={teamData}
          refetch={
            teamData.status === "ready" ? teamData.refetch : async () => {}
          }
        />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-[15px] font-semibold">Members</h2>
          {teamData.status === "ready" && (
            <span className="text-[12px] text-zinc-500">
              {teamData.members.length}
            </span>
          )}
        </div>
        <MembersSection teamData={teamData} />
      </section>
    </WorkspaceSettingsTabs>
  );
}

// ─── Invite form (real wiring in 6c-ii) ─────────────────────────────────────

/**
 * Practical email format check — not full RFC 5322 (out of scope per the
 * locked plan). Catches the obvious typos: missing `.tld`, leading/trailing
 * whitespace, whitespace inside, multiple @s, no local part, no domain.
 *
 *   "foo@example.com"          ✓
 *   "foo+tag@example.co.uk"    ✓
 *   "foo@example"              ✗ (no .tld)
 *   "foo @example.com"         ✗ (whitespace)
 *   "@example.com"             ✗ (no local part)
 *   "foo@.com"                 ✗ (no domain part)
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function InviteForm({
  workspaceId,
  workspaceName,
  viewerId,
  viewerName,
  onSent,
}: {
  workspaceId: string;
  workspaceName: string;
  viewerId: string;
  viewerName: string;
  onSent: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    email: string;
    acceptUrl: string;
  } | null>(null);

  const trimmed = email.trim();
  const isValidEmail = EMAIL_REGEX.test(trimmed);
  const canSubmit = isValidEmail && !submitting;
  // Only show the "doesn't look like an email" hint once the user has
  // typed an @ — before that they're clearly mid-typing and any complaint
  // would be premature. Avoids needing a separate `touched` state.
  const emailLooksInvalid =
    trimmed.length > 0 && trimmed.includes("@") && !isValidEmail;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    // Step 1: INSERT the workspace_invites row via supabase-js. RLS enforces
    // that the caller is workspace owner or admin (via
    // is_workspace_owner_or_admin in the workspace_invites_insert policy).
    // .select() so we get the generated token back for the email step.
    const insert = await supabase
      .from("workspace_invites")
      .insert({
        workspace_id: workspaceId,
        email: trimmed,
        role,
        invited_by: viewerId,
      })
      .select("token, email, role, expires_at")
      .single();

    if (insert.error || !insert.data) {
      setError(
        insert.error?.message ??
          "Failed to create the invite. Please try again.",
      );
      setSubmitting(false);
      return;
    }

    const newInvite = insert.data as {
      token: string;
      email: string;
      role: "admin" | "member";
      expires_at: string;
    };

    // Step 2: get the user's JWT to authenticate the send-email route handler.
    const sessionResult = await supabase.auth.getSession();
    const jwt = sessionResult.data.session?.access_token;
    if (!jwt) {
      // The invite IS in the DB; the email just isn't going out.
      setError(
        "Your session expired before we could send the email. The invite is created — copy the link from the pending list.",
      );
      setSubmitting(false);
      await onSent();
      return;
    }

    // Step 3: POST to /api/invites/send. The route handler verifies the JWT,
    // composes the accept URL from the request origin, and sends the email
    // (or console-logs in dev / pre-Resend state).
    let sendResponse: Response;
    try {
      sendResponse = await fetch("/api/invites/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          to: newInvite.email,
          role: newInvite.role,
          token: newInvite.token,
          workspaceName,
          inviterName: viewerName,
        }),
      });
    } catch (err) {
      setError(
        `Invite created but email request failed: ${
          err instanceof Error ? err.message : "Network error"
        }. Copy the link from the pending list and share it manually.`,
      );
      setSubmitting(false);
      await onSent();
      return;
    }

    let sendBody: { ok?: boolean; error?: string; acceptUrl?: string };
    try {
      sendBody = await sendResponse.json();
    } catch {
      sendBody = {};
    }

    if (!sendResponse.ok || !sendBody.ok) {
      setError(
        `Invite created but email failed: ${
          sendBody.error ?? "Unknown error"
        }. Copy the link from the pending list and share it manually.`,
      );
      setSubmitting(false);
      await onSent();
      return;
    }

    setSuccess({
      email: newInvite.email,
      acceptUrl: sendBody.acceptUrl ?? "",
    });
    setEmail("");
    setRole("member");
    setSubmitting(false);
    await onSent();
  };

  return (
    <div>
      <form onSubmit={submit}>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="field flex-1"
            autoComplete="off"
            disabled={submitting}
          />
          <RoleToggle value={role} onChange={setRole} disabled={submitting} />
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary justify-center sm:w-auto"
          >
            <Send size={14} />
            {submitting ? "Sending…" : "Send invite"}
          </button>
        </div>
        {emailLooksInvalid && (
          <p className="text-[12px] text-stages-amber mt-2 flex items-center gap-1.5">
            <AlertCircle size={11} className="flex-shrink-0" />
            That doesn&apos;t look like a valid email address.
          </p>
        )}
      </form>

      {error && (
        <div className="mt-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="flex-shrink-0 hover:text-stages-red/70"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {success && (
        <SuccessBanner
          email={success.email}
          acceptUrl={success.acceptUrl}
          onDismiss={() => setSuccess(null)}
        />
      )}
    </div>
  );
}

function SuccessBanner({
  email,
  acceptUrl,
  onDismiss,
}: {
  email: string;
  acceptUrl: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!acceptUrl) return;
    try {
      await navigator.clipboard.writeText(acceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers / restricted contexts. Show the URL inline as a
      // fallback so the user can copy by hand.
      window.prompt("Copy the invite link:", acceptUrl);
    }
  };

  return (
    <div className="mt-4 p-3 rounded-lg border border-stages-green/40 bg-stages-green/10 text-[13px] text-stages-green leading-snug flex items-start gap-2">
      <Check size={14} className="flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div>
          Invite sent to <span className="font-medium">{email}</span>.
        </div>
        {acceptUrl && (
          <div className="text-zinc-400 text-[12px] mt-1 truncate" title={acceptUrl}>
            {acceptUrl}
          </div>
        )}
      </div>
      {acceptUrl && (
        <button
          type="button"
          onClick={copy}
          className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] text-stages-green hover:opacity-80 transition-opacity"
          title="Copy invite link"
        >
          <Copy size={12} />
          {copied ? "Copied" : "Copy link"}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 hover:opacity-70"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function RoleToggle({
  value,
  onChange,
  disabled,
}: {
  value: "admin" | "member";
  onChange: (v: "admin" | "member") => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex flex-shrink-0"
      style={{
        background: "#1A1A1C",
        border: "1px solid #36363A",
        borderRadius: "8px",
        padding: "2px",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {(["member", "admin"] as const).map((option) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            disabled={disabled}
            className="px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors"
            style={{
              background: isActive ? "#36363A" : "transparent",
              color: isActive ? "#E4E4E7" : "#71717A",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {option === "member" ? "Member" : "Admin"}
          </button>
        );
      })}
    </div>
  );
}

// ─── Pending invites ────────────────────────────────────────────────────────

function PendingInvitesSection({
  teamData,
  refetch,
}: {
  teamData: TeamDataState;
  refetch: () => Promise<void>;
}) {
  if (teamData.status === "loading") {
    return (
      <div className="panel-card p-6 text-[13px] text-zinc-500">Loading…</div>
    );
  }
  if (teamData.status === "error") {
    return (
      <div className="panel-card p-6 flex items-start gap-2 text-[13px] text-stages-red">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>Couldn&apos;t load invites: {teamData.message}</span>
      </div>
    );
  }
  if (teamData.invites.length === 0) {
    return (
      <div className="panel-card p-8 text-center">
        <Inbox size={22} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-[14px] text-zinc-300 font-medium">
          No pending invites
        </p>
        <p className="text-[12px] text-zinc-500 mt-1">
          Use the form above to invite a teammate.
        </p>
      </div>
    );
  }
  return (
    <div className="panel-card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr
            className="text-[11px] uppercase tracking-wider text-zinc-500"
            style={{ borderBottom: "1px solid #36363A" }}
          >
            <th className="text-left px-4 py-3 font-medium">Email</th>
            <th className="text-left px-4 py-3 font-medium">Role</th>
            <th className="text-left px-4 py-3 font-medium">Invited by</th>
            <th className="text-left px-4 py-3 font-medium">Expires</th>
            <th className="text-right px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {teamData.invites.map((invite, idx) => (
            <InviteRow
              key={invite.token}
              invite={invite}
              isLast={idx === teamData.invites.length - 1}
              onRefetch={refetch}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InviteRow({
  invite,
  isLast,
  onRefetch,
}: {
  invite: TeamInvite;
  isLast: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "failed"
  >("idle");
  const [revoking, setRevoking] = useState(false);

  const isResending = resendState === "sending";
  // Disable cross-action interference. Copy stays enabled during resend
  // (different concerns — clipboard read doesn't race with email send),
  // but everything else gets locked during in-flight to prevent the user
  // from queuing conflicting operations.
  const blockMutations = isResending || revoking;

  const inviterLabel =
    invite.inviterDisplayName ||
    invite.inviterEmail ||
    "Former member";
  const expiresAt = new Date(invite.expiresAt);
  const isExpired = expiresAt.getTime() <= Date.now();

  // Composed client-side from the token. Mirrors what /api/invites/send
  // returns + what /api/invites/resend composes server-side, so the three
  // accept-URL surfaces are guaranteed to be identical for the same token.
  const acceptUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/accept-invite/${invite.token}`
      : `/accept-invite/${invite.token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(acceptUrl);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      // Older browsers / restricted contexts (no clipboard API access).
      // Fall back to a prompt so the user can still grab the link.
      window.prompt("Copy the invite link:", acceptUrl);
    }
  };

  const resend = async () => {
    setResendState("sending");
    const sessionResult = await supabase.auth.getSession();
    const jwt = sessionResult.data.session?.access_token;
    if (!jwt) {
      setResendState("failed");
      setTimeout(() => setResendState("idle"), 3000);
      return;
    }
    let response: Response;
    try {
      response = await fetch("/api/invites/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ token: invite.token }),
      });
    } catch {
      setResendState("failed");
      setTimeout(() => setResendState("idle"), 3000);
      return;
    }
    if (response.ok) {
      setResendState("sent");
      setTimeout(() => setResendState("idle"), 2000);
    } else {
      setResendState("failed");
      let errMsg = `Resend failed (${response.status})`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) errMsg = body.error;
      } catch {
        // ignore — fall through with status-coded message
      }
      // Surface the error so the user knows why. Toast UX is a future polish.
      alert(errMsg);
      setTimeout(() => setResendState("idle"), 3000);
    }
  };

  const revoke = async () => {
    if (
      !confirm(
        `Revoke the invite for ${invite.email}? The link will stop working immediately.`,
      )
    ) {
      return;
    }
    setRevoking(true);
    const { error } = await supabase
      .from("workspace_invites")
      .delete()
      .eq("token", invite.token);
    if (error) {
      setRevoking(false);
      alert(`Failed to revoke: ${error.message}`);
      return;
    }
    // Don't reset revoking — the row unmounts on the next refetch.
    await onRefetch();
  };

  return (
    <tr style={{ borderBottom: isLast ? "none" : "1px solid #2A2A2D" }}>
      <td className="px-4 py-3 text-zinc-200 truncate max-w-[200px]">
        {invite.email}
      </td>
      <td className="px-4 py-3">
        <RoleBadge role={invite.role} />
      </td>
      <td className="px-4 py-3 text-zinc-400 truncate max-w-[180px]">
        {inviterLabel}
      </td>
      <td className="px-4 py-3">
        <ExpiresCell expiresAt={expiresAt} isExpired={isExpired} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <ActionIconButton
            onClick={copy}
            disabled={revoking}
            title={copyState === "copied" ? "Copied" : "Copy invite link"}
            active={copyState === "copied" ? "success" : undefined}
          >
            {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
          </ActionIconButton>
          {!isExpired && (
            <ActionIconButton
              onClick={resend}
              disabled={blockMutations}
              title={
                isResending
                  ? "Sending…"
                  : resendState === "sent"
                  ? "Resent"
                  : resendState === "failed"
                  ? "Resend failed"
                  : "Resend email"
              }
              active={resendState === "sent" ? "success" : undefined}
            >
              {resendState === "sent" ? (
                <Check size={13} />
              ) : (
                <RefreshCw
                  size={13}
                  className={isResending ? "animate-spin" : ""}
                />
              )}
            </ActionIconButton>
          )}
          <ActionIconButton
            onClick={revoke}
            disabled={blockMutations}
            title={revoking ? "Revoking…" : "Revoke invite"}
            danger
          >
            <Trash2 size={13} />
          </ActionIconButton>
        </div>
      </td>
    </tr>
  );
}

function ExpiresCell({
  expiresAt,
  isExpired,
}: {
  expiresAt: Date;
  isExpired: boolean;
}) {
  const expiresInMs = expiresAt.getTime() - Date.now();
  const hoursLeft = expiresInMs / (1000 * 60 * 60);
  const daysLeft = hoursLeft / 24;

  let label: string;
  let color: string;
  if (isExpired) {
    label = "Expired";
    color = "text-stages-red";
  } else if (hoursLeft < 24) {
    label = `${Math.max(1, Math.round(hoursLeft))}h left`;
    color = "text-stages-amber";
  } else {
    label = `${Math.round(daysLeft)}d left`;
    color = "text-zinc-400";
  }

  return (
    <span className={`inline-flex items-center gap-1 ${color}`}>
      <Clock size={11} />
      {label}
    </span>
  );
}

function ActionIconButton({
  onClick,
  title,
  children,
  danger,
  active,
  disabled,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
  /** Locks in a non-hover appearance for transient state feedback. */
  active?: "success";
  disabled?: boolean;
}) {
  // Active states win over hover behaviour — the button locks in a fixed
  // colour so the brief "Copied" / "Resent" feedback is visible even when
  // the cursor is moving away.
  const baseColor = active === "success" ? "#15B981" : "#71717A";
  const baseBg = active === "success" ? "#15B98122" : "transparent";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="p-1.5 rounded-md transition-colors"
      style={{
        background: baseBg,
        color: baseColor,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (active || disabled) return;
        e.currentTarget.style.background = "#2A2A2D";
        e.currentTarget.style.color = danger ? "#F43F5E" : "#E4E4E7";
      }}
      onMouseLeave={(e) => {
        if (active || disabled) return;
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "#71717A";
      }}
    >
      {children}
    </button>
  );
}

// ─── Members ────────────────────────────────────────────────────────────────

function MembersSection({ teamData }: { teamData: TeamDataState }) {
  if (teamData.status === "loading") {
    return (
      <div className="panel-card p-6 text-[13px] text-zinc-500">Loading…</div>
    );
  }
  if (teamData.status === "error") {
    return (
      <div className="panel-card p-6 flex items-start gap-2 text-[13px] text-stages-red">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>Couldn&apos;t load members: {teamData.message}</span>
      </div>
    );
  }
  return (
    <div className="panel-card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead>
          <tr
            className="text-[11px] uppercase tracking-wider text-zinc-500"
            style={{ borderBottom: "1px solid #36363A" }}
          >
            <th className="text-left px-4 py-3 font-medium" colSpan={2}>
              Member
            </th>
            <th className="text-right px-4 py-3 font-medium">Role</th>
          </tr>
        </thead>
        <tbody>
          {teamData.members.map((m, idx) => (
            <MemberRow
              key={m.userId}
              member={m}
              isLast={idx === teamData.members.length - 1}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberRow({ member, isLast }: { member: TeamMember; isLast: boolean }) {
  const label = member.displayName || member.email;
  return (
    <tr style={{ borderBottom: isLast ? "none" : "1px solid #2A2A2D" }}>
      <td className="px-4 py-3" style={{ width: "44px" }}>
        <MemberAvatar
          userId={member.userId}
          email={member.email}
          displayName={member.displayName}
          avatarUrl={member.avatarUrl}
          size={32}
        />
      </td>
      <td className="px-4 py-3">
        <div className="text-zinc-200 truncate max-w-[280px]">{label}</div>
        {member.displayName && (
          <div className="text-[12px] text-zinc-500 truncate max-w-[280px]">
            {member.email}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <RoleBadge role={member.role} />
      </td>
    </tr>
  );
}

/**
 * PI-followup-1: color derivation centralized via getAvatarColorFromUserId
 * (hashes user.id, matches every other avatar surface). 2px ring around
 * photos + initials removed for flat consistency across surfaces.
 */
function MemberAvatar({
  userId,
  email,
  displayName,
  avatarUrl,
  size,
}: {
  userId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  size: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const { text, bg } = getAvatarColorFromUserId(userId);
  const initial = resolveInitial({ display_name: displayName, email });

  if (avatarUrl && !imgFailed) {
    return (
      <Image
        src={avatarUrl}
        alt={email}
        width={size}
        height={size}
        unoptimized
        onError={() => setImgFailed(true)}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "8px",
          objectFit: "cover",
          display: "block",
        }}
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center font-semibold"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background: bg,
        color: text,
        borderRadius: "8px",
        fontSize: "13px",
      }}
    >
      {initial}
    </div>
  );
}

// ─── Role badge ─────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const styles: Record<"owner" | "admin" | "member", string> = {
    owner: "text-stages-blue",
    admin: "text-stages-purple",
    member: "text-zinc-400",
  };
  return (
    <span
      className={`text-[11px] font-medium uppercase tracking-wider ${styles[role]}`}
    >
      {role}
    </span>
  );
}
