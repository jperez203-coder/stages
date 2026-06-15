"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EyeOff } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { resolveDisplayName } from "@/lib/display-name";
import type { ChatChannel, ChatMessage } from "@/lib/chat-data";
import {
  renderMessageWithMentions,
  type MentionedProfile,
} from "@/lib/chat-mention-render";

/**
 * Right pane of the chat surface — channel header + message list +
 * composer. Phase 4b slices 1 + 2b.
 *
 * Slice-1 scope (read path):
 *   * Renders one channel's messages (always #general in slices 1-3;
 *     slice 4 wires per-channel rendering).
 *   * Per-day date dividers ("Today" / "Yesterday" / weekday / date) —
 *     group-by computed via useMemo over the message list.
 *   * Message rows match the figma: square avatar (rounded corners,
 *     handled by UserAvatar's proportional radius), bold name +
 *     timestamp, then text. NO reactions, NO mention highlighting,
 *     NO threaded replies, NO "N new messages" divider.
 *   * Empty state when zero messages: centered muted "No messages yet."
 *     No CTA, no build-phase reference in the copy.
 *
 * Slice-2b additions (send path):
 *   * Composer is now functional. Enter sends (Shift+Enter inserts a
 *     newline). Empty/whitespace gates submission before reaching
 *     onSend. Send button mirrors the Enter behavior.
 *   * Scroll-to-bottom on `messages.length` change — fires on mount,
 *     on send (optimistic row appended), and on revert (optimistic
 *     row removed). Pinned to the latest message in all cases.
 *   * Inline ephemeral error on failed send: text restored to the
 *     composer, "Couldn't send. Try again." shown below the textarea,
 *     auto-dismissed on next keystroke or successful send.
 *
 * Layer 3 client-render filter for `is_internal` runs in the parent
 * (ChatBody) before messages reach this component. This component
 * trusts that filtering already happened.
 *
 * Slice-4 deferred: internal-note toggle UI (would replace the hardcoded
 * `false` at the composer's onSend call site with a state-driven boolean
 * from a toggle). Don't add toggle markup here yet.
 */

type Props = {
  channel: ChatChannel;
  messages: ChatMessage[];
  /** Email of the currently-logged-in user — for the composer footer
   *  ("Posting as <email>"). */
  viewerEmail: string;
  /** Send handler from ChatBody. Returns true on successful reconcile,
   *  false on failure (composer keeps text + shows inline error).
   *  is_internal is a real parameter — driven by the composer's
   *  internal-note toggle (when allowInternalToggle is true) or
   *  hardcoded false otherwise. */
  onSend: (text: string, isInternal: boolean) => Promise<boolean>;
  /** Slice 4a: when true, render the "Internal note" toggle chip
   *  above the textarea. Computed in ChatBody as
   *  `activeChannel?.is_client && viewerIsAgencySide`. When false
   *  (the #general channel or any non-agency viewer), the toggle is
   *  hidden and isInternal is always false at the call site. */
  allowInternalToggle: boolean;
  /** Slice 4a follow-up: gates the per-message "Internal" badge on
   *  internal rows. Threaded from ChatBody. We AND this with
   *  `channel.is_client` locally to decide whether the badge ever
   *  renders on the active channel; per-message gating then also
   *  requires `message.is_internal === true`. */
  viewerIsAgencySide: boolean;
  /** Slice 4b-1: override the channel header label. When set,
   *  ChannelHeader renders this string instead of "# <channel.name>"
   *  and hides the channel-type subtitle. Portal uses this to show
   *  the agency workspace name (e.g., "ACME Agency") as the header
   *  instead of "# client" for client-mode viewing. When null or
   *  undefined, default rendering applies. */
  channelHeaderLabel?: string | null;
  /** NF-2: lookup map for the `mentions[]` user_ids on each message.
   *  ChatBody sources this from its existing authorCacheRef, which is
   *  pre-seeded with every pipeline member's profile at mount. A miss
   *  on this map falls through to plain-text rendering for that one
   *  mention — see renderMessageWithMentions. */
  mentionedProfileById: Map<string, MentionedProfile>;
};

