"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LogOut, Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";

const COLORS = ["#3BA5EE", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#06B6D4", "#F43F5E"];

type Props = {
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
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
export function HeaderProfileMenu({ email, displayName, avatarUrl }: Props) {
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="transition-transform"
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "9px",
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
        <Avatar email={email} avatarUrl={avatarUrl} size={36} fontSize={14} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 fade-in z-50"
          style={{
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
          borderRadius: size <= 36 ? "9px" : "50%",
          objectFit: "cover",
          border: `2px solid ${color}66`,
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
        background: color + "33",
        color,
        border: `2px solid ${color}66`,
        borderRadius: size <= 36 ? "9px" : "50%",
        fontSize: `${fontSize}px`,
      }}
    >
      {initial}
    </div>
  );
}
