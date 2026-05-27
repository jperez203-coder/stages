"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { HeaderProfileMenu } from "@/components/app/HeaderProfileMenu";
import { HeaderWorkspaceSwitcher } from "@/components/app/HeaderWorkspaceSwitcher";
import { StagesLogo } from "@/components/icons/StagesLogo";
import { useSession } from "@/hooks/useSession";
import { useUserContexts } from "@/hooks/useUserContexts";
import { PortalTabs } from "./PortalTabs";

/**
 * Client portal chrome. Phase 4b-1.
 *
 * Structure:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  📋 Pipeline Name           Casey ▾                      │  ← Top bar
 *   │  by ACME Agency (when workspace name is visible to caller) │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Viewing as client. [Switch to agency view →]            │  ← Banner (agency viewers only)
 *   ├──────────────────────────────────────────────────────────┤
 *   │  [ Canvas ]  [ Chat ]  [ Files ]                         │  ← Tabs
 *   ├──────────────────────────────────────────────────────────┤
 *   │                                                          │
 *   │              {children}                                  │
 *   │                                                          │
 *   └──────────────────────────────────────────────────────────┘
 *
 * The "Viewing as client" banner is rendered ONLY when the viewer is
 * an actual agency member previewing the portal (per their workspace
 * or pipeline membership). Pure clients never see it. The banner does
 * NOT change chat behavior — the portal route always renders chat in
 * client mode regardless of who the viewer is. See PortalChatBody for
 * the locked viewerIsAgencySide=false decision.
 *
 * Notably absent:
 *   * No LeftRail (that's agency-only — cursor, +invite, view-as-client)
 *   * No "Edit pipeline" button
 *   * No member cluster (agency-team-roster is internal info)
 *   * No emoji selector / pipeline settings affordances
 */

