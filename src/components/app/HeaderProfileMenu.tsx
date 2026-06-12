"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { LogOut, Settings, Users } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { getAvatarColorFromUserId } from "@/lib/avatar-color";
import { resolveInitial } from "@/lib/display-name";
import { supabase } from "@/lib/supabase";

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
  const params = useParams();
  const contexts = useUserContexts();
  // PI-followup-1: pull user.id from session so the avatar color is
  // derived from the same input every avatar surface uses. Pre-PI-
  // followup-1 this component hashed email locally — different palette
  // + different input from UserAvatar, so the same user could land in
  // different color slots across surfaces.
  const session = useSession();
  const userId =
    session.status === "authenticated" ? session.user.id : null;
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // "Team & members" → the workspace-scoped team-settings page, which is
  // gated (server + RLS) to workspace owners/admins. Mirror that gate here
  // so the item only renders for users who can actually use it.
  //
  // Slug comes from the URL (useParams). The item is only meaningful
  // inside a /w/[slug] route, so on portal / account / auth / select-
  // workspace routes (which have no `slug` param) activeSlug is null and
  // the item doesn't render. Role check mirrors canCreatePipeline in
  // AppShell.tsx: a source === "workspace" owner/admin context for the
  // active slug (a pipeline-level admin does NOT get workspace settings).
  //
  // WT-5 follow-up: also hide on personal workspaces. Personal workspaces
  // have no team-member invite surface (Model C); the link would route
  // the user to /w/[slug]/settings/team which redirects them right back
  // out via the settings/team/layout.tsx server gate. Hiding the link
  // here closes the loop visually so personal-workspace users never
  // see the dead-end affordance.
  const activeSlug = typeof params?.slug === "string" ? params.slug : null;
  const canManageTeam =
    activeSlug !== null &&
    contexts.status === "ready" &&
    contexts.contexts.some(
      (c) =>
        c.workspaceSlug === activeSlug &&
        c.type === "agency" &&
        c.source === "workspace" &&
        (c.role === "owner" || c.role === "admin") &&
        c.workspaceType !== "personal",
    );

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
          userId={userId}
          email={email}
          displayName={displayName}
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
            <Avatar
              userId={userId}
              email={email}
              displayName={displayName}
              avatarUrl={avatarUrl}
              size={44}
              fontSize={16}
            />
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
            {canManageTeam && (
              <button
                onClick={() => {
                  setOpen(false);
                  router.push(`/w/${activeSlug}/settings/team`);
                }}
                disabled={signingOut}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium text-zinc-300 transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#1F1F22")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                style={{ background: "transparent" }}
              >
                <Users size={14} />
                Team & members
              </button>
            )}
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
  userId,
  email,
  displayName,
  avatarUrl,
  size,
  fontSize,
}: {
  /** PI-followup-1: user.id is the canonical hash input. Null while the
   *  session is still loading — in that brief window we fall back to
   *  hashing the email so the avatar still has SOME color, but the moment
   *  the session resolves we re-render with the user_id-derived color so
   *  the cross-surface invariant holds. */
  userId: string | null;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  size: number;
  fontSize: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // PI-followup-1/5: centralized via getAvatarColorFromUserId (now
  // returning a paired text/bg). Falls back to email hashing only
  // during the brief loading window before the session resolves —
  // the steady-state input is user.id everywhere.
  const { text, bg } = userId
    ? getAvatarColorFromUserId(userId)
    : getAvatarColorFromUserId(email);
  // Initial: display_name's first letter, falling back to email's first
  // letter, then "?". Matches UserAvatar's chain — see resolveInitial in
  // src/lib/display-name.ts for the canonical contract.
  const initial = resolveInitial({ display_name: displayName, email });

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
        background: bg,
        color: text,
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
