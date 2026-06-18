"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { UserAvatar, type AvatarUser } from "@/components/UserAvatar";
import { supabase } from "@/lib/supabase";

/**
 * Activity card on the workspace dashboard.
 *
 * NF-5: data source swapped from the prototype `activity_events` table
 * (member_joined / stage_advanced / pipeline_submitted / pipeline_created
 * — pipeline-feed events) to the per-user `notifications` table from
 * NF-1 (mention + client_message — inbox events). The dashboard now
 * surfaces the same event stream the workspace activity page renders,
 * trimmed to the 5 most recent.
 *
 * Each row click navigates to the chat surface with deep-link query
 * params (NF-3.2): ?channel=...&message=... — ChatBody scrolls the
 * message into view and the row optimistically marks itself read via
 * the mark_notification_read RPC.
 *
 * "See all activity →" footer link re-added (removed 2026-05-26 when
 * /w/[slug]/activity didn't exist; landed in NF-3). Points at the
 * workspace activity page; same visual styling as the MyTasksCard
 * "See all N →" link.
 *
 * NOTE: the prototype activity_events table is still being read at
 * /w/[slug]/page.tsx for the per-pipeline 7-day red-dot proxy (lines
 * ~285). NF-5 didn't touch that consumer; cleanup tracked separately.
 */

type ActivityEvent = {
  id: string;
  kind: "mention" | "client_message";
  read: boolean;
  actorUser: AvatarUser;
  actorName: string;
  pipelineId: string;
  channelId: string;
  channelName: string;
  channelIsClient: boolean;
  messageId: string;
  messageText: string;
  createdAt: string;
};

type Props = {
  workspaceSlug: string;
  events: ActivityEvent[];
  error: string | null;
};

export function ActivityCard({ workspaceSlug, events, error }: Props) {
  const router = useRouter();
  // Optimistic local copy so a row click can flip read state immediately.
  const [localEvents, setLocalEvents] = useState<ActivityEvent[]>(events);

  const onRowClick = (event: ActivityEvent) => {
    const href =
      `/w/${workspaceSlug}/p/${event.pipelineId}/chat` +
      `?channel=${event.channelId}&message=${event.messageId}`;

    // Optimistic mark-read; revert on RPC failure.
    if (!event.read) {
      const before = localEvents;
      setLocalEvents((prev) =>
        prev.map((e) => (e.id === event.id ? { ...e, read: true } : e)),
      );
      void supabase
        .rpc("mark_notification_read", { p_event_id: event.id })
        .then(({ error: rpcError }) => {
          if (rpcError) {
            console.error(
              "[dashboard/activity] mark_notification_read failed:",
              rpcError.message,
              "code:",
              rpcError.code,
            );
            setLocalEvents(before);
          }
        });
    }

    router.push(href);
  };

  return (
    <div
      className="rounded-2xl flex flex-col"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        padding: "20px 24px",
      }}
    >
      <header className="flex items-start gap-3">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 48,
            height: 48,
            borderRadius: 10,
            background: "#212124",
            border: "1px solid #36363A",
            fontSize: 24,
          }}
        >
          🔔
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-medium text-white">Activity</h2>
          <div
            className="text-[13px] mt-0.5"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            Recent updates from your team
          </div>
        </div>
      </header>

      <div className="mt-5 flex-1 flex flex-col">
        {error ? (
          <div
            className="flex items-start gap-2 text-[14px] py-3"
            style={{ color: "#DF1E5A" }}
          >
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Couldn&apos;t load activity — refresh to try again.</span>
          </div>
        ) : localEvents.length === 0 ? (
          // Empty state: vertical-center the emoji + copy. 🔕 (bell with
          // slash) matches the figma reference — visually echoes the
          // header bell while signaling "no notifications right now."
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <span
              aria-hidden
              style={{ fontSize: 28, lineHeight: 1, marginBottom: 10 }}
            >
              🔕
            </span>
            <p
              className="text-[13px]"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              nothing&apos;s happened yet
            </p>
          </div>
        ) : (
          <ul className="space-y-0">
            {localEvents.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onRowClick(event)}
                  className="w-full flex items-center gap-3 transition-colors text-left"
                  style={{
                    padding: "12px 12px 12px 20px",
                    margin: "0 -12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    background: "transparent",
                    border: "none",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "rgba(255,255,255,0.04)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <UserAvatar user={event.actorUser} size={32} />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[14px] font-medium text-white truncate">
                        {event.actorName}
                      </span>
                      {event.kind === "client_message" && (
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
                            flexShrink: 0,
                          }}
                        >
                          Client
                        </span>
                      )}
                      <span
                        className="text-[13px] flex-shrink-0"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        {formatRelative(event.createdAt)}
                      </span>
                    </span>
                    <span
                      className="block text-[13px] truncate mt-0.5"
                      style={{ color: "rgba(255,255,255,0.7)" }}
                    >
                      {event.kind === "mention"
                        ? "mentioned you in"
                        : "sent a message in"}{" "}
                      <span style={{ color: "#22D3EE", fontWeight: 600 }}>
                        #{event.channelName}
                      </span>
                      {event.messageText ? (
                        <span style={{ color: "rgba(255,255,255,0.45)" }}>
                          {" · "}
                          {event.messageText}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {!event.read && (
                    <span
                      aria-label="Unread"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "#F43F5E",
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* NF-5: "See all activity →" footer restored. Mirrors the
          MyTasksCard "See all N →" footer style for visual consistency.
          Active link color when there's anything to drill into, muted
          when the list is empty (still clickable, the activity page
          renders its own empty state). */}
      <div
        className="mt-4 pt-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <Link
          href={`/w/${workspaceSlug}/activity`}
          className="text-[14px] font-medium"
          style={{
            color: localEvents.length > 0 ? "#7FA7D9" : "#979393",
          }}
        >
          See all activity →
        </Link>
      </div>
    </div>
  );
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
