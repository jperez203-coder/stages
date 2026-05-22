"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";

// Trimmed from a 7-color brand subset to the 4 LETTER colors that
// mirror UserAvatar.tsx's AVATAR_PALETTE in the same order
// (green / pink / blue / amber). Modulo-4 in both files so the slot
// semantics line up. Rendering style here stays as the subtle alpha
// pill (background = color + "33", text = color) — the dark-fill/
// vivid-letter chip treatment is UserAvatar's. Keep these two arrays
// synchronized when adding or reordering palette entries.
const COLORS = [
  "#15B981", // green   — pairs with AVATAR_PALETTE[0]
  "#ED4899", // pink    — pairs with AVATAR_PALETTE[1]
  "#3A97D8", // blue    — pairs with AVATAR_PALETTE[2]
  "#F59E0C", // amber   — pairs with AVATAR_PALETTE[3]
];

type Props = {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** Trigger avatar size in px. Defaults to 40 (AppShell's dashboard
   *  nav). The pipeline canvas header passes a smaller value (32)
   *  because its header is 52px tall vs AppShell's 64px — 40px there
   *  was nearly touching the header edges top + bottom. The DROPDOWN
   *  content's internal avatar stays fixed at 44 — that's separate
   *  overlay UI, doesn't need to scale with the trigger. */
  size?: number;
};

/**
 * Profile menu in the AppShell header. Replaces the legacy in-memory
 * ProfileMenu. Differences from the legacy version:
 *
 *   * Avatar uses profiles.avatar_url when present (Google sign-ups have
 *     it auto-populated from the OAuth metadata via the
 *     20260510120000_profile_enrichment migration). Falls back to the
 *     deterministic-color initials circle.
 *   * Display name shown above email when present. Email is the unique
 *     identifier; display name is just a friendlier label.
 *   * Sign-out calls supabase.auth.signOut() then routes to /auth/signin.
 *     Doesn't touch the in-memory app state — that's the documented
 *     transitional gap (see CLAUDE.md → Known transitional state).
 */
