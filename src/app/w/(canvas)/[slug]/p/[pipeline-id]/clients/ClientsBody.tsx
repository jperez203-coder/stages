"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  Users,
} from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import {
  usePipelineClientsData,
  type PipelineClientInvite,
  type PipelineClient,
  type PipelineClientsDataState,
} from "@/hooks/usePipelineClientsData";
import { resolveInitial } from "@/lib/display-name";
import { supabase } from "@/lib/supabase";

/**
 * /w/[slug]/p/[pipeline-id]/clients — the agency-side UI for inviting
 * clients to a specific pipeline. Mirrors /w/[slug]/settings/team in
 * architecture but pipeline-scoped + single-role (clients only).
 *
 * Permission gate: workspace owner of the parent workspace, OR pipeline
 * owner/admin of this pipeline. Mirrors `can_edit_pipeline`'s logic on
 * the client side using useUserContexts (zero extra round-trip).
 *
 * AppShell wraps via /w/[slug]/layout.tsx — this page only renders its
 * own body.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Renamed from `PipelineClientsPage` (default export) in Phase 4a step
 * 5d. Now a named export so the route's new server `page.tsx` can wrap
 * this body in `<PipelineChromeShell>` for the pipeline header + rail.
 * The body itself is unchanged — same useSession/useUserContexts/
 * usePipelineClientsData hooks, same invite form, same client roster.
 */
export function ClientsBody() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params?.slug === "string" ? params.slug : null;
  // Next.js gives back the route segment name lowercased, but the directory
  // is `[pipeline-id]` (kebab) so the param key is `pipeline-id` (kebab) —
  // we read it via bracket access since hyphens aren't valid JS identifiers.
  const pipelineId =
    typeof (params as Record<string, unknown>)?.["pipeline-id"] === "string"
      ? ((params as Record<string, unknown>)["pipeline-id"] as string)
      : null;

  const session = useSession();
  const contexts = useUserContexts();

  // Permission gate derived from useUserContexts.
  //   * workspace owner of the parent workspace (source='workspace' + role='owner')
  //     OR
  //   * pipeline owner/admin of this specific pipeline (source='pipeline')
  // Mirrors `can_edit_pipeline`'s gate from the RLS layer, evaluated
  // client-side to short-circuit the UX with a redirect for unauthorised
  // users. RLS is still the real authorisation barrier underneath.
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

  // WT-5: defensive client-side personal-workspace redirect. The page-
  // level server redirect in clients/page.tsx catches the direct-URL
  // case; this effect is the in-app navigation backstop (e.g. someone
  // who bookmarked the URL or pasted it into a tab where the server
  // already routed cached HTML). Redirects to the pipeline's canvas
  // root — that's the default tab for a pipeline.
  useEffect(() => {
    if (contexts.status !== "ready" || !slug || !pipelineId) return;
    const ctx = contexts.contexts.find(
      (c) =>
        c.type === "agency" &&
        c.workspaceSlug === slug,
    );
    if (ctx?.workspaceType === "personal") {
      router.replace(`/w/${slug}/p/${pipelineId}`);
    }
  }, [contexts, slug, pipelineId, router]);

  const data = usePipelineClientsData(canEdit ? pipelineId : null);

  const shouldRenderPage =
    session.status === "authenticated" &&
    contexts.status === "ready" &&
    canEdit;

  if (!shouldRenderPage) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-[13px] text-zinc-500">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-8">
        <h1 className="text-[24px] font-semibold mb-1">Clients</h1>
        <p className="text-[14px] text-zinc-500">
          {data.status === "ready" ? (
            <>
              Manage who can view{" "}
              <span className="text-zinc-300">{data.pipelineName}</span> as a
              client.
            </>
          ) : (
            <>Manage who can view this pipeline as a client.</>
          )}
        </p>
      </header>

      <section className="mb-10 panel-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={16} className="text-zinc-400" />
          <h2 className="text-[15px] font-semibold">Invite a client</h2>
        </div>
        <InviteClientForm
          pipelineId={pipelineId ?? ""}
          onSent={data.status === "ready" ? data.refetch : async () => {}}
        />
      </section>

      <section className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <Mail size={16} className="text-zinc-400" />
          <h2 className="text-[15px] font-semibold">Pending invites</h2>
          {data.status === "ready" && data.invites.length > 0 && (
            <span className="text-[12px] text-zinc-500">
              {data.invites.length}
            </span>
          )}
        </div>
        <PendingInvitesSection
          data={data}
          refetch={data.status === "ready" ? data.refetch : async () => {}}
        />
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Users size={16} className="text-zinc-400" />
          <h2 className="text-[15px] font-semibold">Current clients</h2>
          {data.status === "ready" && (
            <span className="text-[12px] text-zinc-500">
              {data.clients.length}
            </span>
          )}
        </div>
        <ClientsSection data={data} />
      </section>
    </div>
  );
}

// ─── Invite form ────────────────────────────────────────────────────────────

