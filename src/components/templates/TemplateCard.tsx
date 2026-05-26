"use client";

import { pickColor } from "@/lib/constants";

/**
 * Template card used by the create-pipeline picker (slice 4 of the
 * pipeline-templates feature). Pure presentational — selection state
 * + click handler come from the parent (TemplatePickerModal).
 *
 * NOT to be confused with src/components/home/TemplateCard.tsx — that
 * one is the LEGACY in-memory App's template card (different domain,
 * different prop shape). Forked rather than reused because the shapes
 * diverge enough that adapting would cost more than it'd save.
 *
 * Card content (matches ./pipeline-snapshot.png mockup):
 *   * Row 1: emoji + name (bold)
 *   * Row 2: `description` if non-null, else auto-computed summary
 *            "N stages · M tasks" (workspace-saved templates without
 *            a description; the founder-supplied built-ins all have
 *            descriptions, so they show prose).
 *   * Row 3: stage-name pill row. Pills are decorative — colors come
 *            from `pickColor(position % 12)` against the canonical
 *            12-color stage palette in lib/constants. They are NOT
 *            persisted to stages.color on instantiate (locked
 *            state-color model in current-stage.ts).
 *
 * Selection state:
 *   * Default border `#36363A`, transparent ring.
 *   * Selected: blue ring (`#108CE9`) + slightly elevated bg. The
 *     whole card is clickable.
 */

// Visible pill cap before "+N more" overflow. Mockup shows 4 visible
// across the wider built-in cards and 4 across the workspace card —
// keeping at 4 lets both fit on one line at typical widths.
const MAX_VISIBLE_PILLS = 4;

type TemplateStageForCard = {
  id: string;
  position: number;
  name: string;
  // PostgREST nested aggregate shape: `template_tasks(count)` returns
  // [{ count: <n> }]. Empty array when no tasks. Single-element array
  // otherwise.
  template_tasks: { count: number }[];
};

export type TemplateForCard = {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  /** NULL = Stages-shipped built-in. Non-null = workspace-saved. Card
   *  doesn't currently render this differently, but available if a
   *  future "by Stages" badge etc. is wanted. */
  workspace_id: string | null;
  template_stages: TemplateStageForCard[];
};

type Props = {
  template: TemplateForCard;
  isSelected: boolean;
  onSelect: () => void;
};

export function TemplateCard({ template, isSelected, onSelect }: Props) {
  // Compute structural summary up front. Used for the "N stages · M
  // tasks" line when no description is set + for the pill rendering.
  const sortedStages = [...template.template_stages].sort(
    (a, b) => a.position - b.position,
  );
  const stageCount = sortedStages.length;
  const taskCount = sortedStages.reduce(
    (sum, s) => sum + (s.template_tasks[0]?.count ?? 0),
    0,
  );

  const summaryLine =
    template.description?.trim() ||
    `${stageCount} ${stageCount === 1 ? "stage" : "stages"} · ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;

  const visiblePills = sortedStages.slice(0, MAX_VISIBLE_PILLS);
  const overflow = Math.max(0, stageCount - visiblePills.length);

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        width: "100%",
        background: isSelected ? "rgba(16,140,233,0.06)" : "#2C2C2F",
        border: `1px solid ${isSelected ? "#108CE9" : "#36363A"}`,
        boxShadow: isSelected
          ? "0 0 0 1px #108CE9 inset"
          : "none",
        borderRadius: 12,
        cursor: "pointer",
        textAlign: "left",
        color: "white",
        transition:
          "border-color 120ms ease-out, background 120ms ease-out, box-shadow 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = "#4A4A50";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = "#36363A";
      }}
    >
      {/* Row 1 — emoji + name */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 20,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {template.emoji}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "white",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            flex: 1,
          }}
          title={template.name}
        >
          {template.name}
        </span>
      </div>

      {/* Row 2 — description OR auto-summary */}
      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.55)",
          lineHeight: 1.5,
          minHeight: 18,
        }}
      >
        {summaryLine}
      </div>

      {/* Row 3 — stage-name pills (decorative colors from pickColor) */}
      {visiblePills.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 2,
          }}
        >
          {visiblePills.map((s) => (
            <StagePill key={s.id} name={s.name} positionIndex={s.position} />
          ))}
          {overflow > 0 && (
            <span
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.45)",
                padding: "3px 8px",
                alignSelf: "center",
              }}
            >
              +{overflow} more
            </span>
          )}
        </div>
      )}
    </button>
  );
}

/**
 * One stage-name pill. Color derived from `pickColor(positionIndex %
 * 12)` against the canonical palette — same recipe as the legacy
 * src/components/home/TemplateCard (bg = color + "22" alpha hex, text
 * = color, border = color + "33"). Match keeps cards visually
 * consistent across the two surfaces.
 */
function StagePill({
  name,
  positionIndex,
}: {
  name: string;
  positionIndex: number;
}) {
  const color = pickColor(positionIndex);
  return (
    <span
      style={{
        background: color + "22",
        color,
        border: `1px solid ${color}33`,
        borderRadius: 999,
        padding: "3px 8px",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        maxWidth: 140,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      title={name}
    >
      {name}
    </span>
  );
}