export function MessageThread({
  channel,
  messages,
  viewerEmail,
  onSend,
  allowInternalToggle,
  viewerIsAgencySide,
  channelHeaderLabel,
  mentionedProfileById,
}: Props) {
  // Channel-level gate for the per-message internal badge:
  //   * client channel ONLY — in #general the badge would be meaningless
  //     (every message there is internal-by-context; clients don't have
  //     a subscription to #general regardless of the flag)
  //   * agency viewers ONLY — clients should never see a badge confirming
  //     "the agency posted this as private to themselves"; gated correctly
  //     here for when 4b ships clients to a separate route
  // Per-row check below adds `message.is_internal === true`.
  const showInternalBadge = channel.is_client && viewerIsAgencySide;
  // Group messages by calendar day for the date dividers. useMemo so the
  // group-by re-runs only when the messages array identity changes
  // (i.e. on a fresh fetch, an optimistic send, or a successful reconcile
  // — not on every chrome re-render).
  const grouped = useMemo(() => groupByDay(messages), [messages]);

  // Scroll-to-bottom on messages.length change. Fires on mount (length 0
  // → N or initial mount with N already), on send (length N → N+1), on
  // successful reconcile (length unchanged but identity changes — won't
  // re-fire here since deps are length only, which is correct: we don't
  // want to scroll on every server-row replacement), and on revert
  // (length N+1 → N — harmless re-scroll-to-bottom).
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <section
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        background: "#212124",
        position: "relative",
      }}
    >
      {/* Dotted-grid backdrop — single shared source of truth in
          globals.css's .dotted-grid rule (dim treatment baked in).
          Sits behind the message list (z-index 0) so message rows +
          composer (z-index >= 1) render over it. Visual unchanged. */}
      <div
        aria-hidden="true"
        className="dotted-grid"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      />

      <ChannelHeader
        channel={channel}
        labelOverride={channelHeaderLabel ?? null}
      />

      {/* Scrollable message area. */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 28px 12px",
          position: "relative",
          zIndex: 1,
        }}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          grouped.map((group) => (
            <div key={group.dayKey}>
              <DateDivider label={group.label} />
              {group.messages.map((m) => (
                <MessageRow
                  key={m.id}
                  message={m}
                  showInternalBadge={showInternalBadge}
                  mentionedProfileById={mentionedProfileById}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <Composer
        channelName={channel.name}
        viewerEmail={viewerEmail}
        onSend={onSend}
        allowInternalToggle={allowInternalToggle}
      />
    </section>
  );
}

// ─── Channel header ─────────────────────────────────────────────────────

function ChannelHeader({
  channel,
  labelOverride,
}: {
  channel: ChatChannel;
  /** Slice 4b-1: when set, replaces the default "# <name>" treatment
   *  with this label and hides the channel-type subtitle. The "#"
   *  glyph chip is also hidden — the override label is meant to be a
   *  proper-noun name (e.g., the agency workspace name), not a
   *  channel handle. */
  labelOverride: string | null;
}) {
  const showOverride = !!labelOverride;
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 28px",
        borderBottom: "1px solid #2A2A2D",
        background: "#212124",
        position: "relative",
        zIndex: 2,
      }}
    >
      {/* Glyph chip — hidden when an override label is in use. */}
      {!showOverride && (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#2C2C2F",
            border: "1px solid #36363A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.7)",
            fontSize: 14,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          #
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "white",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {showOverride ? labelOverride : `# ${channel.name}`}
        </div>
        {!showOverride && (
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: "rgba(255,255,255,0.5)",
              lineHeight: 1.2,
            }}
          >
            {channel.is_client ? "Client channel" : "Internal team channel"}
          </div>
        )}
      </div>
    </header>
  );
}

// ─── Date divider ───────────────────────────────────────────────────────

function DateDivider({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "20px 0 12px",
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: "rgba(255,255,255,0.08)",
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "rgba(255,255,255,0.55)",
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: "rgba(255,255,255,0.08)",
        }}
      />
    </div>
  );
}

// ─── Message row ────────────────────────────────────────────────────────

