"use client";

import { useMemo } from "react";
import { UserAvatar } from "@/components/UserAvatar";
import type { ChatChannel, ChatMessage } from "@/lib/chat-data";

/**
 * Right pane of the chat surface — channel header + message list +
 * disabled composer. Phase 4b slice 1.
 *
 * Slice-1 scope:
 *   * Renders one channel's messages (always #general in this slice;
 *     slice 4 wires per-channel rendering).
 *   * Per-day date dividers ("Today" / "Yesterday" / weekday / date) —
 *     group-by computed via useMemo over the message list.
 *   * Message rows match the figma: square avatar (rounded corners,
 *     handled by UserAvatar's proportional radius), bold name +
 *     timestamp, then text. NO reactions, NO mention highlighting,
 *     NO threaded replies, NO "N new messages" divider.
 *   * Empty state when zero messages: centered muted "No messages yet."
 *     No CTA, no build-phase reference in the copy.
 *   * Composer renders for layout but is DISABLED — sending is slice 2.
 *     Layout shows the disabled textarea + the "Posting as <email> ·
 *     Press Enter to send" footer per the figma.
 *
 * Layer 3 client-render filter for `is_internal` runs in the parent
 * (ChatBody) before messages reach this component. This component
 * trusts that filtering already happened.
 */

type Props = {
  channel: ChatChannel;
  messages: ChatMessage[];
  /** Email of the currently-logged-in user — for the composer footer
   *  ("Posting as <email>"). */
  viewerEmail: string;
};

export function MessageThread({ channel, messages, viewerEmail }: Props) {
  // Group messages by calendar day for the date dividers. useMemo so the
  // group-by re-runs only when the messages array identity changes
  // (i.e. on a fresh fetch — not on every chrome re-render).
  const grouped = useMemo(() => groupByDay(messages), [messages]);

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

      <DisabledComposer channelName={channel.name} viewerEmail={viewerEmail} />
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

// ─── Composer (slice 1: rendered, disabled) ─────────────────────────────

function DisabledComposer({
  channelName,
  viewerEmail,
}: {
  channelName: string;
  viewerEmail: string;
}) {
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
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          background: "#2C2C2F",
          border: "1px solid #36363A",
          borderRadius: 10,
          opacity: 0.7,
        }}
      >
        <input
          type="text"
          disabled
          placeholder={`Message #${channelName}…`}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "rgba(255,255,255,0.45)",
            fontSize: 14,
            cursor: "not-allowed",
          }}
        />
        {/* Disabled send button — visual only; sending is slice 2. */}
        <button
          type="button"
          disabled
          aria-label="Send message (coming soon)"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "#108CE9",
            opacity: 0.4,
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            cursor: "not-allowed",
            flexShrink: 0,
          }}
        >
          <SendGlyph size={14} />
        </button>
      </div>
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
