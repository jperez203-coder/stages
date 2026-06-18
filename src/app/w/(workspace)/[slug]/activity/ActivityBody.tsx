"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BellOff,
  Search,
  Filter,
  CheckCheck,
  CornerUpLeft,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { resolveDisplayName } from "@/lib/display-name";
import {
  renderMessageWithMentions,
  type MentionedProfile,
} from "@/lib/chat-mention-render";
import { supabase } from "@/lib/supabase";

/**
 * NF-3 client surface. Receives the server's pre-shaped event list and
 * the mention-profile lookup; owns tab state + read-state mutations.
 *
 * EXTENSION SHAPE — sketched in comments, not built:
 *   Future event kinds (assignment, stage_moved, file_uploaded,
 *   task_completed, etc.) would extend ActivityEventVM with a discriminated
 *   union on `kind`. Each kind would map to:
 *     * a verb string + icon for the header line
 *     * an optional body renderer (mention/client_message render the
 *       quoted message; other kinds may render a task title, stage chip,
 *       or file list)
 *     * the same click-through navigation + mark_notification_read path
 *   The card itself stays one component with a switch on event.kind.
 *   v1 keeps it flat with two cases — no placeholder UI for unshipped kinds.
 */

export type ActivityEventVM = {
  id: string;
  kind: "mention" | "client_message";
  read: boolean;
  createdAt: string;
  actor: {
    id: string;
    displayName: string | null;
    avatarUrl: string | null;
    email: string | null;
  } | null;
  pipeline: { id: string; name: string };
  channel: { id: string; name: string; isClient: boolean };
  message: { id: string; text: string; mentions: string[] };
};

type Props = {
  workspace: { id: string; slug: string; name: string };
  events: ActivityEventVM[];
  mentionedProfilesById?: Record<string, MentionedProfile>;
  initialUnreadCount: number;
  loadError?: string;
};

type TabKey = "all" | "mentions";