function InviteClientForm({
  pipelineId,
  onSent,
}: {
  pipelineId: string;
  onSent: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReactNode | null>(null);
  const [success, setSuccess] = useState<{
    email: string;
    acceptUrl: string;
  } | null>(null);

  const trimmed = email.trim();
  const isValidEmail = EMAIL_REGEX.test(trimmed);
  const canSubmit = isValidEmail && !submitting;
  const emailLooksInvalid =
    trimmed.length > 0 && trimmed.includes("@") && !isValidEmail;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const sessionResult = await supabase.auth.getSession();
    const jwt = sessionResult.data.session?.access_token;
    if (!jwt) {
      setError("Your session expired. Sign in again.");
      setSubmitting(false);
      return;
    }

    let response: Response;
    try {
      response = await fetch("/api/client-invites/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ pipeline_id: pipelineId, email: trimmed }),
      });
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
      return;
    }

    let body: { ok?: boolean; error?: string; accept_url?: string };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      setError(`Request failed (${response.status})`);
      setSubmitting(false);
      return;
    }

    if (!response.ok || !body.ok) {
      setError(body.error || `Request failed (${response.status})`);
      setSubmitting(false);
      return;
    }

    setSuccess({ email: trimmed, acceptUrl: body.accept_url ?? "" });
    setEmail("");
    setSubmitting(false);
    await onSent();
  };

  const dismissSuccess = () => setSuccess(null);

  return (
    <div>
      <form onSubmit={submit}>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@theircompany.com"
            className="field flex-1"
            autoComplete="off"
            disabled={submitting}
          />
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
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="mt-4 p-3 rounded-lg border border-stages-green/40 bg-stages-green/10">
          <div className="flex items-start gap-2 text-[13px] text-stages-green leading-snug mb-2">
            <Check size={14} className="flex-shrink-0 mt-0.5" />
            <span>
              Invite sent to <strong>{success.email}</strong>. They&apos;ll
              receive an email with a sign-in link.
            </span>
          </div>
          {success.acceptUrl && (
            <div className="flex items-center gap-2 mt-2">
              <code className="text-[11px] text-zinc-400 truncate flex-1 px-2 py-1.5 rounded bg-stages-card border border-stages-border">
                {success.acceptUrl}
              </code>
              <CopyButton text={success.acceptUrl} />
              <button
                onClick={dismissSuccess}
                className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pending invites ────────────────────────────────────────────────────────

function PendingInvitesSection({
  data,
  refetch,
}: {
  data: PipelineClientsDataState;
  refetch: () => Promise<void>;
}) {
  if (data.status === "loading") {
    return (
      <div className="panel-card p-6 text-[13px] text-zinc-500">Loading…</div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="panel-card p-6 flex items-start gap-2 text-[13px] text-stages-red">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>Couldn&apos;t load invites: {data.message}</span>
      </div>
    );
  }
  if (data.invites.length === 0) {
    return (
      <div className="panel-card p-8 text-center">
        <Inbox size={22} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-[14px] text-zinc-300 font-medium">
          No pending invites
        </p>
        <p className="text-[12px] text-zinc-500 mt-1">
          Use the form above to invite a client.
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
            <InviteRow
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

function InviteRow({
  invite,
  isLast,
  onRefetch,
}: {
  invite: PipelineClientInvite;
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
    invite.inviterDisplayName ||
    invite.inviterEmail ||
    "Former member";
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

// ─── Clients section ────────────────────────────────────────────────────────

function ClientsSection({ data }: { data: PipelineClientsDataState }) {
  if (data.status === "loading") {
    return (
      <div className="panel-card p-6 text-[13px] text-zinc-500">Loading…</div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="panel-card p-6 flex items-start gap-2 text-[13px] text-stages-red">
        <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>Couldn&apos;t load clients: {data.message}</span>
      </div>
    );
  }
  if (data.clients.length === 0) {
    return (
      <div className="panel-card p-8 text-center">
        <Users size={22} className="mx-auto mb-3 text-zinc-600" />
        <p className="text-[14px] text-zinc-300 font-medium">No clients yet</p>
        <p className="text-[12px] text-zinc-500 mt-1">
          Once a client accepts an invite, they&apos;ll appear here.
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
            <th className="text-left px-4 py-3 font-medium" colSpan={2}>
              Client
            </th>
          </tr>
        </thead>
        <tbody>
          {data.clients.map((c, idx) => (
            <ClientRow
              key={c.userId}
              client={c}
              isLast={idx === data.clients.length - 1}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientRow({
  client,
  isLast,
}: {
  client: PipelineClient;
  isLast: boolean;
}) {
  const label = client.displayName || client.email;
  return (
    <tr style={{ borderBottom: isLast ? "none" : "1px solid #2A2A2D" }}>
      <td className="px-4 py-3" style={{ width: "44px" }}>
        <ClientAvatar
          email={client.email}
          displayName={client.displayName}
          avatarUrl={client.avatarUrl}
          size={32}
        />
      </td>
      <td className="px-4 py-3">
        <div className="text-zinc-200 truncate max-w-[320px]">{label}</div>
        {client.displayName && (
          <div className="text-[12px] text-zinc-500 truncate max-w-[320px]">
            {client.email}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Avatar + action buttons (mirror the team settings page) ────────────────

const AVATAR_COLORS = [
  "#3BA5EE",
  "#8B5CF6",
  "#EC4899",
  "#F59E0B",
  "#10B981",
  "#06B6D4",
  "#F43F5E",
];

function ClientAvatar({
  email,
  displayName,
  avatarUrl,
  size,
}: {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  size: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  // Color hashes from email (stable identifier — renaming yourself
  // doesn't change your avatar color). Initial letter comes from
  // display_name (human-readable) with email-first-letter fallback.
  // See resolveInitial in src/lib/display-name.ts for the contract.
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
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
          border: `2px solid ${color}66`,
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
        background: color + "33",
        color,
        border: `2px solid ${color}66`,
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", text);
    }
  };
  return (
    <button
      onClick={copy}
      className="text-[12px] flex items-center gap-1 px-2 py-1.5 rounded transition-colors"
      style={{
        background: copied ? "#15B98122" : "transparent",
        color: copied ? "#15B981" : "#71717A",
      }}
      onMouseEnter={(e) => {
        if (copied) return;
        e.currentTarget.style.color = "#E4E4E7";
      }}
      onMouseLeave={(e) => {
        if (copied) return;
        e.currentTarget.style.color = "#71717A";
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