export function HeaderProfileMenu({
  email,
  displayName,
  avatarUrl,
  size = 40,
}: Props) {
  // Trigger font size scales with trigger size — keep the initials
  // proportional at all sizes. 40% ratio matches the 40→16 + 44→~18
  // pattern from the prior hardcoded version.
  const triggerFontSize = Math.round(size * 0.4);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const signOut = async () => {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.push("/auth/signin");
  };

  return (
    // `flex items-center` on the wrapper kills the inline-block baseline
    // descender that <button> would otherwise add below itself, which made
    // this wrapper measure ~44px tall (40px button + ~4px descender space)
    // and shifted the avatar ~2px up relative to the 40px Pipeline button
    // next to it. As a flex container, the button stops being baseline-
    // aligned and the wrapper's height matches the button exactly.
    <div ref={ref} className="relative flex items-center">
      <button
        onClick={() => setOpen(!open)}
        className="transition-transform"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "6px",
          cursor: "pointer",
          padding: 0,
          background: "transparent",
          border: "none",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        title={displayName ? `${displayName} (${email})` : email}
        aria-label="Open profile menu"
      >
        <Avatar
          email={email}
          avatarUrl={avatarUrl}
          size={size}
          fontSize={triggerFontSize}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 fade-in z-50"
          style={{
            // Explicit `top: 100%` anchors the dropdown to the wrapper's
            // BOTTOM edge (just below the avatar trigger). Without this,
            // `top: auto` on an absolutely-positioned child of a
            // `flex items-center` parent computes its static position as
            // the parent's vertical center — and since the dropdown
            // (~200px) is much taller than the wrapper (~40px), it ends
            // up half above the wrapper, which puts its top edge ~72px
            // above the viewport top → cut off. `top: 100%` + 8px
            // marginTop gives the right "drop down 8px below the
            // avatar" feel. Caught + fixed 2026-05-22 polish round
            // alongside the avatar shape/stroke updates.
            top: "100%",
            marginTop: "8px",
            width: "260px",
            background: "#1A1A1A",
            border: "1px solid #36363A",
            borderRadius: "10px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          }}
        >
          <div className="p-4 border-b border-zinc-800 flex items-center gap-3">
            <Avatar email={email} avatarUrl={avatarUrl} size={44} fontSize={16} />
            <div className="flex-1 min-w-0">
              {displayName && (
                <div className="text-[13px] font-semibold truncate">
                  {displayName}
                </div>
              )}
              <div
                className={`text-[12px] truncate ${
                  displayName ? "text-zinc-500" : "text-zinc-200 font-semibold"
                }`}
              >
                {email}
              </div>
            </div>
          </div>
          <div className="p-1">
            <button
              onClick={() => {
                setOpen(false);
                router.push("/settings/account");
              }}
              disabled={signingOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-zinc-300 transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1F1F22")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ background: "transparent" }}
            >
              <Settings size={14} />
              Settings
            </button>
            <button
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              disabled={signingOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-zinc-300 transition-colors"
              onMouseEnter={(e) => (e.currentTarget.style.background = "#1F1F22")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              style={{ background: "transparent" }}
            >
              <LogOut size={14} />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Avatar with three-tier fallback:
 *   1. profiles.avatar_url when present (Google avatar via migration
 *      20260510120000_profile_enrichment)
 *   2. Initials in a deterministic-color circle (color derived from email
 *      hash so the same user gets the same color across sessions/devices)
 *
 * The image is rendered via next/image for automatic optimisation; if it
 * fails to load (broken Google CDN URL, expired token, etc.) we fall back
 * to the initials circle via onError.
 */
function Avatar({
  email,
  avatarUrl,
  size,
  fontSize,
}: {
  email: string;
  avatarUrl: string | null;
  size: number;
  fontSize: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // Deterministic colour from email hash so the same user always gets the
  // same colour. Same algorithm as the legacy ProfileMenu so users who saw
  // a particular colour before keep seeing it.
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = COLORS[Math.abs(hash) % COLORS.length];
  const initial = email.charAt(0).toUpperCase();

  // Rendering shape rules (apply to both image and initials branches):
  //   * borderRadius: 6px ACROSS ALL SIZES (2026-05-22 polish round —
  //     was conditional 10px / 50%, now uniform square-ish 6px). Jordan
  //     wanted "square instead of circle" — 6px is clearly square but
  //     with a tiny bit of softness so the corners don't look razor-
  //     sharp. Applies to both the 40px header trigger AND the 44px
  //     dropdown header avatar; consistency reads better than the old
  //     size-conditional flip.
  //   * border: 1px on both branches (was 1px image + 2px initials —
  //     the 2px on initials read as a thick obvious ring; 1px matches
  //     the image branch + reads quieter).
  //   * boxSizing: "border-box" is EXPLICIT here because next/image's <img>
  //     element doesn't reliably inherit Tailwind preflight's global box-
  //     sizing rule. Without this the border was being added to the
  //     footprint, making the trigger avatar render visually larger than
  //     declared size and sit above the neighboring 40px button.
  if (avatarUrl && !imgFailed) {
    return (
      <Image
        src={avatarUrl}
        alt={email}
        width={size}
        height={size}
        unoptimized
        onError={() => setImgFailed(true)}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          boxSizing: "border-box",
          borderRadius: "6px",
          objectFit: "cover",
          // Stroke removed 2026-05-22 — Jordan polish pass. Photo + initial
          // branches both render borderless now on dashboard + canvas
          // (HeaderProfileMenu is the avatar in the top-right of both
          // AppShell and PipelineChromeShell).
          border: "none",
          display: "block",
        }}
      />
    );
  }

  return (
    <div
      className="flex items-center justify-center font-semibold flex-shrink-0"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        boxSizing: "border-box",
        background: color + "33",
        color,
        // Stroke removed 2026-05-22 — see comment on the photo branch above.
        border: "none",
        borderRadius: "6px",
        fontSize: `${fontSize}px`,
      }}
    >
      {initial}
    </div>
  );
}
