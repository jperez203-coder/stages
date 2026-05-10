"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { StagesLogo } from "@/components/icons/StagesLogo";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { HeaderWorkspaceSwitcher } from "@/components/app/HeaderWorkspaceSwitcher";
import { HeaderProfileMenu } from "@/components/app/HeaderProfileMenu";

type Props = {
  children: ReactNode;
};

/**
 * Persistent app-shell chrome for authenticated agency-side views. Wraps
 * ClientList, ClientBoard, and StagePage at /w/[slug]. Renders the 64px
 * header with logo + workspace switcher (left) and profile menu (right);
 * children render below.
 *
 * KNOWN TRANSITIONAL STATE (Phase 3.4 → 4):
 * The workspace switcher fetches real Supabase data (via useUserContexts).
 * Switching workspaces updates the URL (/w/[new-slug]) and writes
 * profiles.last_active_workspace_id. But the views below render in-memory
 * stub data via useAppState — they do NOT honor the active workspace from
 * the URL. This is intentional and documented in CLAUDE.md → "Known
 * transitional state (Phase 3.4 → 4)". Phase 4 wires real Supabase queries
 * inside the views, at which point switching will change displayed data.
 */
export function AppShell({ children }: Props) {
  const session = useSession();
  const contexts = useUserContexts();
  // Active workspace slug from the URL. Only present when AppShell is
  // mounted inside the /w/[slug] route tree (which it always is in step
  // 4c — App.tsx wraps these views, and the route file at
  // src/app/w/[slug]/page.tsx renders App). Defensive null for the
  // theoretical case of mounting elsewhere.
  const params = useParams();
  const activeSlug =
    typeof params?.slug === "string" ? params.slug : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#212124" }}>
      <header
        className="border-b border-zinc-800 flex items-center sticky top-0 z-40"
        style={{
          background: "#121212",
          paddingLeft: "16px",
          paddingRight: "16px",
          paddingTop: "12px",
          paddingBottom: "12px",
          gap: "12px",
          height: "64px",
        }}
      >
        <div className="flex-shrink-0 flex items-center" style={{ marginRight: "4px" }}>
          <StagesLogo size={28} />
        </div>

        {/* Workspace switcher — only render when we have data. During the
            brief loading window, leave the slot empty (no flash of
            placeholder text). */}
        {session.status === "authenticated" && contexts.status === "ready" && (
          <HeaderWorkspaceSwitcher
            contexts={contexts.contexts}
            activeSlug={activeSlug}
            userId={session.user.id}
          />
        )}

        {/* Spacer pushes the profile menu to the right edge. */}
        <div className="flex-1 min-w-0" />

        {session.status === "authenticated" && contexts.status === "ready" && (
          <HeaderProfileMenu
            email={session.user.email ?? ""}
            displayName={contexts.profile.displayName}
            avatarUrl={contexts.profile.avatarUrl}
          />
        )}
      </header>

      {/* Children render below the persistent header. Each view (ClientList,
          ClientBoard, StagePage) is responsible for its own view-specific
          chrome (search bars, back buttons, breadcrumbs, action buttons). */}
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