type Props = {
  pipelineId: string;
  pipelineName: string;
  pipelineEmoji: string;
  /** The client/customer's company name (pipeline.company), if set.
   *  Used as a fallback subtitle when workspace name is unavailable. */
  pipelineCompany: string | null;
  /** Agency workspace name. Null when workspaces_select RLS doesn't
   *  return the row (pre-migration state). When null, the subtitle
   *  falls back to pipelineCompany or hides entirely. */
  workspaceName: string | null;
  /** Workspace slug for the "Switch to agency view" link target.
   *  Null when the workspace row wasn't readable (pre-migration). */
  workspaceSlug: string | null;
  /** Logged-in viewer's profile fields for HeaderProfileMenu. */
  viewer: {
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
  /** True when the viewer is actually an agency member (workspace
   *  owner OR pipeline_memberships owner/admin/member). Drives the
   *  "Viewing as client" banner ONLY. The portal's chat surface
   *  ignores this — it always renders client-mode. */
  viewerIsActuallyAgencySide: boolean;
  children: ReactNode;
};

export function PortalShell({
  pipelineId,
  pipelineName,
  pipelineEmoji,
  pipelineCompany,
  workspaceName,
  workspaceSlug,
  viewer,
  viewerIsActuallyAgencySide,
  children,
}: Props) {
  // Switcher data — read here so the trigger pill at the top-left of
  // the portal chrome carries the same "#" tile + workspace identity
  // it shows in the agency chrome. usePathname inside the switcher
  // detects the portal URL and prefixes the label with "Client of: ".
  // Both hooks suspend internally (status fields) so we can render
  // without an explicit loading wrapper.
  const session = useSession();
  const switcherContexts = useUserContexts();
  const switcherReady =
    session.status === "authenticated" && switcherContexts.status === "ready";

  // Subtitle preference: agency workspace name > pipeline.company > nothing.
  // The workspace name reads "by <Agency>" which is the most informative
  // for the client. Falling back to the client's own company is awkward
  // ("for ACME Roofing" when the client IS ACME Roofing) but better
  // than empty — and only surfaces in the pre-migration state where
  // workspaces_select doesn't expose the workspace name to clients.
  const subtitle = workspaceName
    ? `by ${workspaceName}`
    : pipelineCompany
      ? `for ${pipelineCompany}`
      : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#212124",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          padding: "14px 28px",
          borderBottom: "1px solid #2A2A2D",
          background: "#1A1A1C",
          gap: 16,
        }}
      >
        {/* Pipeline identity */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: "#212124",
              border: "1px solid #36363A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {pipelineEmoji}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "white",
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {pipelineName}
            </div>
            {subtitle && (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.5)",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </div>
            )}
          </div>
        </div>

        {/* Workspace switcher trigger — mounted on the RIGHT side of
            the portal top bar (just left of the avatar) so it doesn't
            compete with the pipeline icon + name for visual attention.
            usePathname inside the switcher detects /portal/[id] and
            renders the pill as "Client of: <Agency Name>" with the
            agency's tinted "#" tile. activeSlug is null here — portal
            routes don't have a /w/[slug] component to match — so the
            switcher relies entirely on the portal-mode pathname check.
            Spacing comes from the header's gap: 16 (same unit between
            every top-bar element). */}
        {switcherReady && (
          <HeaderWorkspaceSwitcher
            contexts={switcherContexts.contexts}
            activeSlug={null}
            userId={session.user.id}
            compact
            align="end"
          />
        )}

        {/* Viewer identity + sign-out via the shared HeaderProfileMenu.
            Same component as the agency surface — consistent UX +
            single source for the sign-out action. */}
        <HeaderProfileMenu
          size={32}
          email={viewer.email}
          displayName={viewer.displayName}
          avatarUrl={viewer.avatarUrl}
        />
      </header>

      {/* ── "Viewing as client" banner — agency viewers only ─────── */}
      {viewerIsActuallyAgencySide && workspaceSlug && (
        <div
          role="status"
          style={{
            background: "rgba(245,158,11,0.10)",
            borderBottom: "1px solid rgba(245,158,11,0.3)",
            padding: "10px 28px",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 600, color: "#F59E0B" }}>
            Viewing as client.
          </span>
          <span style={{ color: "rgba(255,255,255,0.7)" }}>
            This is what the client sees on this pipeline.
          </span>
          <Link
            href={`/w/${workspaceSlug}/p/${pipelineId}/chat`}
            style={{
              marginLeft: "auto",
              color: "#F59E0B",
              fontWeight: 600,
              textDecoration: "none",
              fontSize: 13,
            }}
          >
            Switch to agency view →
          </Link>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────── */}
      <PortalTabs pipelineId={pipelineId} />

      {/* ── Body ────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {children}
      </div>

      {/* ── "Powered by Stages" footer ─────────────────────────────
          Subtle attribution mark, always present for free-tier
          distribution per CLAUDE.md positioning ("every client sees
          the product"). Deferential to the agency identity at the
          top: tucked into a thin bottom-left footer, low-contrast
          tokens. The mark is a real link to trystages.com — the
          intentional distribution path: a client clicking it becomes
          a potential lead. target="_blank" so it doesn't navigate
          them away from the portal; rel="noopener noreferrer" for
          the standard cross-origin security hygiene (prevents the
          opened page from accessing window.opener, and suppresses
          the referrer header).
          —
          Always rendered. No white-label / hide-for-paid-plan logic
          today; that's a Phase 6 (billing) decision when it comes
          up. Keep the markup uncomplicated until then.
          —
          Footer is the semantic container (role="contentinfo"); the
          anchor inside is the actual clickable surface. Hover lifts
          the muted text color from 0.4 → 0.7 — subtle "this is a
          link" signal without button-styling. Cursor + browser's
          default focus ring round out the affordance for keyboard
          users. */}
      <footer
        role="contentinfo"
        aria-label="Powered by Stages"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 24px",
          borderTop: "1px solid #2A2A2D",
          background: "#1A1A1C",
          flexShrink: 0,
        }}
      >
        <a
          href="https://trystages.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Powered by Stages — opens in a new tab"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            textDecoration: "none",
            color: "rgba(255,255,255,0.4)",
            fontSize: 11,
            fontWeight: 500,
            cursor: "pointer",
            transition: "color 120ms ease-out",
            borderRadius: 4,
            // Tight padding + negative margin keeps the visual
            // alignment identical to the pre-link version (anchor
            // doesn't push the logo off the parent's padding edge).
            padding: "2px 4px",
            marginLeft: -4,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.7)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "rgba(255,255,255,0.4)";
          }}
        >
          <StagesLogo size={12} />
          <span>
            Powered by{" "}
            <span
              style={{
                color: "rgba(255,255,255,0.6)",
                fontWeight: 600,
              }}
            >
              Stages
            </span>
          </span>
        </a>
      </footer>
    </div>
  );
}
