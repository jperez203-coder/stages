"use client";

import { useEffect } from "react";

/**
 * Fires one fire-and-forget beacon on mount to record a visit to
 * /auth/signup — the only step in the /admin/metrics funnel with no
 * existing signal elsewhere in the schema. See src/app/api/track-pageview.
 */
export function SignupPageViewTracker() {
  useEffect(() => {
    fetch("/api/track-pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/auth/signup" }),
      keepalive: true,
    }).catch(() => {
      // Best-effort — a dropped beacon shouldn't affect the visitor.
    });
  }, []);

  return null;
}
