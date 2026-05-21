"use client";

import { Check } from "lucide-react";
import type { StageState } from "@/lib/current-stage";

/**
 * A single task CARD beneath a stage box on the pipeline canvas.
 * Phase 4a step 5c (post-figma annotation polish).
 *
 * Each task renders as a self-contained card — rounded rectangle with
 * state-driven fill + border — wrapping the checkbox + title. Cards
 * stack with a vertical gap between them (parent container handles
 * the gap via `flex flex-col` + gap). Matches figma
 * Figma_pipeline_stage_view.png.
 *
 * Card state rules:
 *   * INCOMPLETE (any stage)          → dark grey card, subtle border,
 *                                       muted title, empty checkbox
 *                                       (transparent bg + grey border)
 *   * COMPLETED in CURRENT stage      → bright purple #6E5BE8 card,
 *                                       white title (strikethrough),
 *                                       INVERTED checkbox (white fill
 *                                       + purple check icon) — inverts
 *                                       so the checkbox doesn't blend
 *                                       into the same-color card bg
 *   * COMPLETED in PASSED stage       → dark green #1F4535 card,
 *                                       green title (strikethrough),
 *                                       STANDARD checkbox (green #15B981
 *                                       fill + white check) — box is
 *                                       dark enough to contrast against
 *                                       a green-filled checkbox without
 *                                       inverting
 *   * COMPLETED in FUTURE stage       → defensive case (shouldn't happen
 *                                       per the derivation); muted grey
 *                                       card so transient optimistic
 *                                       updates don't crash visually
 *
 * Why two-mode checkboxes: a same-color checkbox on a bright-color card
 * disappears. Inverting on bright surfaces, leaving standard on dark
 * surfaces keeps the affordance visible in both cases without needing
 * a one-size-fits-all token.
 *
 * Permission gate:
 *   * userCanToggle === true  → checkbox interactive
 *   * userCanToggle === false → checkbox visible but disabled
 *                               (no hover, `cursor: not-allowed`,
 *                                whole card renders at reduced
 *                                opacity to signal non-interactive)
 *
 * Row body click (title area):
 *   * 5c stub — onTitleClick logs and returns. Step 6 wires the task
 *     detail side panel. Checkbox click stops propagation so toggling
 *     done doesn't ALSO fire the title click.
 */

// Completed-task card treatment, keyed by parent stage state.
type CompletedTreatment = {
  cardBg: string;
  cardBorder: string;
  titleColor: string;
  checkboxBg: string;
  checkboxBorder: string;
  /** Color of the check icon glyph itself. White for standard, stage
   *  color for inverted (so the icon contrasts against the white
   *  checkbox fill on bright cards). */
  checkColor: string;
};

const COMPLETED: Record<StageState, CompletedTreatment> = {
  "in-progress": {
    cardBg: "#6E5BE8",
    cardBorder: "#6E5BE8",
    titleColor: "#FFFFFF",
    // INVERTED checkbox — white fill with purple check icon. Without
    // inversion the checkbox would be the same color as the card bg
    // and disappear; with inversion it reads as a distinct affordance.
    checkboxBg: "#FFFFFF",
    checkboxBorder: "#FFFFFF",
    checkColor: "#6E5BE8",
  },
  done: {
    cardBg: "#1F4535",
    cardBorder: "rgba(21,185,129,0.35)",
    titleColor: "#15B981",
    // STANDARD checkbox — green fill, white check. The dark green card
    // bg gives enough contrast against a bright green checkbox; no
    // need to invert.
    checkboxBg: "#15B981",
    checkboxBorder: "#15B981",
    checkColor: "#FFFFFF",
  },
  "not-started": {
    // A completed task under a not-started stage shouldn't exist by
    // the rule (any completed task pushes the stage to in-progress).
    // Could surface during optimistic updates mid-flight. Render as a
    // muted grey card so transient states don't crash visually.
    cardBg: "#2C2C2F",
    cardBorder: "#36363A",
    titleColor: "#979393",
    checkboxBg: "#979393",
    checkboxBorder: "#979393",
    checkColor: "#FFFFFF",
  },
};

// Incomplete-task card treatment — uniform across all stage states.
const INCOMPLETE = {
  cardBg: "rgba(255,255,255,0.03)",
  cardBorder: "rgba(255,255,255,0.08)",
  titleColor: "rgba(255,255,255,0.7)",
  checkboxBorder: "rgba(255,255,255,0.25)",
};

const DISABLED_OPACITY = 0.45;

