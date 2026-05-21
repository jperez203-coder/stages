"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * First-time canvas coachmark. Bottom-center pill that reads
 * "drag to pan · scroll to zoom", dismissible by the X button or by
 * any user gesture on the canvas (auto-dismiss). Fires ONCE per user —
 * the dismissed flag persists in profiles.canvas_hint_dismissed so it
 * stays dismissed across sessions and devices.
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

export function CanvasCoachmark() {
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

  // Auto-dismiss on any canvas interaction (pan / zoom). The user has
  // demonstrated they know what to do — no need to keep the hint up.
  // We listen for pointerdown + wheel on the document since they
  // bubble; this is harmless because the only failure mode is
  // dismissing slightly early on an off-canvas click, which is fine.
  useEffect(() => {
    if (!visible) return;
    const onInteract = () => dismiss();
    // wheel is non-passive on the canvas wrapper but we just need to
    // observe — passive: true here is correct (we're not preventing).
    window.addEventListener("pointerdown", onInteract, { once: true });
    window.addEventListener("wheel", onInteract, { once: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("wheel", onInteract);
    };
    // dismiss intentionally not in deps — it's stable for our purposes
    // and re-binding the listener on every render would be wasteful.
  }, [visible]);

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