export function ActivityBody({
  workspace,
  events: initialEvents,
  mentionedProfilesById = {},
  initialUnreadCount,
  loadError,
}: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<ActivityEventVM[]>(initialEvents);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [markAllInFlight, setMarkAllInFlight] = useState(false);

  // Build the mentioned-profile Map once per render so the NF-2 helper
  // can match @-tokens. Pre-built on the server and passed as a plain
  // object (Maps aren't serializable across the boundary).
  const mentionedProfilesMap = useMemo(() => {
    const m = new Map<string, MentionedProfile>();
    for (const [id, p] of Object.entries(mentionedProfilesById)) {
      m.set(id, p);
    }
    return m;
  }, [mentionedProfilesById]);

  const unreadCount = useMemo(
    () => events.filter((e) => !e.read).length,
    [events],
  );
  const mentionsTotalCount = useMemo(
    () => events.filter((e) => e.kind === "mention").length,
    [events],
  );

  const filteredEvents = useMemo(
    () =>
      activeTab === "mentions"
        ? events.filter((e) => e.kind === "mention")
        : events,
    [activeTab, events],
  );

  const groupedByDay = useMemo(() => groupByDay(filteredEvents), [filteredEvents]);

  // ── Read-state mutations ───────────────────────────────────────────────

  const markOneRead = async (eventId: string) => {
    const before = events;
    const target = before.find((e) => e.id === eventId);
    if (!target || target.read) return;

    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, read: true } : e)),
    );

    const { error } = await supabase.rpc("mark_notification_read", {
      p_event_id: eventId,
    });
    if (error) {
      console.error(
        "[activity] mark_notification_read failed:",
        error.message,
        "code:",
        error.code,
      );
      // Revert — keep the user honest about state.
      setEvents(before);
    }
  };

  const markAllRead = async () => {
    if (markAllInFlight || unreadCount === 0) return;
    setMarkAllInFlight(true);

    const before = events;
    setEvents((prev) => prev.map((e) => ({ ...e, read: true })));

    const { error } = await supabase.rpc("mark_all_notifications_read", {
      p_workspace_id: workspace.id,
    });
    if (error) {
      console.error(
        "[activity] mark_all_notifications_read failed:",
        error.message,
        "code:",
        error.code,
      );
      setEvents(before);
    }
    setMarkAllInFlight(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen w-full dotted-grid"
      style={{ background: "#212124" }}
    >
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "24px 24px 80px",
        }}
      >
        {/* ── HEADER ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            marginBottom: 28,
          }}
        >
          <Link
            href={`/w/${workspace.slug}`}
            aria-label="Back to dashboard"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: "#2C2C2F",
              border: "1px solid #36363A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#E4E4E7",
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <ArrowLeft size={16} />
          </Link>

          {/* NF-3.1: bell mirrors the dashboard ActivityCard's icon box
              exactly — 🔔 emoji at 24px in a 48×48 dark-grey box. The
              earlier draft used a lucide <Bell /> on a yellow-tinted
              background which broke visual consistency with the
              dashboard surface. */}
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "#212124",
              border: "1px solid #36363A",
              fontSize: 24,
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            🔔
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
              }}
            >
              <h1
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  color: "#E4E4E7",
                  letterSpacing: -0.3,
                  margin: 0,
                }}
              >
                Activity
              </h1>
              <span
                style={{
                  fontSize: 14,
                  color: "#979393",
                }}
              >
                {unreadCount} unread
              </span>
            </div>
            <p
              style={{
                fontSize: 13,
                color: "#979393",
                margin: "4px 0 0",
              }}
            >
              Everything happening across your workspace.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {/* Search + Filter are visual placeholders in v1 per the
                NF-3 spec. They'll wire in NF-3.X or beyond. */}
            <button
              type="button"
              disabled
              style={ghostButtonStyle}
              aria-label="Search tasks (coming soon)"
            >
              <Search size={14} />
              Search tasks
            </button>
            <button
              type="button"
              disabled
              style={ghostButtonStyle}
              aria-label="Filter (coming soon)"
            >
              <Filter size={14} />
              Filter
            </button>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0 || markAllInFlight}
              style={{
                ...ghostButtonStyle,
                opacity: unreadCount === 0 ? 0.4 : 1,
                cursor: unreadCount === 0 ? "not-allowed" : "pointer",
              }}
              aria-label="Mark all as read"
            >
              <CheckCheck size={14} />
              Mark all read
            </button>
          </div>
        </div>

        {/* ── TABS ────────────────────────────────────────────────────── */}
        <div
          role="tablist"
          aria-label="Activity filter"
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 22,
            borderBottom: "1px solid #2A2A2D",
            paddingBottom: 0,
          }}
        >
          <TabButton
            label="All"
            count={events.length}
            active={activeTab === "all"}
            onClick={() => setActiveTab("all")}
          />
          <TabButton
            label="Mentions"
            count={mentionsTotalCount}
            active={activeTab === "mentions"}
            onClick={() => setActiveTab("mentions")}
          />
        </div>

        {/* ── BODY ────────────────────────────────────────────────────── */}
        {loadError ? (
          <ErrorState message={loadError} />
        ) : events.length === 0 ? (
          <EmptyState
            title="You're all caught up."
            subtitle="When clients message you or teammates @mention you, the activity will show up here."
          />
        ) : filteredEvents.length === 0 ? (
          <EmptyState
            title="No mentions yet"
            subtitle="Teammate @mentions land in this view."
          />
        ) : (
          <>
            {groupedByDay.map((group) => (
              <DayGroup
                key={group.bucketKey}
                group={group}
                workspaceSlug={workspace.slug}
                mentionedProfilesMap={mentionedProfilesMap}
                onCardActivate={(eventId) => void markOneRead(eventId)}
                router={router}
              />
            ))}

            {/* Pagination stub — hidden in v1 unless we hit the cap. */}
            {events.length >= 50 && (
              <div
                style={{
                  textAlign: "center",
                  marginTop: 32,
                  paddingTop: 24,
                  borderTop: "1px solid #2A2A2D",
                  color: "#71717A",
                  fontSize: 12,
                }}
              >
                Load older activity — coming soon
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        background: active ? "#108CE9" : "transparent",
        border: "none",
        color: active ? "white" : "#979393",
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 120ms ease-out, color 120ms ease-out",
        marginBottom: -1,
      }}
    >
      {label} {count}
    </button>
  );
}

