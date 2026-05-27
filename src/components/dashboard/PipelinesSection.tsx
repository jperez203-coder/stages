"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Plus } from "lucide-react";
import { PipelineCard, type PipelineViewModel } from "./PipelineCard";

/**
 * Pipelines section on the workspace dashboard. Phase 4a step 2.
 *
 * Hosts the filter chips (Progress / Name / Recents), sorts the pipelines
 * array per the active chip + direction, and renders the responsive grid
 * (3/2/1 columns). The inner grid mapper is isolated so a future
 * virtualization wrapper (react-window / virtuoso) can slot in without
 * restructuring the section component.
 *
 * Empty state (zero pipelines): full-width card spanning all 3 columns,
 * with CTA to /w/[slug]/p/new. Copy is locked verbatim per spec.
 */

type Filter = "progress" | "name" | "recents";
type Direction = "asc" | "desc";

type Props = {
  workspaceSlug: string;
  pipelines: PipelineViewModel[];
  error: string | null;
  /** Workspace owner/admin or workspace member. Owner/admin sees the
   *  "Create pipeline" CTA in the empty state; members see the member-
   *  appropriate empty-state copy without the CTA (since the action
   *  would just bounce them to a no-permission panel anyway). */
  canCreatePipeline: boolean;
};

export function PipelinesSection({
  workspaceSlug,
  pipelines,
  error,
  canCreatePipeline,
}: Props) {
  const [filter, setFilter] = useState<Filter>("progress");
  // Per-filter direction. Progress defaults asc (stalled first). Name
  // defaults asc (A→Z). Recents has no asc — always desc, dropdown is
  // disabled for that filter.
  const [progressDir, setProgressDir] = useState<Direction>("asc");
  const [nameDir, setNameDir] = useState<Direction>("asc");

  const sorted = useMemo(() => {
    const list = [...pipelines];
    if (filter === "progress") {
      list.sort((a, b) => {
        const pa =
          a.progress.total === 0
            ? 0
            : a.progress.completed / a.progress.total;
        const pb =
          b.progress.total === 0
            ? 0
            : b.progress.completed / b.progress.total;
        return progressDir === "asc" ? pa - pb : pb - pa;
      });
    } else if (filter === "name") {
      list.sort((a, b) => {
        const cmp = a.name.localeCompare(b.name);
        return nameDir === "asc" ? cmp : -cmp;
      });
    } else {
      // recents: last_edited_at desc (no asc per spec)
      list.sort(
        (a, b) =>
          new Date(b.last_edited_at).getTime() -
          new Date(a.last_edited_at).getTime(),
      );
    }
    return list;
  }, [pipelines, filter, progressDir, nameDir]);

  return (
    <section className="mt-8">
      {/* Filter row left-pad nudges the "Pipelines / Progress / Name /
          Recents" line off the container edge so its left edge sits
          roughly where the card content begins above it (8px breathing
          room). The pipeline grid below stays flush with the cards above. */}
      <header className="flex items-center gap-2 mb-4" style={{ paddingLeft: 8 }}>
        <h2 className="text-[20px] font-medium text-white mr-2">Pipelines</h2>
        <FilterChip
          label="Progress"
          active={filter === "progress"}
          onClick={() => setFilter("progress")}
          direction={progressDir}
          onFlip={() =>
            setProgressDir((d) => (d === "asc" ? "desc" : "asc"))
          }
        />
        <FilterChip
          label="Name"
          active={filter === "name"}
          onClick={() => setFilter("name")}
          direction={nameDir}
          onFlip={() => setNameDir((d) => (d === "asc" ? "desc" : "asc"))}
        />
        <FilterChip
          label="Recents"
          active={filter === "recents"}
          onClick={() => setFilter("recents")}
          // No flip for recents — one-directional per spec.
        />
      </header>

      {error ? (
        <div
          className="rounded-2xl flex items-start gap-2 text-[13px]"
          style={{
            background: "#2C2C2F",
            border: "1px solid #36363A",
            color: "#DF1E5A",
            padding: "20px",
          }}
        >
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Couldn&apos;t load pipelines — refresh to try again.</span>
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          workspaceSlug={workspaceSlug}
          canCreatePipeline={canCreatePipeline}
        />
      ) : (
        // Responsive grid breakpoints scale columns with viewport:
        //   sm/default 1 → md 2 → lg 3 → 2xl 4
        // Cap at 3 columns for typical laptop / desktop widths so each
        // card has room for the title, current-stage text, member
        // avatars, and progress bar without things truncating. Only
        // genuinely wide displays (≥1536px) get a 4th column.
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {sorted.map((p) => (
            <PipelineCard
              key={p.id}
              pipeline={p}
              workspaceSlug={workspaceSlug}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// (FilterChip + EmptyState unchanged below — only the section header
//  padding and the EmptyState border were touched in this polish round.)

function FilterChip({
  label,
  active,
  onClick,
  direction,
  onFlip,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  direction?: Direction;
  onFlip?: () => void;
}) {
  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={onClick}
        className="text-[14px] font-medium transition-colors"
        style={{
          background: active ? "#2C2C2F" : "transparent",
          color: active ? "white" : "rgba(255,255,255,0.6)",
          padding: "8px 14px",
          borderRadius: 8,
          border: "none",
          cursor: "pointer",
          paddingRight: active && onFlip ? 6 : 14,
        }}
      >
        {label}
        {active && onFlip && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onFlip();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFlip();
              }
            }}
            aria-label={`Flip sort direction (currently ${direction})`}
            className="inline-flex items-center justify-center ml-1"
            style={{
              width: 18,
              height: 18,
              verticalAlign: "middle",
            }}
          >
            <svg
              width="10"
              height="6"
              viewBox="0 0 10 6"
              style={{
                transform:
                  direction === "asc" ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform 120ms",
              }}
            >
              <path
                d="M1 1L5 5L9 1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </span>
        )}
      </button>
    </span>
  );
}

function EmptyState({
  workspaceSlug,
  canCreatePipeline,
}: {
  workspaceSlug: string;
  canCreatePipeline: boolean;
}) {
  return (
    <div
      className="rounded-2xl flex flex-col items-center text-center"
      style={{
        background: "#2C2C2F",
        border: "1px solid #36363A",
        padding: "48px 24px",
      }}
    >
      <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 16 }}>🚀</div>
      <h3 className="text-[18px] font-medium text-white mb-1">
        no pipelines yet
      </h3>
      {/* Copy + CTA branch on permission. Owner/admin gets the action
          ("create your first pipeline to get started" + button).
          Members get a member-appropriate explanation and no CTA — the
          action would just hit a no-permission panel for them. */}
      {canCreatePipeline ? (
        <>
          <p
            className="text-[14px] mb-5"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            create your first pipeline to get started
          </p>
          <Link
            href={`/w/${workspaceSlug}/p/new`}
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-white"
            style={{
              background: "#108CE9",
              padding: "10px 18px",
              borderRadius: 8,
            }}
          >
            <Plus size={14} strokeWidth={2.5} />
            Create pipeline
          </Link>
        </>
      ) : (
        <p
          className="text-[14px]"
          style={{ color: "rgba(255,255,255,0.6)" }}
        >
          an owner or admin will set things up here.
        </p>
      )}
    </div>
  );
}
