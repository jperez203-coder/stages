"use client";

import { useEffect, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * First-time canvas coachmark. Bottom-center pill that reads
 * "drag to pan · scroll to zoom", dismissible by the X button or by
 * any user gesture ON THE CANVAS (auto-dismiss). Fires ONCE per user —
 * the dismissed flag persists in profiles.canvas_hint_dismissed so it
 * stays dismissed across sessions and devices.
 *
 * Auto-dismiss scope (Phase 4a step 5d):
 *   * Listeners attach to the `canvasRef` element passed by the parent
 *     (PipelineCanvas), NOT to `window`. This means clicks on the
 *     pipeline header chrome, the left rail, or anywhere outside the
 *     canvas don't dismiss the hint — only actual canvas interaction
 *     does. Pre-5d the listeners were on `window`, which dismissed
 *     the coachmark immediately on any page click (header buttons,
 *     etc.) before the user got to read it.
 *
 * The parent (PipelineCanvas) only renders us if
 * `coachmark_initially_dismissed === false`. We don't fetch the flag
 * ourselves — we trust the server-rendered initial state. This keeps
 * the coachmark from flashing on dismissed users while a client fetch
 * resolves.
 *
 * When dismissed:
 *   1. Hide locally (so it disappears immediately on click)
 *   2. UPDATE profiles.canvas_hint_dismissed = true (fire-and-forget;
 *      if it fails the user just sees the coachmark once more on next
 *      visit — acceptable failure mode, no toast / retry)
 *
 * Per-user, not per-pipeline. Once dismissed, the user never sees this
 * hint on any canvas in any workspace.
 */

type Props = {
  /** Ref to the canvas wrapper element. Auto-dismiss listeners attach
   *  to this element instead of `window` so chrome interactions
   *  (header, rail, popovers) don't dismiss the hint. */
  canvasRef: RefObject<HTMLDivElement | null>;
};

export function CanvasCoachmark({ canvasRef }: Props) {
  const [visible, setVisible] = useState(true);

  const dismiss = () => {
    setVisible(false);
    // Fire-and-forget. The page is server-rendered with the dismissed
    // flag, so the next page load will respect this regardless of
    // whether the UPDATE succeeded. Worst case the user sees the
    // coachmark once more — not a UX-breaker.
    void supabase.auth.getUser().then(async ({ data }) => {
      const userId = data.user?.id;
      if (!userId) return;
      const { error } = await supabase
        .from("profiles")
        .update({ canvas_hint_dismissed: true })
        .eq("id", userId);
      if (error) {
        console.error(
          "[canvas-coachmark] failed to persist dismiss; will re-show on next visit:",
          error.message,
        );
      }
    });
  };

  // Auto-dismiss on the FIRST canvas interaction (pan / zoom). Per
  // 5d scope fix: listeners attach to canvasRef.current — the canvas
  // wrapper element — NOT to `window`. Header chrome / left rail /
  // popover interactions don't dismiss the coachmark; only actual
  // canvas use does. wheel is non-passive on the canvas wrapper for
  // the lib's gesture path; passive: true here is fine since we only
  // observe (don't preventDefault).
  useEffect(() => {
    if (!visible) return;
    const el = canvasRef.current;
    if (!el) return;
    const onInteract = () => dismiss();
    el.addEventListener("pointerdown", onInteract, { once: true });
    el.addEventListener("wheel", onInteract, { once: true, passive: true });
    return () => {
      el.removeEventListener("pointerdown", onInteract);
      el.removeEventListener("wheel", onInteract);
    };
    // dismiss intentionally not in deps — it's stable for our purposes
    // and re-binding the listener on every render would be wasteful.
  }, [visible, canvasRef]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        bottom: 28,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 25,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "rgba(33,33,36,0.92)",
        backdropFilter: "blur(8px)",
        border: "1px solid #36363A",
        borderRadius: 999,
        padding: "8px 12px 8px 16px",
        color: "rgba(255,255,255,0.85)",
        fontSize: 13,
        boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        animation: "fadeIn 0.3s ease-out",
      }}
    >
      <span>drag to pan · scroll to zoom</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss canvas hint"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          borderRadius: 6,
          background: "transparent",
          border: "none",
          color: "rgba(255,255,255,0.5)",
          cursor: "pointer",
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