function MessageRow({
  message,
  showInternalBadge,
  mentionedProfileById,
}: {
  message: ChatMessage;
  /** Channel + viewer gate from the parent. The badge only ever renders
   *  on a row when this is true AND the row's own `is_internal` flag is
   *  true — both required. */
  showInternalBadge: boolean;
  /** NF-2: profile lookup for cyan @mention rendering. */
  mentionedProfileById: Map<string, MentionedProfile>;
}) {
  // Two distinct missing cases: author === null means the user record
  // is gone (FK set null on delete) → "Deleted user"; author present
  // but unnamed → "Pending member" (handled by the shared util's
  // whenMissing). Keep that distinction at the call site.
  const displayName = message.author
    ? resolveDisplayName(message.author, { whenMissing: "Pending member" })
    : "Deleted user";
  const avatarUser = message.author ?? {
    // Author was deleted (FK set null) — render a neutral placeholder.
    // Matches the convention used elsewhere when a user record is gone.
    id: `deleted:${message.id}`,
    display_name: null,
    avatar_url: null,
    email: null,
  };

  // Per-row gate: parent already confirmed we're in the client channel
  // and the viewer is agency-side. This adds the final per-message
  // condition — only internal rows get the badge.
  const renderInternalBadge = showInternalBadge && message.is_internal;

  return (
    <article
      style={{
        display: "flex",
        gap: 12,
        padding: "10px 4px",
        alignItems: "flex-start",
      }}
    >
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        <UserAvatar user={avatarUser} size={36} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            marginBottom: 4,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "white",
              lineHeight: 1.2,
            }}
          >
            {displayName}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.45)",
              lineHeight: 1.2,
            }}
          >
            {formatTimestamp(message.created_at)}
          </span>
          {renderInternalBadge && (
            <span
              role="status"
              aria-label="Internal note — visible to the agency team only, hidden from the client"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 7px",
                fontSize: 10,
                fontWeight: 600,
                color: "#F59E0B",
                background: "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.4)",
                borderRadius: 999,
                lineHeight: 1,
                // marginLeft handles the gap visually; the parent's
                // gap:8 already accounts for the timestamp→badge
                // spacing but a tiny extra nudge reads cleaner with
                // baseline alignment.
                marginLeft: 0,
              }}
            >
              <EyeOff size={11} aria-hidden="true" />
              Internal
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.88)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {renderMessageWithMentions(
            message.text,
            message.mentions,
            mentionedProfileById,
          )}
        </div>
      </div>
    </article>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div
      style={{
        height: "100%",
        minHeight: 240,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(255,255,255,0.5)",
        fontSize: 14,
      }}
    >
      No messages yet.
    </div>
  );
}

// ─── Composer (slice 2b functional + slice 4a internal toggle) ──────────

function Composer({
  channelName,
  viewerEmail,
  onSend,
  allowInternalToggle,
}: {
  channelName: string;
  viewerEmail: string;
  onSend: (text: string, isInternal: boolean) => Promise<boolean>;
  allowInternalToggle: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Slice 4a: internal-note toggle state. Defaults OFF. The submit
  // function reads this when allowInternalToggle is true; otherwise
  // the value is moot (gated to false at the call site).
  const [isInternal, setIsInternal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // True when the amber visual signal should render (toggle is on AND
  // gating allows it). Defensive belt-and-suspenders against any future
  // bug where isInternal could be true while allowInternalToggle is
  // false — the visual signal stays accurate to what's actually sent.
  const isInternalActive = allowInternalToggle && isInternal;

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // is_internal flows through this single call site. When the toggle
    // is allowed AND on, send true; otherwise always false. The canonical
    // "who decides isInternal" point in the chain remains this one
    // expression — ChatBody's sendMessage, the supabase insert payload,
    // and RLS all consume `isInternal` as a plain boolean param.
    const effectiveIsInternal = allowInternalToggle ? isInternal : false;
    const ok = await onSend(trimmed, effectiveIsInternal);

    if (ok) {
      setText("");
      setError(null);
      // Slice 4a: reset toggle on every successful send — each message
      // is a fresh decision. We don't want a previous internal flag
      // silently affecting the next normal message.
      setIsInternal(false);
      textareaRef.current?.focus();
    } else {
      // Send failed — keep text + toggle state so the user can retry
      // without losing their composition. Inline error auto-dismisses
      // on next keystroke (see onChange) or next successful send.
      setError("Couldn't send. Try again.");
    }
  }, [text, onSend, allowInternalToggle, isInternal]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter (without Shift) → submit.
    // Shift+Enter → default textarea behavior (insert a newline).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      style={{
        padding: "12px 28px 18px",
        borderTop: "1px solid #2A2A2D",
        background: "#212124",
        position: "relative",
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {/* Slice 4a: Internal-note toggle chip. Renders only when
          allowInternalToggle is true (the active channel is the client
          channel AND the viewer is agency-side). OFF = subtle outline;
          ON = amber (#F59E0B), matching CLAUDE.md's stages-amber design
          token for internal notes. Click toggles. */}
      {allowInternalToggle && (
        <div style={{ display: "flex", paddingLeft: 2 }}>
          <button
            type="button"
            onClick={() => setIsInternal((v) => !v)}
            aria-pressed={isInternal}
            aria-label={
              isInternal
                ? "Internal note (on) — client will NOT see this message"
                : "Send as internal note — toggle to hide from client"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 600,
              lineHeight: 1.2,
              borderRadius: 999,
              cursor: "pointer",
              transition:
                "background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out",
              background: isInternal
                ? "rgba(245,158,11,0.12)"
                : "transparent",
              border: `1px solid ${isInternal ? "#F59E0B" : "#36363A"}`,
              color: isInternal ? "#F59E0B" : "rgba(255,255,255,0.55)",
            }}
          >
            <EyeOff size={12} />
            Internal note
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          padding: "8px 12px",
          background: "#2C2C2F",
          border: "1px solid #36363A",
          borderRadius: 10,
          // Slice 4a: amber LEFT-edge stripe when the internal toggle
          // is on. Uses inset boxShadow so the stripe lives inside the
          // existing 1px border without shifting any layout (a thicker
          // borderLeft would have nudged the textarea 2px right). The
          // stripe is a clear visual reminder while typing that "this
          // message is hidden from the client."
          boxShadow: isInternalActive
            ? "inset 3px 0 0 #F59E0B"
            : "none",
          transition: "box-shadow 120ms ease-out",
        }}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={`Message #${channelName}…`}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            resize: "none",
            color: "white",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.4,
            // Internal scroll once the textarea grows past ~6 lines —
            // prevents the composer from eating half the viewport on
            // a very long draft.
            maxHeight: 140,
            overflowY: "auto",
            // Strip the default user-agent textarea padding so vertical
            // alignment matches the disabled input baseline we shipped
            // in slice 1.
            padding: "4px 0",
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          // Disabled visually + interactively when there's nothing to
          // send. Bypassing the empty/whitespace check would still
          // no-op via submit's own guard, but disabling the button
          // makes the affordance obvious.
          disabled={text.trim().length === 0}
          aria-label="Send message"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#108CE9",
            opacity: text.trim().length === 0 ? 0.4 : 1,
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            cursor: text.trim().length === 0 ? "not-allowed" : "pointer",
            flexShrink: 0,
            transition: "opacity 120ms ease-out",
          }}
        >
          <SendGlyph size={14} />
        </button>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: "#F43F5E",
            paddingLeft: 4,
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          paddingLeft: 4,
        }}
      >
        Posting as {viewerEmail} · Press Enter to send
      </div>
    </div>
  );
}

function SendGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Per-message timestamp. Same-day → "9:42 AM"; older → "Mar 14 · 9:42 AM".
 * Used inside the row header next to the bold name. Date dividers handle
 * the day-level grouping above; this is the within-row time-of-day stamp.
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return time;

  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${date} · ${time}`;
}

type DayGroup = {
  dayKey: string; // YYYY-MM-DD in the viewer's locale
  label: string; // "Today" / "Yesterday" / "Monday" / "March 14, 2026"
  messages: ChatMessage[];
};

/**
 * Group messages by calendar day in the viewer's local timezone. The
 * dayKey is YYYY-MM-DD for stable React keys + month-rollover safety.
 * The label is humanized:
 *   * Today → "Today"
 *   * Yesterday → "Yesterday"
 *   * Within the last 6 days (but not Today/Yesterday) → weekday name
 *   * Older → "March 14, 2026"
 *
 * Messages are assumed pre-sorted ASC by created_at (server query
 * already does this). We preserve that order inside each group.
 */
function groupByDay(messages: ChatMessage[]): DayGroup[] {
  if (messages.length === 0) return [];

  const now = new Date();
  const today = dayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);

  const groups = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const k = dayKey(new Date(m.created_at));
    const list = groups.get(k) ?? [];
    list.push(m);
    groups.set(k, list);
  }

  // Preserve ascending day order — Map iteration follows insertion
  // order, and messages came in ASC, so the first-seen day is the
  // oldest. Map entries → array preserves that.
  const out: DayGroup[] = [];
  for (const [k, msgs] of groups) {
    out.push({
      dayKey: k,
      label: dayLabel(k, today, yesterday, now),
      messages: msgs,
    });
  }
  return out;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabel(
  key: string,
  today: string,
  yesterday: string,
  now: Date,
): string {
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";

  // Parse the key back to a Date for weekday / full-date formatting.
  // YYYY-MM-DD is locale-independent so this is safe.
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);

  // Within the last 6 days but not today/yesterday → weekday name
  // ("Monday", "Friday", etc.).
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((now.getTime() - date.getTime()) / msPerDay);
  if (diffDays > 1 && diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }

  // Older — full date with year. Keeps the format unambiguous for
  // anything more than a week back (a "Monday" label is misleading
  // once you're 8+ days out).
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
