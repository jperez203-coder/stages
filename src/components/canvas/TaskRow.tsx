"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StageState } from "@/lib/current-stage";
import { useEditMode } from "@/components/chrome/EditModeContext";

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

// Exported (4b-2-a follow-up 2026-05-25) so the portal canvas's
// PortalTaskRow can render the exact same completed-card treatment
// without duplicating the per-state color rules. Agency rendering is
// unchanged.
export const COMPLETED: Record<StageState, CompletedTreatment> = {
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
// Exported alongside COMPLETED for portal reuse.
export const INCOMPLETE = {
  cardBg: "rgba(255,255,255,0.03)",
  cardBorder: "rgba(255,255,255,0.08)",
  titleColor: "rgba(255,255,255,0.7)",
  checkboxBorder: "rgba(255,255,255,0.25)",
};

const DISABLED_OPACITY = 0.45;

type Props = {
  /** Parent stage id — included in the task's sortable data so the
   *  canvas-level onDragEnd can detect cross-stage moves. */
  stageId: string;
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
  /** Workspace owner OR pipeline owner/admin — gates task drag-reorder
   *  + inline rename. Members can still toggle their own task's done,
   *  but can't drag or rename. */
  canEditPipeline: boolean;
  /** Called with the next done value when the checkbox is clicked
   *  (and userCanToggle === true). */
  onToggleDone: (taskId: string, nextDone: boolean) => void;
  /** Called when the title body is clicked IN NORMAL MODE. 5c stubs
   *  this to a console.log; step 6 wires the task detail side panel.
   *  In edit mode the title click instead opens the inline rename input. */
  onTitleClick: (taskId: string) => void;
  /** 5e — commit a new task title (after inline edit). Direct UPDATE
   *  on tasks.title in the parent. Only invoked in edit mode. */
  onRenameTask: (taskId: string, nextTitle: string) => void;
};

export function TaskRow({
  stageId,
  task,
  stageState,
  userCanToggle,
  canEditPipeline,
  onToggleDone,
  onTitleClick,
  onRenameTask,
}: Props) {
  // editMode flips title click → inline rename (vs the step-6 stub) +
  // activates the dnd-kit drag handle on the card body.
  const { editMode } = useEditMode();
  const completed = COMPLETED[stageState];

  // ── dnd-kit: task as a sortable item (5e) ──────────────────────────────
  // Disabled when not editMode + canEditPipeline. The data.stageId is
  // read by the canvas-level onDragEnd handler to decide within-stage
  // reorder vs cross-stage move.
  const sortable = useSortable({
    id: task.id,
    data: { type: "task", stageId },
    disabled: !editMode || !canEditPipeline,
  });
  const dragStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.5 : 1,
    zIndex: sortable.isDragging ? 30 : "auto",
  };

  // ── Inline title-rename state (5e, edit mode only) ─────────────────────
  const [isRenaming, setIsRenaming] = useState(false);
  const [pendingTitle, setPendingTitle] = useState(task.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync pending title from prop when task changes from outside (e.g.
  // optimistic revert after server reject), and force-exit rename when
  // editMode globally turns off — user hit "Done editing" mid-edit;
  // drop the in-flight change silently. setState-in-effect is
  // intentional here (mirrors StageNode's pattern + matches the
  // pre-existing React 19 purity errors noted in 5d launch-prep).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!editMode) {
      setIsRenaming(false);
      setPendingTitle(task.title);
    }
  }, [editMode, task.title]);

  const startRename = useCallback(() => {
    if (!editMode) return;
    setPendingTitle(task.title);
    setIsRenaming(true);
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [editMode, task.title]);

  const submitRename = useCallback(() => {
    const cleaned = pendingTitle.trim();
    if (!cleaned || cleaned === task.title) {
      setIsRenaming(false);
      setPendingTitle(task.title);
      return;
    }
    onRenameTask(task.id, cleaned);
    setIsRenaming(false);
  }, [pendingTitle, task.title, task.id, onRenameTask]);

  const cancelRename = useCallback(() => {
    setIsRenaming(false);
    setPendingTitle(task.title);
  }, [task.title]);

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
      // dnd-kit callback ref + handler bags — see StageNode for the
      // false-positive rationale (React 19 `react-hooks/refs`).
      /* eslint-disable-next-line react-hooks/refs */
      ref={sortable.setNodeRef}
      /* eslint-disable-next-line react-hooks/refs */
      {...sortable.attributes}
      /* eslint-disable-next-line react-hooks/refs */
      {...sortable.listeners}
      // `pan-disabled` keeps pointerdown on the card from starting a
      // canvas pan (see StageNode + PipelineCanvas `panning.excluded`).
      //
      // POST-5e FIX: conditional on (editMode && canEditPipeline) — i.e.
      // ONLY when useSortable is active. In normal mode the task isn't
      // draggable (no reorder), so click-drag on its body should pan
      // the canvas (matches the locked spec "normal mode: click-drag
      // anywhere pans"). The checkbox + title remain `<button>`s and
      // get exclusion via the tag-name matcher in panning.excluded, so
      // clicking those still doesn't start a pan — only dragging the
      // card body does.
      className={editMode && canEditPipeline ? "pan-disabled" : undefined}
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
        // userCanToggle opacity ties to "can this user check this task";
        // dnd dragging opacity (0.5 via dragStyle) takes priority while
        // actively dragging.
        opacity: sortable.isDragging
          ? dragStyle.opacity
          : userCanToggle
            ? 1
            : DISABLED_OPACITY,
        boxSizing: "border-box",
        // Prevent the card from interpreting itself as a flex item that
        // can shrink — width: 100% within the parent task-stack
        // container makes the card span the available width consistently.
        width: "100%",
        transform: dragStyle.transform,
        transition: dragStyle.transition,
        zIndex: dragStyle.zIndex,
        // In edit mode the card is the drag handle.
        cursor:
          editMode && canEditPipeline
            ? sortable.isDragging
              ? "grabbing"
              : "grab"
            : "default",
        touchAction: editMode && canEditPipeline ? "none" : "auto",
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
          stub) doesn't also fire. PointerDown stops propagation too so
          clicking the checkbox in edit mode doesn't start a task drag. */}
      <button
        type="button"
        disabled={!userCanToggle}
        onPointerDown={(e) => e.stopPropagation()}
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

      {/* Title — click behavior depends on mode:
          * Normal mode: onTitleClick stub (step 6 wires the detail panel)
          * Edit mode: swap in an inline rename input
          Truncate with ellipsis on overflow; no wrapping (cards are
          fixed height + fixed width). */}
      {isRenaming ? (
        <input
          ref={inputRef}
          type="text"
          value={pendingTitle}
          onChange={(e) => setPendingTitle(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
          onBlur={submitRename}
          maxLength={200}
          style={{
            flex: 1,
            minWidth: 0,
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 4,
            color: titleColor,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.3,
            padding: "2px 6px",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (editMode) {
              startRename();
            } else {
              onTitleClick(task.id);
            }
          }}
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
            cursor: editMode ? "text" : "pointer",
          }}
        >
          {task.title}
        </button>
      )}
    </div>
  );
}
