"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Clock,
  Copy,
  Inbox,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import {
  usePipelineMembersData,
  type PipelineAddableMember,
  type PipelineMemberInvite,
  type PipelineMember,
  type PipelineMembersDataState,
} from "@/hooks/usePipelineMembersData";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import { supabase } from "@/lib/supabase";

/**
 * PI-followup-1: Members sub-tab body. Reworked from the PI-6 email-
 * invite form into a PICKER ONLY surface — the only path to add a team
 * member to a pipeline now is "pick from existing workspace seats."
 *
 * Why: PI-6's email form let agency owners invite "members" without
 * creating workspace_memberships rows, which are what the seat-sync
 * cron counts. That bypassed Team-plan per-seat pricing. The fix is
 * structural: members exist as workspace seats first, then get scoped
 * to specific pipelines via the picker.
 *
 * Sections (top to bottom):
 *   1. "Add from your team" picker — workspace_memberships minus
 *      existing pipeline_memberships. Searchable. Click to add via
 *      /api/pipeline-memberships/add.
 *   2. Pending invites — defensively rendered for any pre-followup
 *      member-role invites still in the DB. No new ones can be created
 *      (API hard-rejects role='member' / 'admin' at /api/client-invites/
 *      send).
 *   3. Current members roster — admin + member rows with role badge.
 *
 * Avatars: getAvatarColorFromUserId hashes user_id stably (cross-surface
 * color consistency), no ring/border per the PI-followup-1 polish lock.
 */

export function MembersBody() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params?.slug === "string" ? params.slug : null;
  const pipelineId =
    typeof (params as Record<string, unknown>)?.["pipeline-id"] === "string"
      ? ((params as Record<string, unknown>)["pipeline-id"] as string)
      : null;

  const session = useSession();
  const contexts = useUserContexts();

  const canEdit =
    contexts.status === "ready" && slug && pipelineId
      ? contexts.contexts.some(
          (c) =>
            (c.source === "workspace" &&
              c.workspaceSlug === slug &&
              (c.role === "owner" || c.role === "admin")) ||
            (c.source === "pipeline" &&
              c.pipelineId === pipelineId &&
              (c.role === "owner" || c.role === "admin")),
        )
      : false;

  useEffect(() => {
    if (session.status === "anonymous") {
      router.replace("/auth/signin");
    }
  }, [session.status, router]);

  useEffect(() => {
    if (contexts.status === "ready" && !canEdit && slug) {
      router.replace(`/w/${slug}`);
    }
  }, [contexts.status, canEdit, slug, router]);

  // WT-5 defensive client-side personal-workspace redirect.
  useEffect(() => {
    if (contexts.status !== "ready" || !slug || !pipelineId) return;
    const ctx = contexts.contexts.find(
      (c) => c.type === "agency" && c.workspaceSlug === slug,
    );
    if (ctx?.workspaceType === "personal") {
      router.replace(`/w/${slug}/p/${pipelineId}`);
    }
  }, [contexts, slug, pipelineId, router]);

  const data = usePipelineMembersData(canEdit ? pipelineId : null);

  const shouldRender =
    session.status === "authenticated" &&
    contexts.status === "ready" &&
    canEdit;

  if (!shouldRender) {
    return (
      <div className="text-[13px] text-zinc-500 py-8 text-center">Loading…</div>
    );
  }

  return (
    <div>
      <section className="mb-10 panel-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={16} className="text-zinc-400" />
          <h2 className="text-[15px] font-semibold">Add from your team</h2>
        </div>
        <AddFromTeamPicker
          pipelineId={pipelineId ?? ""}
          workspaceSlug={slug ?? ""}
          data={data}
          onAdded={data.status === "ready" ? data.refetch : async () => {}}
        />
      </section>

      {/* Defensive render for any pre-PI-followup-1 member-role invites
          still sitting in the DB. No new ones can be created. Section
          hides itself when there are zero pending — strategy direction. */}
      {data.status === "ready" && data.invites.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <Mail size={16} className="text-zinc-400" />
            <h2 className="text-[15px] font-semibold">Pending invites</h2>
            <span className="text-[12px] text-zinc-500">
              {data.invites.length}
            </span>
          </div>
          <PendingMemberInvitesSection
            data={data}
            refetch={data.status === "ready" ? data.refetch : async () => {}}
          />
        </section>
      )}

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-zinc-400" />
          <h2 className="text-[15px] font-semibold">Current members</h2>
          {data.status === "ready" && (
            <span className="text-[12px] text-zinc-500">
              {data.members.length}
            </span>
          )}
        </div>
        <MembersSection
          data={data}
          pipelineId={pipelineId ?? ""}
          actorUserId={
            session.status === "authenticated" ? session.user.id : null
          }
          onRemoved={data.status === "ready" ? data.refetch : async () => {}}
        />
      </section>
    </div>
  );
}