type Props = {
  task: {
    id: string;
    title: string;
    done: boolean;
  };
  /** Parent stage's state — drives the COMPLETED card treatment. */
  stageState: StageState;
  /** True when the calling user can toggle this task's done. UI mirrors
   *  the tightened RLS: canEditPipeline || task.assignee_id === userId. */
  userCanToggle: boolean;
  /** Called with the next done value when the checkbox is clicked
   *  (and userCanToggle === true). */
  onToggleDone: (taskId: string, nextDone: boolean) => void;
  /** Called when the title body is clicked. 5c stubs this to a
   *  console.log; step 6 wires the task detail side panel. */
  onTitleClick: (taskId: string) => void;
};

export function TaskRow({
  task,
  stageState,
  userCanToggle,
  onToggleDone,
  onTitleClick,
}: Props) {
  const completed = COMPLETED[stageState];

  // Resolve per-element colors based on done state.
  const cardBg = task.done ? completed.cardBg : INCOMPLETE.cardBg;
  const cardBorder = task.done ? completed.cardBorder : INCOMPLETE.cardBorder;
  const titleColor = task.done ? completed.titleColor : INCOMPLETE.titleColor;
  const checkboxBg = task.done ? completed.checkboxBg : "transparent";
  const checkboxBorder = task.done
    ? completed.checkboxBorder
    : INCOMPLETE.checkboxBorder;
  const checkColor = task.done ? completed.checkColor : "transparent";

  return (
    <div
      style={{
        // The CARD — rounded rectangle wrapping checkbox + title.
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        borderRadius: 8,
        // Fixed height for predictable layout math. Must equal
        // TASK_CARD_HEIGHT in StageNode.tsx — don't change here
        // without also updating that constant. Bumped 32 → 40 in
        // round 5 polish so cards have more vertical presence.
        height: 40,
        padding: "0 10px",
        opacity: userCanToggle ? 1 : DISABLED_OPACITY,
        boxSizing: "border-box",
        // Prevent the card from interpreting itself as a flex item that
        // can shrink — width: 100% within the parent task-stack
        // container makes the card span the available width consistently.
        width: "100%",
      }}
    >
      {/* Left-edge connector dot (5c annotation polish round 4,
          2026-05-22). Small circle where the badge→task SVG connector
          lands. Per figma — visual "terminus" for the connector + a
          per-stage-state signal.

          Color rule: matches the STAGE state, NOT the task's own
          done state. So the dot answers "which stage is this task
          in" at-a-glance — green dot = done stage, purple dot =
          in-progress stage, grey dot = not-started stage. Combined
          with the card fill (which answers "is this task done"),
          the user reads BOTH signals from a single glance without
          looking at the stage box above.

          Position: centered on the card's left stroke (half inside,
          half outside). 8px diameter at `left: -4` puts the dot's
          center exactly on x=0 (the card's outer edge, where the
          1px border renders), so the stroke bisects the dot
          vertically — clean alignment with the card border. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: -4,
          top: "50%",
          transform: "translateY(-50%)",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background:
            stageState === "in-progress"
              ? "#6E5BE8"
              : stageState === "done"
                ? "#15B981"
                : "#6B6B6B",
          pointerEvents: "none",
        }}
      />
      {/* Checkbox — interactive if userCanToggle, disabled otherwise.
          Click stops propagation so the title button's onClick (step-6
          stub) doesn't also fire. */}
      <button
        type="button"
        disabled={!userCanToggle}
        onClick={(e) => {
          e.stopPropagation();
          if (!userCanToggle) return;
          onToggleDone(task.id, !task.done);
        }}
        aria-label={
          task.done
            ? `Uncheck task ${task.title}`
            : `Check off task ${task.title}`
        }
        aria-pressed={task.done}
        style={{
          flexShrink: 0,
          width: 16,
          height: 16,
          borderRadius: 4,
          background: checkboxBg,
          border: `1.5px solid ${checkboxBorder}`,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: userCanToggle ? "pointer" : "not-allowed",
          transition:
            "background 120ms ease-out, border-color 120ms ease-out",
        }}
      >
        {task.done && <Check size={11} color={checkColor} strokeWidth={3} />}
      </button>

      {/* Title — body click stubbed for step 6. Truncate with ellipsis
          on overflow; no wrapping (cards are fixed height + fixed width). */}
      <button
        type="button"
        onClick={() => onTitleClick(task.id)}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          border: "none",
          padding: 0,
          textAlign: "left",
          color: titleColor,
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.3,
          textDecoration: task.done ? "line-through" : "none",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        {task.title}
      </button>
    </div>
  );
}
