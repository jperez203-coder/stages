"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UserAvatar } from "@/components/UserAvatar";
import type { ChatChannel, ChatMessage } from "@/lib/chat-data";

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
  /** Slice 2b: send handler from ChatBody. Returns true on successful
   *  reconcile, false on failure (composer keeps text + shows inline
   *  error). is_internal is a real parameter — the composer passes
   *  false for slice 2b; slice 4 will replace that literal with a
   *  toggle-driven boolean at the composer call site. */
  onSend: (text: string, isInternal: boolean) => Promise<boolean>;
};

export function MessageThread({
  channel,
  messages,
  viewerEmail,
  onSend,
}: Props) {
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
      {/* Dotted-grid backdrop — matches the canvas treatment. Sits
          behind the message list (z-index 0) so message rows + composer
          (z-index >= 1) render over it. */}
      <div
        aria-hidden="true"
        className="dotted-grid"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.4,
          pointerEvents: "none",
        }}
      />

      <ChannelHeader channel={channel} />

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
                <MessageRow key={m.id} message={m} />
              ))}
            </div>
          ))
        )}
      </div>

      <Composer
        channelName={channel.name}
        viewerEmail={viewerEmail}
        onSend={onSend}
      />
    </section>
  );
}

// ─── Channel header ─────────────────────────────────────────────────────

function ChannelHeader({ channel }: { channel: ChatChannel }) {
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
      {/* Glyph chip — matches the figma "#" tile next to the channel
          name in the thread header. */}
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
          # {channel.name}
        </div>
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

function MessageRow({ message }: { message: ChatMessage }) {
  const displayName = resolveAuthorName(message.author);
  const avatarUser = message.author ?? {
    // Author was deleted (FK set null) — render a neutral placeholder.
    // Matches the convention used elsewhere when a user record is gone.
    id: `deleted:${message.id}`,
    display_name: null,
    avatar_url: null,
    email: null,
  };

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
          {message.text}
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

// ─── Composer (slice 2b: functional) ────────────────────────────────────

function Composer({
  channelName,
  viewerEmail,
  onSend,
}: {
  channelName: string;
  viewerEmail: string;
  onSend: (text: string, isInternal: boolean) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // is_internal HARDCODED `false` HERE — slice 2b sends only normal
    // posts in #general. The canonical "who decides isInternal" point
    // in the chain is this exact call site. Slice 4's internal-note
    // toggle UI will replace this single literal with a state-driven
    // boolean from the toggle; nothing else in the chain (ChatBody's
    // sendMessage, the supabase insert, RLS) needs to change.
    const ok = await onSend(trimmed, /* isInternal */ false);

    if (ok) {
      setText("");
      setError(null);
      textareaRef.current?.focus();
    } else {
      // Send failed — keep text in composer so the user can retry
      // without retyping. Inline error auto-dismisses on next keystroke
      // (see onChange) or next successful send.
      setError("Couldn't send. Try again.");
    }
  }, [text, onSend]);

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
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          padding: "8px 12px",
          background: "#2C2C2F",
          border: "1px solid #36363A",
          borderRadius: 10,
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
 * Walk the same fallback chain as the assignee picker + members popover:
 *   display_name → email-prefix → "Pending member"
 * Keeps the chat surface consistent with the rest of the app for users
 * who don't have a display_name set yet.
 */
function resolveAuthorName(
  author: { display_name: string | null; email: string | null } | null,
): string {
  if (!author) return "Deleted user";
  const name = author.display_name?.trim();
  if (name) return name;
  const email = author.email?.trim();
  if (email) {
    const atIdx = email.indexOf("@");
    return atIdx > 0 ? email.slice(0, atIdx) : email;
  }
  return "Pending member";
}

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