// ─── Add-from-team picker ───────────────────────────────────────────────────

function AddFromTeamPicker({
  pipelineId,
  workspaceSlug,
  data,
  onAdded,
}: {
  pipelineId: string;
  workspaceSlug: string;
  data: PipelineMembersDataState;
  onAdded: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addable = data.status === "ready" ? data.addable : [];

  // Show search input once the list is long enough to warrant filtering.
  const showSearch = addable.length > 5;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return addable;
    return addable.filter((m) => {
      const name = (m.displayName ?? "").toLowerCase();
      const email = m.email.toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [addable, query]);

  const add = async (userId: string) => {
    setPendingUserId(userId);
    setError(null);

    const sessionResult = await supabase.auth.getSession();
    const jwt = sessionResult.data.session?.access_token;
    if (!jwt) {
      setError("Your session expired. Sign in again.");
      setPendingUserId(null);
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/pipeline-memberships/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          pipeline_id: pipelineId,
          user_id: userId,
          role: "member",
        }),
      });
    } catch {
      setError("Network error. Try again.");
      setPendingUserId(null);
      return;
    }

    let body: { ok?: boolean; error?: string; message?: string };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      setError(`Request failed (${response.status})`);
      setPendingUserId(null);
      return;
    }

    if (!response.ok || !body.ok) {
      setError(body.message || body.error || `Request failed (${response.status})`);
      setPendingUserId(null);
      return;
    }

    setPendingUserId(null);
    await onAdded();
  };

  if (data.status === "loading") {
    return <div className="text-[13px] text-zinc-500">Loading…</div>;
  }
  if (data.status === "error") {
    return (
      <div className="flex items-start gap-2 text-[13px] text-stages-red">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>Couldn&apos;t load your team: {data.message}</span>
      </div>
    );
  }

  if (addable.length === 0) {
    return (
      <div className="text-center py-6">
        <Users size={22} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-[14px] text-zinc-300 font-medium">
          Everyone on your team is already on this pipeline.
        </p>
        <p className="text-[12px] text-zinc-500 mt-1 leading-relaxed">
          To invite new teammates, go to{" "}
          <a
            href={`/w/${encodeURIComponent(workspaceSlug)}/settings/team`}
            className="text-stages-blue hover:underline"
          >
            Workspace Settings → Team
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      {showSearch && (
        <div className="relative mb-4">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            className="field w-full"
            style={{ paddingLeft: "36px" }}
          />
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-[13px] text-zinc-500 py-4 text-center">
          No teammates match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <ul className="space-y-1">
          {filtered.map((m) => (
            <AddablePersonRow
              key={m.userId}
              member={m}
              pending={pendingUserId === m.userId}
              disabled={pendingUserId !== null && pendingUserId !== m.userId}
              onAdd={() => add(m.userId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AddablePersonRow({
  member,
  pending,
  disabled,
  onAdd,
}: {
  member: PipelineAddableMember;
  pending: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  const label = member.displayName || member.email;
  return (
    <li
      className="flex items-center gap-3 p-2 rounded-lg transition-colors"
      style={{
        background: "transparent",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !pending) e.currentTarget.style.background = "#1F1F22";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <PersonAvatar
        userId={member.userId}
        displayName={member.displayName}
        email={member.email}
        avatarUrl={member.avatarUrl}
        size={32}
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-zinc-200 truncate">{label}</div>
        {member.displayName && (
          <div className="text-[12px] text-zinc-500 truncate">
            {member.email}
          </div>
        )}
      </div>
      <span
        className={`text-[11px] font-medium uppercase tracking-wider ${
          member.workspaceRole === "owner"
            ? "text-stages-blue"
            : member.workspaceRole === "admin"
              ? "text-stages-purple"
              : "text-zinc-500"
        }`}
      >
        {member.workspaceRole}
      </span>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled || pending}
        className="btn-primary inline-flex"
        style={{
          padding: "6px 12px",
          fontSize: "12px",
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <Plus size={12} />
        {pending ? "Adding…" : "Add"}
      </button>
    </li>
  );
}

// ─── Pending invites (defensive — no new ones created post-PI-followup-1) ──

function PendingMemberInvitesSection({
  data,
  refetch,
}: {
  data: PipelineMembersDataState;
  refetch: () => Promise<void>;
}) {
  if (data.status !== "ready") return null;
  if (data.invites.length === 0) {
    return (
      <div className="panel-card p-8 text-center">
        <Inbox size={22} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-[14px] text-zinc-300 font-medium">
          No pending invites
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
            <th className="text-left px-4 py-3 font-medium">Invited by</th>
            <th className="text-left px-4 py-3 font-medium">Expires</th>
            <th className="text-right px-4 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.invites.map((invite, idx) => (
            <MemberInviteRow
              key={invite.token}
              invite={invite}
              isLast={idx === data.invites.length - 1}
              onRefetch={refetch}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemberInviteRow({
  invite,
  isLast,
  onRefetch,
}: {
  invite: PipelineMemberInvite;
  isLast: boolean;
  onRefetch: () => Promise<void>;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [resendState, setResendState] = useState<
    "idle" | "sending" | "sent" | "failed"
  >("idle");
  const [revoking, setRevoking] = useState(false);

  const isResending = resendState === "sending";
  const blockMutations = isResending || revoking;

  const inviterLabel =
    invite.inviterDisplayName || invite.inviterEmail || "Former member";
  const expiresAt = new Date(invite.expiresAt);
  const isExpired = expiresAt.getTime() <= Date.now();

  const acceptUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/portal/accept/${invite.token}`
      : `/portal/accept/${invite.token}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(acceptUrl);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
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
      response = await fetch("/api/client-invites/resend", {
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
        // status-coded message is sufficient
      }
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
      .from("client_invites")
      .delete()
      .eq("token", invite.token);
    if (error) {
      setRevoking(false);
      alert(`Failed to revoke: ${error.message}`);
      return;
    }
    await onRefetch();
  };

  return (
    <tr style={{ borderBottom: isLast ? "none" : "1px solid #2A2A2D" }}>
      <td className="px-4 py-3 text-zinc-200 truncate max-w-[220px]">
        {invite.email}
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

// ─── Members roster ─────────────────────────────────────────────────────────

function MembersSection({
  data,
  pipelineId,
  actorUserId,
  onRemoved,
}: {
  data: PipelineMembersDataState;
  pipelineId: string;
  actorUserId: string | null;
  onRemoved: () => Promise<void>;
}) {
  // Confirm modal state lives at the section level so a single instance
  // renders, avoiding row-level z-index / portal complications.
  const [confirmTarget, setConfirmTarget] = useState<PipelineMember | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const closeConfirm = () => {
    setConfirmTarget(null);
    setRemoveError(null);
    setRemoving(false);
  };

  const confirmRemove = async () => {
    if (!confirmTarget) return;
    setRemoving(true);
    setRemoveError(null);

    const sessionResult = await supabase.auth.getSession();
    const jwt = sessionResult.data.session?.access_token;
    if (!jwt) {
      setRemoveError("Your session expired. Sign in again.");
      setRemoving(false);
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/pipeline-memberships/remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          pipeline_id: pipelineId,
          target_user_id: confirmTarget.userId,
        }),
      });
    } catch {
      setRemoveError("Network error. Try again.");
      setRemoving(false);
      return;
    }

    let body: { ok?: boolean; error?: string; message?: string };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      setRemoveError(`Request failed (${response.status})`);
      setRemoving(false);
      return;
    }

    if (!response.ok || !body.ok) {
      setRemoveError(
        body.message || body.error || `Request failed (${response.status})`,
      );
      setRemoving(false);
      return;
    }

    closeConfirm();
    await onRemoved();
  };

  if (data.status === "loading") {
    return (
      <div className="panel-card p-6 text-[13px] text-zinc-500">Loading…</div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="panel-card p-6 flex items-start gap-2 text-[13px] text-stages-red">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>Couldn&apos;t load members: {data.message}</span>
      </div>
    );
  }
  if (data.members.length === 0) {
    return (
      <div className="panel-card p-8 text-center">
        <Users size={22} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-[14px] text-zinc-300 font-medium">No members yet</p>
        <p className="text-[12px] text-zinc-500 mt-1">
          Use the picker above to add teammates from your workspace.
        </p>
      </div>
    );
  }
  return (
    <>
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
              {/* Empty header above the remove-X column — kept narrow + unlabeled. */}
              <th
                className="px-4 py-3"
                style={{ width: "40px" }}
                aria-hidden="true"
              />
            </tr>
          </thead>
          <tbody>
            {data.members.map((m, idx) => (
              <MemberRow
                key={m.userId}
                member={m}
                isLast={idx === data.members.length - 1}
                isSelf={actorUserId !== null && m.userId === actorUserId}
                onRequestRemove={() => setConfirmTarget(m)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {confirmTarget && (
        <RemoveMemberConfirm
          member={confirmTarget}
          removing={removing}
          error={removeError}
          onCancel={closeConfirm}
          onConfirm={confirmRemove}
        />
      )}
    </>
  );
}

function MemberRow({
  member,
  isLast,
  isSelf,
  onRequestRemove,
}: {
  member: PipelineMember;
  isLast: boolean;
  isSelf: boolean;
  onRequestRemove: () => void;
}) {
  const label = member.displayName || member.email;
  // Row-scoped hover so the X reveals only on this row. Local state is
  // simpler than CSS group-hover when we also need to gate the cursor
  // shape on isSelf.
  const [hover, setHover] = useState(false);

  // PipelineMember.role is already filtered to admin|member by the hook
  // (owners are excluded at the query level), but render the X defensively
  // only when the row is NOT the actor. Owner protection is enforced at
  // the API layer in any case.
  const showRemove = !isSelf;

  return (
    <tr
      style={{ borderBottom: isLast ? "none" : "1px solid #2A2A2D" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td className="px-4 py-3" style={{ width: "44px" }}>
        <PersonAvatar
          userId={member.userId}
          displayName={member.displayName}
          email={member.email}
          avatarUrl={member.avatarUrl}
          size={32}
        />
      </td>
      <td className="px-4 py-3">
        <div className="text-zinc-200 truncate max-w-[320px]">{label}</div>
        {member.displayName && (
          <div className="text-[12px] text-zinc-500 truncate max-w-[320px]">
            {member.email}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <RoleBadge role={member.role} />
      </td>
      <td className="px-4 py-3" style={{ width: "40px" }}>
        {showRemove && (
          <button
            type="button"
            onClick={onRequestRemove}
            title={`Remove ${label} from this pipeline`}
            aria-label={`Remove ${label} from this pipeline`}
            className="p-1.5 rounded-md transition-opacity transition-colors"
            style={{
              opacity: hover ? 1 : 0,
              color: "#71717A",
              background: "transparent",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#2A2A2D";
              e.currentTarget.style.color = "#F472B6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#71717A";
            }}
          >
            <X size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

function RemoveMemberConfirm({
  member,
  removing,
  error,
  onCancel,
  onConfirm,
}: {
  member: PipelineMember;
  removing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = member.displayName || member.email;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !removing) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-member-title"
    >
      <div
        className="panel-card p-6 w-full"
        style={{ maxWidth: "420px" }}
      >
        <h3
          id="remove-member-title"
          className="text-[16px] font-semibold text-zinc-100 mb-2"
        >
          Remove {label} from this pipeline?
        </h3>
        <p className="text-[13px] text-zinc-400 leading-relaxed mb-5">
          They&apos;ll lose access to this pipeline immediately. Their
          workspace seat and any content they&apos;ve already created stay
          in place.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-stages-red/40 bg-stages-red/10 text-[13px] text-stages-red leading-snug flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={removing}
            className="btn-ghost"
            style={{
              padding: "8px 14px",
              fontSize: "13px",
              opacity: removing ? 0.5 : 1,
              cursor: removing ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={removing}
            className="inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors"
            style={{
              padding: "8px 14px",
              fontSize: "13px",
              background: "#F43F5E",
              color: "#FFFFFF",
              opacity: removing ? 0.7 : 1,
              cursor: removing ? "not-allowed" : "pointer",
            }}
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: "admin" | "member" }) {
  const color = role === "admin" ? "text-stages-purple" : "text-zinc-400";
  return (
    <span
      className={`text-[11px] font-medium uppercase tracking-wider ${color}`}
    >
      {role}
    </span>
  );
}

// ─── Shared avatar + action button helpers ─────────────────────────────────

/**
 * PI-followup-1: centralized via getAvatarColorFromUserId. Ring/border
 * removed; avatars render flat across all surfaces.
 */
function PersonAvatar({
  userId,
  displayName,
  email,
  avatarUrl,
  size,
}: {
  userId: string;
  displayName: string | null;
  email: string;
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
      className="flex items-center justify-center font-semibold flex-shrink-0"
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
  active?: "success";
  disabled?: boolean;
}) {
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
