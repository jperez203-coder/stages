"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Home } from "lucide-react";
import { UserAvatar, type AvatarUser } from "@/components/UserAvatar";

/**
 * Pipeline card on the workspace dashboard. Phase 4a step 2.
 *
 * Renders a single pipeline tile in the dashboard grid. The visual variant
 * for the emoji block (plain / dashed / solid) is driven by the locked
 * three-state current_stage rule, computed server-side and passed down via
 * the `visual` prop.
 *
 * Click anywhere on the card → /w/[slug]/p/[id] (a Phase 4a step 5 stub
 * for now; the navigation lands on a 404 page until canvas ships). The
 * member-avatar cluster intercepts clicks to open its popover instead of
 * navigating.
 *
 * The "unread" red dot uses the 7-day activity proxy passed in via the
 * unreadCount prop. Heuristic — see page.tsx for the limitations.
 */

export type PipelineMember = {
  role: string;
  user: AvatarUser & { email: string | null };
};

export type PipelineViewModel = {
  id: string;
  name: string;
  emoji: string;
  /** Optional company / client name, shown under the pipeline name with
   *  a Home icon. From pipelines.company in the schema. */
  company: string | null;
  last_edited_at: string;
  created_at: string;
  currentStage: { id: string; name: string; color: string | null } | null;
  visual: "plain" | "in-progress" | "complete";
  progress: { completed: number; total: number };
  unreadCount: number;
  visibleMembers: PipelineMember[];
  overflowMembers: number;
  allMembers: PipelineMember[];
};

const PALETTE = ["#DF1E5A", "#E273C1", "#21B159", "#36C5EF", "#F59E0B"];
function pickFallbackColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function PipelineCard({
  pipeline,
  workspaceSlug,
}: {
  pipeline: PipelineViewModel;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const stageColor =
    pipeline.currentStage?.color ?? pickFallbackColor(pipeline.id);

  const pct =
    pipeline.progress.total === 0
      ? 0
      : Math.round(
          (pipeline.progress.completed / pipeline.progress.total) * 100,
        );

  return (
    <div
      className="rounded-2xl relative transition-colors"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        padding: "16px 20px",
        cursor: "pointer",
      }}
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/w/${workspaceSlug}/p/${pipeline.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/w/${workspaceSlug}/p/${pipeline.id}`);
        }
      }}
    >
      <header className="flex items-start gap-3 mb-4">
        <div className="relative flex-shrink-0">
          <div
            className="flex items-center justify-center"
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "#212124",
              border: "1px solid #36363A",
              fontSize: 24,
              lineHeight: 1,
            }}
          >
            {pipeline.emoji}
          </div>
          {pipeline.unreadCount > 0 && (
            <span
              aria-label={`${pipeline.unreadCount} unread updates`}
              style={{
                position: "absolute",
                top: -2,
                left: -2,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#DF1E5A",
                border: "2px solid #2C2C2F",
              }}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="text-[16px] font-medium text-white truncate"
            title={pipeline.name}
          >
            {pipeline.name}
          </h3>
          {pipeline.company && (
            // Company / client name line per the figma — Home icon (lucide)
            // matches the inline-icon convention used elsewhere in the
            // dashboard (Lock, Search, ArrowLeft). Null company collapses
            // the line entirely, keeping the card chrome consistent.
            <div
              className="flex items-center gap-1.5 mt-1 text-[13px]"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              <Home size={12} className="flex-shrink-0" />
              <span className="truncate">{pipeline.company}</span>
            </div>
          )}
        </div>
        <MemberCluster
          visible={pipeline.visibleMembers}
          overflow={pipeline.overflowMembers}
          all={pipeline.allMembers}
        />
      </header>

      <div className="mb-3">
        <div
          className="text-[12px] font-medium uppercase mb-1.5"
          style={{
            color: "rgba(255,255,255,0.5)",
            letterSpacing: 0.5,
          }}
        >
          Current stage
        </div>
        <div className="flex items-center gap-2">
          {/* Solid colored dot — stage identity reads through color
              alone. The 3-state visual variant (plain ring / dashed ring /
              solid) didn't pay off at 8px; completion state is already
              encoded in the progress bar below. The `visual` prop is still
              computed server-side (and the data flow keeps it around for a
              potential future treatment elsewhere — e.g., on canvas where
              size is larger). */}
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              flexShrink: 0,
              background: stageColor,
            }}
          />
          <span className="text-[14px] font-medium text-white truncate">
            {pipeline.currentStage?.name ?? "No stages yet"}
          </span>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span
            className="text-[12px]"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            Progress
          </span>
          <span
            className="text-[12px] font-medium"
            style={{ color: "rgba(255,255,255,0.7)" }}
          >
            {pipeline.progress.completed}/{pipeline.progress.total}
          </span>
        </div>
        <div
          className="relative overflow-hidden"
          style={{
            height: 6,
            background: "rgba(255,255,255,0.08)",
            borderRadius: 3,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: `${pct}%`,
              background: stageColor,
              borderRadius: 3,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Member cluster + popover ───────────────────────────────────────────

function MemberCluster({
  visible,
  overflow,
  all,
}: {
  visible: PipelineMember[];
  overflow: number;
  all: PipelineMember[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Show all members"
        aria-expanded={open}
        className="flex items-center"
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        {/* Wrapper border-radius matches the UserAvatar inside (24px size
            → 6px corner). Without this they'd visually disagree — outer
            circle border around a rounded-square avatar. */}
        {visible.map((m, idx) => (
          <span
            key={m.user.id}
            style={{
              marginLeft: idx === 0 ? 0 : -8,
              border: "2px solid #2C2C2F",
              borderRadius: 6,
              display: "inline-flex",
            }}
          >
            <UserAvatar user={m.user} size={24} />
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="flex items-center justify-center text-[11px] font-medium text-white"
            style={{
              marginLeft: -8,
              width: 24,
              height: 24,
              borderRadius: 6,
              background: "rgba(255,255,255,0.12)",
              border: "2px solid #2C2C2F",
            }}
          >
            +{overflow}
          </span>
        )}
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          className="absolute right-0 top-full mt-2 z-20"
          style={{
            width: 240,
            background: "#1A1A1A",
            border: "1px solid #36363A",
            borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
            padding: 8,
          }}
        >
          <ul className="space-y-0">
            {all.map((m) => (
              <li
                key={m.user.id}
                className="flex items-center gap-2 py-2 px-2 rounded"
              >
                <UserAvatar user={m.user} size={28} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] text-zinc-200 truncate">
                    {m.user.display_name ?? m.user.email ?? "Unknown"}
                  </span>
                  {m.user.email && m.user.display_name && (
                    <span className="block text-[11px] text-zinc-500 truncate">
                      {m.user.email}
                    </span>
                  )}
                </span>
                {m.role === "client" && (
                  <span
                    className="text-[10px] uppercase tracking-wider font-medium flex-shrink-0"
                    style={{
                      color: "#108CE9",
                      background: "rgba(16,140,233,0.15)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}
                  >
                    client
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
