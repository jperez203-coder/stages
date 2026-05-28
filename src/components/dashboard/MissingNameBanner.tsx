"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User, X } from "lucide-react";

const DISMISS_KEY = "stages.dismissed_name_banner";

/**
 * Dashboard banner nudging users to set their profiles.display_name.
 *
 * Mount conditions:
 *   * `displayName` (passed from the server component that fetched
 *     profiles.display_name) is null OR empty after trim.
 *   * The user hasn't dismissed the banner in this browser. Dismissal
 *     is persisted in localStorage (DISMISS_KEY).
 *
 * Once the user actually sets a name, the server prop flips to a
 * non-empty string and this component renders null on the next page
 * load — no need to clear the dismissal flag because the upstream
 * guard short-circuits before localStorage is even read. So if a
 * dismissing user later changes their mind via /settings/account, the
 * banner stays correctly hidden (their name is set, the nudge is
 * moot); if they leave it blank, the dismissal flag still controls.
 *
 * Visual treatment mirrors the AddPasswordBanner on /settings/account
 * (rounded panel + icon tile + text + button + dismiss X) for chrome
 * consistency, but in stages-amber (the "needs attention / incomplete"
 * brand token) rather than stages-blue (used for primary CTAs +
 * feature nudges).
 */
export function MissingNameBanner({
  displayName,
}: {
  displayName: string | null;
}) {
  const hasName = !!displayName && displayName.trim().length > 0;
  // Visibility state — three branches:
  //   "hidden": don't render (server-prop says they have a name, OR
  //             localStorage says they dismissed)
  //   "loading": initial mount, haven't read localStorage yet. Render
  //              nothing during this window to avoid a flash of the
  //              banner for users who previously dismissed.
  //   "show": render the banner.
  const [state, setState] = useState<"hidden" | "loading" | "show">(
    hasName ? "hidden" : "loading",
  );

  useEffect(() => {
    if (hasName) {
      setState("hidden");
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const dismissed = window.localStorage.getItem(DISMISS_KEY) === "true";
      setState(dismissed ? "hidden" : "show");
    } catch {
      // localStorage unavailable (private browsing edge case). Show
      // the banner — re-appearing each session is acceptable
      // degradation; better than silently hiding a useful nudge.
      setState("show");
    }
  }, [hasName]);

  const dismiss = () => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(DISMISS_KEY, "true");
      } catch {
        // Same private-browsing case — banner will re-show next
        // session. No-op here; the in-memory state below still hides
        // it for the rest of THIS session.
      }
    }
    setState("hidden");
  };

  if (state !== "show") return null;

  return (
    <div
      className="mt-6 mb-2 p-4 rounded-lg flex items-start gap-3"
      style={{
        background: "rgba(245, 158, 11, 0.08)",
        border: "1px solid rgba(245, 158, 11, 0.35)",
      }}
    >
      <div
        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
        style={{ background: "rgba(245, 158, 11, 0.18)" }}
      >
        <User size={16} className="text-stages-amber" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-zinc-100 mb-0.5">
          Add your name
        </div>
        <p className="text-[12.5px] text-zinc-400 leading-snug mb-3">
          Teammates and clients will see your name across Stages — in
          chat, on tasks, and on the activity feed. Takes a few
          seconds.
        </p>
        <Link href="/settings/account" className="btn-primary inline-flex">
          Add your name
        </Link>
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors p-1 -mr-1 -mt-1"
      >
        <X size={14} />
      </button>
    </div>
  );
}
