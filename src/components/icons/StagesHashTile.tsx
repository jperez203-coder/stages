import { WorkspaceIcon } from "@/components/icons/WorkspaceIcon";

/**
 * Stages "#" mark on a neutral rounded-square tile. Used everywhere the
 * workspace switcher renders a workspace identity (dropdown rows, trigger
 * pill, Client Portal section rows, empty-state CTA card).
 *
 * Visual treatment (2026-06-12 update): neutral panel-card background
 * (#212124) with a 1px stages-border (#36363A) stroke. Mirrors the
 * pipeline emoji icon at the top-left of PortalShell so the tiles
 * scan as part of the same visual family rather than as per-workspace
 * colored chips. Previous treatment used a hashed low-alpha tint
 * derived from the workspace id; that landed louder than the design
 * wanted and competed with the multi-color "#" glyph inside.
 *
 * The "#" glyph (WorkspaceIcon) keeps its multi-color brand fills —
 * that's the colored element on the tile now; the tile itself is the
 * quiet container.
 *
 * The `workspaceId` prop is preserved on the signature so call sites
 * don't need to be touched, and future iterations can re-introduce a
 * per-workspace differentiator (e.g. as a thin accent strip, or for
 * accessibility) without another prop change.
 */

type Props = {
  /** Workspace UUID. Currently unused for styling — the tile is
   *  workspace-agnostic — but preserved on the API so future
   *  treatments can opt back into per-workspace differentiation. */
  workspaceId: string;
  /** Outer footprint in pixels. Defaults to 40 (dropdown rows). The
   *  trigger pill uses ~28 in default density and ~22 in compact
   *  density so the pill height matches the avatar in each shell. */
  size?: number;
};

export function StagesHashTile({ workspaceId: _workspaceId, size = 40 }: Props) {
  // Tile corner radius ~25% of footprint so 40 → 10, 28 → 7. Matches
  // the rounded-square look used by the pipeline emoji tile in
  // PortalShell — same shape family across the chrome.
  const radius = Math.max(4, Math.round(size * 0.25));
  const glyph = Math.max(10, Math.round(size * 0.55));
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        // Neutral panel-card background + stages-border stroke. Matches
        // the pipeline emoji icon at the top-left of PortalShell
        // exactly (#212124 / 1px / #36363A) so the tiles read as one
        // visual family across the app chrome.
        background: "#212124",
        border: "1px solid #36363A",
        borderRadius: radius,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <WorkspaceIcon size={glyph} />
    </div>
  );
}