// ── Day group ─────────────────────────────────────────────────────────────

function DayGroup({
  group,
  workspaceSlug,
  mentionedProfilesMap,
  onCardActivate,
  router,
}: {
  group: DayBucket;
  workspaceSlug: string;
  mentionedProfilesMap: Map<string, MentionedProfile>;
  onCardActivate: (eventId: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const groupUnread = group.events.filter((e) => !e.read).length;

  return (
    <section style={{ marginBottom: 28 }}>
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#ED4899",
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#E4E4E7",
            }}
          >
            {group.label}
          </span>
          <span style={{ fontSize: 13, color: "#979393" }}>
            {group.longDate}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "#979393" }}>
          {group.events.length} event{group.events.length === 1 ? "" : "s"}
          {groupUnread > 0 ? ` · ${groupUnread} unread` : ""}
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {group.events.map((ev) => (
          <EventCard
            key={ev.id}
            ev={ev}
            workspaceSlug={workspaceSlug}
            mentionedProfilesMap={mentionedProfilesMap}
            onActivate={() => onCardActivate(ev.id)}
            router={router}
          />
        ))}
      </div>
    </section>
  );
}

// ── Event card ────────────────────────────────────────────────────────────

function EventCard({
  ev,
  workspaceSlug,
  mentionedProfilesMap,
  onActivate,
  router,
}: {
  ev: ActivityEventVM;
  workspaceSlug: string;
  mentionedProfilesMap: Map<string, MentionedProfile>;
  onActivate: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const actor = ev.actor;
  const actorName = actor
    ? resolveDisplayName(
        { display_name: actor.displayName, email: actor.email },
        { whenMissing: "Pending member" },
      )
    : "Deleted user";

  const verb =
    ev.kind === "mention" ? "mentioned you in" : "sent a message in";

  // The chat page doesn't read ?channel=...&message=... yet — flagged
  // for follow-up. The user still lands on the right channel index;
  // they'll have to scroll to find the message manually until the
  // chat page consumes these query params.
  const href = `/w/${workspaceSlug}/p/${ev.pipeline.id}/chat?channel=${
    ev.channel.id
  }&message=${ev.message.id}`;

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onActivate();
    router.push(href);
  };

  const messageNodes = renderMessageWithMentions(
    ev.message.text,
    ev.message.mentions,
    mentionedProfilesMap,
  );

  return (
    <article
      style={{
        background: "#26262A",
        border: "1px solid #2F2F33",
        borderLeft: ev.read ? "1px solid #2F2F33" : "3px solid #22D3EE",
        borderRadius: 10,
        padding: "14px 18px",
        position: "relative",
        cursor: "pointer",
      }}
      onClick={onClick}
    >
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flexShrink: 0 }}>
          <UserAvatar
            user={
              actor
                ? {
                    id: actor.id,
                    display_name: actor.displayName,
                    avatar_url: actor.avatarUrl,
                    email: actor.email,
                  }
                : {
                    id: `deleted:${ev.id}`,
                    display_name: null,
                    avatar_url: null,
                    email: null,
                  }
            }
            size={32}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ── Header line ─────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "#E4E4E7" }}>
              {actorName}
            </span>
            {ev.kind === "client_message" && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#22D3EE",
                  background: "rgba(34,211,238,0.10)",
                  padding: "2px 6px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                Client
              </span>
            )}
            <span style={{ fontSize: 13, color: "#979393" }}>{verb}</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#22D3EE",
              }}
            >
              #{ev.channel.name}
            </span>
            <span style={{ fontSize: 12, color: "#71717A" }}>
              · {ev.pipeline.name}
            </span>
          </div>

          {/* ── Quoted message body ─────────────────────────── */}
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.78)",
              borderLeft: "2px solid #36363A",
              padding: "2px 0 2px 10px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {messageNodes}
          </div>

          {/* ── Action row ──────────────────────────────────
              NF-3.2: rendered for BOTH event kinds. NF-3 originally
              gated these on kind==='mention'; the reference image and
              the spec say client_message cards get the same Reply +
              Open thread affordance. */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 10,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onActivate();
                // Reply intent: navigate AND signal the channel page to
                // focus its composer (ChatBody reads ?reply=1 from the
                // query string and bumps its composer-focus signal).
                router.push(`${href}&reply=1`);
              }}
              style={replyButtonStyle}
              aria-label="Reply to this thread"
            >
              <CornerUpLeft size={12} strokeWidth={2.5} />
              Reply
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onActivate();
                router.push(href);
              }}
              style={openThreadButtonStyle}
              aria-label="Open thread in chat"
            >
              Open thread
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 6,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 11, color: "#71717A" }}>
            {formatRelative(ev.createdAt)}
          </span>
          {!ev.read && (
            <span
              aria-label="Unread"
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#F43F5E",
                display: "inline-block",
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}

// ── Empty / error states ──────────────────────────────────────────────────

function EmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "64px 24px",
        color: "#979393",
      }}
    >
      <BellOff
        size={36}
        style={{ color: "#36363A", marginBottom: 12 }}
        aria-hidden="true"
      />
      <div style={{ fontSize: 15, fontWeight: 600, color: "#E4E4E7" }}>
        {title}
      </div>
      <div style={{ fontSize: 13, marginTop: 6, maxWidth: 360, margin: "6px auto 0" }}>
        {subtitle}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "48px 24px",
        color: "#F43F5E",
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const ghostButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "#2C2C2F",
  border: "1px solid #36363A",
  color: "#E4E4E7",
  fontSize: 12,
  fontWeight: 500,
  padding: "8px 12px",
  borderRadius: 8,
  cursor: "pointer",
};

