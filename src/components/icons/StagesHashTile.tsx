import { WorkspaceIcon } from "@/components/icons/WorkspaceIcon";

/**
 * Stages "#" mark on a tinted rounded-square tile. Used everywhere the
 * workspace switcher renders a workspace identity (dropdown rows, trigger
 * pill, Client Portal section rows). The tint is a low-alpha tint
 * derived from the workspace id via the shared pickFallbackColor hash —
 * stable per workspace so the same agency reads the same color across
 * sessions.
 *
 * The "#" itself keeps its multi-color brand fills (the WorkspaceIcon
 * SVG hard-codes the four Stages brand rect colors). The tile background
 * is the per-workspace tint. Same icon size across all rows; the
 * `size` prop drives the tile's outer footprint, and the inner glyph
 * scales to ~55% of that.
 *
 * Why this exists as its own component: the spec requires this exact
 * treatment in three places (dropdown rows, the new client-portal rows,
 * AND the trigger pill at the top of the app). Keeping the size + tint
 * + glyph composition centralized prevents drift between those sites.
 */

const PALETTE = ["#DF1E5A", "#E273C1", "#21B159", "#36C5EF", "#F59E0B"];

export function pickFallbackColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

type Props = {
  /** Workspace UUID. Drives the tile's tint via a stable hash. */
  workspaceId: string;
  /** Outer footprint in pixels. Defaults to 40 (dropdown rows). The
   *  trigger pill uses ~28 so the pill stays a comfortable header
   *  height. */
  size?: number;
};

export function StagesHashTile({ workspaceId, size = 40 }: Props) {
  const tint = pickFallbackColor(workspaceId);
  // 26 in hex = ~15% alpha — matches the Figma's subtle background tint.
  // Pairs with the saturated brand colors of the "#" glyph for a quiet
  // backdrop that still reads as branded.
  const background = `${tint}26`;
  // Tile corner radius ~25% of footprint so 40 → 10, 28 → 7. Matches
  // the rounded-square look in the Figma; not a perfect circle, not a
  // hard square.
  const radius = Math.max(4, Math.round(size * 0.25));
  const glyph = Math.max(10, Math.round(size * 0.55));
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        background,
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
