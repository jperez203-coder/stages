/**
 * Doc selection-toolbar icons drawn to match ClickUp's doc toolbar
 * (2026-09-26): a heavy "B" (Jordan's own SVG), a slim slanted serif "I", and a bullet
 * list with round dots. All use currentColor so the toolbar's grey/white
 * hover states apply. Bold, underline and link are Jordan's own SVGs.
 */

type Props = { size?: number; strokeWidth?: number };

/** Bold "B" — Jordan's supplied SVG (2026-09-26), fills/strokes switched
 *  from #B4B4B4 to currentColor. Native viewBox is 37×41, so `size` sets
 *  the height and the width follows proportionally. */
export function ToolbarBoldIcon({ size = 16 }: Props) {
  return (
    <svg
      width={(size * 37) / 41}
      height={size}
      viewBox="0 0 37 41"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g fill="currentColor" stroke="currentColor">
        <rect x="5.5" y="0.512207" width="5" height="39" />
        <rect x="3.5" y="34.5122" width="23" height="5" />
        <rect x="0.5" y="34.5122" width="5" height="5" rx="2.5" />
        <rect x="3.5" y="0.512207" width="19" height="5" />
        <rect x="10.5" y="17.5122" width="16" height="5" />
        <rect x="0.5" y="0.512207" width="5" height="5" rx="2.5" />
      </g>
      <path d="M26 37.0122C26 37.0122 34 36.0678 34 28.5122C34 20.9567 26 20.0122 26 20.0122" stroke="currentColor" strokeWidth="6" />
      <path d="M22 20.0122C22 20.0122 28 19.0678 28 11.5122C28 3.95665 22 3.01221 22 3.01221" stroke="currentColor" strokeWidth="6.1" />
    </svg>
  );
}

/** Underline "U" — Jordan's supplied SVG (2026-09-26), #B4B4B4 switched to
 *  currentColor. Native viewBox 36×40; `size` sets the height. */
export function ToolbarUnderlineIcon({ size = 16 }: Props) {
  return (
    <svg
      width={(size * 36) / 40}
      height={size}
      viewBox="0 0 36 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M8 23.5C8 23.5 9.08783 31.0216 17.7942 31.2105C26.5005 31.3995 28 23.5 28 23.5" stroke="currentColor" strokeWidth="4" />
      <g fill="currentColor" stroke="currentColor">
        <rect x="6.5" y="4.5" width="3" height="19" />
        <rect x="26.5" y="4.5" width="3" height="19" />
        <rect x="22.5" y="0.5" width="11" height="3" rx="1.5" />
        <rect x="2.5" y="0.5" width="11" height="3" rx="1.5" />
        <rect x="0.5" y="36.5" width="35" height="3" rx="1.5" />
      </g>
    </svg>
  );
}

/** Link (chain) — Jordan's supplied SVG (2026-09-26), #B4B4B4 switched to
 *  currentColor. Square 38×38 viewBox. */
export function ToolbarLinkIcon({ size = 16 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M22.76 13.8485L13.3483 23.2603" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M27.966 20.9071L32.6718 16.2013C35.9206 12.9525 35.9206 7.68529 32.6718 4.43655C29.4231 1.18782 24.1559 1.18782 20.9071 4.43655L16.2013 9.14243M9.14243 16.2013L4.43655 20.9071C1.18782 24.1559 1.18782 29.4231 4.43655 32.6718C7.68529 35.9206 12.9525 35.9206 16.2013 32.6718L20.9071 27.966"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ToolbarItalicIcon({ size = 16, strokeWidth = 1.7 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M11.5 5h5.5M7 19h5.5M14.2 5 9.8 19" />
    </svg>
  );
}

export function ToolbarBulletListIcon({ size = 16, strokeWidth = 1.8 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <g fill="currentColor">
        <circle cx="4.75" cy="6.5" r="1.6" />
        <circle cx="4.75" cy="12" r="1.6" />
        <circle cx="4.75" cy="17.5" r="1.6" />
      </g>
      <path
        d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