// NF-3.2: action-row buttons. Reply has a small reply-arrow glyph +
// pill-tinted background; Open thread is text-only, slightly muted
// so the visual hierarchy ranks Reply > Open thread > body click.
// Both render on every event-kind card (NF-3.2 removed the
// kind==='mention' gate).
const replyButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 11,
  fontWeight: 600,
  color: "#22D3EE",
  background: "rgba(34,211,238,0.10)",
  padding: "5px 10px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  userSelect: "none",
  fontFamily: "inherit",
};

const openThreadButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  fontSize: 11,
  fontWeight: 500,
  color: "#979393",
  background: "transparent",
  padding: "5px 8px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  userSelect: "none",
  fontFamily: "inherit",
};

// ── Date bucketing + relative time ────────────────────────────────────────

type DayBucket = {
  bucketKey: string; // YYYY-MM-DD in the local zone
  label: string; // "Today" / "Yesterday" / weekday name / month-day
  longDate: string; // "Monday, May 18"
  events: ActivityEventVM[];
};

function groupByDay(events: ActivityEventVM[]): DayBucket[] {
  const now = new Date();
  const todayKey = localDateKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);

  const buckets = new Map<string, DayBucket>();

  for (const ev of events) {
    const d = new Date(ev.createdAt);
    const key = localDateKey(d);

    let label: string;
    if (key === todayKey) label = "Today";
    else if (key === yesterdayKey) label = "Yesterday";
    else
      label = d.toLocaleDateString(undefined, { weekday: "long" });

    const longDate = d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    if (!buckets.has(key)) {
      buckets.set(key, { bucketKey: key, label, longDate, events: [] });
    }
    buckets.get(key)!.events.push(ev);
  }

  // Map iteration is insertion order — events are already in desc time,
  // so the buckets land in correct order. But: re-sort defensively in
  // case a malformed event-list arrives out of order.
  return Array.from(buckets.values()).sort((a, b) =>
    a.bucketKey < b.bucketKey ? 1 : a.bucketKey > b.bucketKey ? -1 : 0,
  );
}

function localDateKey(d: Date): string {
  // YYYY-MM-DD in the LOCAL zone — Date.toISOString() would use UTC and
  // bucket cross-zone events incorrectly near midnight.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
