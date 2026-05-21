"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { UserAvatar, type AvatarUser } from "@/components/UserAvatar";

/**
 * Activity card on the workspace dashboard. Phase 4a step 2.
 *
 * Renders up to 5 events from activity_events filtered to the four types
 * we can render with the current schema (member_joined, stage_advanced,
 * pipeline_submitted, pipeline_created). Mentions, replies, assignments,
 * and completions are NOT here — they need writer triggers + schema
 * expansion that arrive in 4b.
 *
 * Subtitle is "Recent updates from your team" (NOT "Recent mentions and
 * reminders") because we don't surface mentions yet; don't promise what
 * we can't deliver. Mentions copy returns in 4b once the data does.
 */

type ActivityEvent = {
  id: string;
  type:
    | "member_joined"
    | "stage_advanced"
    | "pipeline_submitted"
    | "pipeline_created";
  actorId: string | null;
  actorName: string;
  actorUser: AvatarUser;
  stageName: string | null;
  pipelineId: string;
  pipelineName: string;
  createdAt: string;
};

type Props = {
  workspaceSlug: string;
  events: ActivityEvent[];
  error: string | null;
};

const TIMESTAMP_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatContent(e: ActivityEvent): string {
  switch (e.type) {
    case "member_joined":
      return `${e.actorName} joined ${e.pipelineName}`;
    case "stage_advanced":
      return `${e.actorName} moved ${e.pipelineName} to ${
        e.stageName ?? "the next stage"
      }`;
    case "pipeline_submitted":
      return `${e.actorName} marked ${e.pipelineName} as complete`;
    case "pipeline_created":
      return `${e.actorName} created ${e.pipelineName}`;
  }
}

export function ActivityCard({ workspaceSlug, events, error }: Props) {
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
        ) : events.length === 0 ? (
          // Empty state: vertical-center the emoji + copy. 🔕 (bell with
          // slash) matches the figma reference — visually echoes the
          // header bell while signaling "no notifications right now."
          // 48px emoji + 16px gap, same proportions as MyTasksCard.
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
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => {
                    console.log(
                      "[step 2 stub] activity row clicked. routing arrives in step 4/5/4b.",
                      {
                        eventId: event.id,
                        eventType: event.type,
                        source: "dashboard_activity",
                      },
                    );
                  }}
                  className="w-full flex items-center gap-3 transition-colors text-left"
                  style={{
                    // Hover pill matches MyTasksCard task rows (negative
                    // horizontal margin + internal padding pattern). Extra
                    // 8px on the left padding (20 vs 12) so the 32px row
                    // avatar's CENTER lines up with the 48px bell box's
                    // center in the header above — without the bump, the
                    // smaller avatar looks visually offset-left.
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
                      <span
                        className="text-[13px] flex-shrink-0"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        {TIMESTAMP_FMT.format(new Date(event.createdAt))}
                      </span>
                    </span>
                    <span
                      className="block text-[14px] truncate mt-0.5"
                      style={{ color: "rgba(255,255,255,0.85)" }}
                    >
                      {formatContent(event)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        className="mt-4 pt-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        {/* Count-conditional footer color — same rule + token as
            MyTasksCard. Grey when there's nothing to navigate to, the
            figma's light-blue token (#7FA7D9) when there is. */}
        <Link
          href={`/w/${workspaceSlug}/activity`}
          className="text-[14px] font-medium"
          style={{ color: events.length > 0 ? "#7FA7D9" : "#979393" }}
        >
          See all activity →
        </Link>
      </div>
    </div>
  );
}
