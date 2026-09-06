"use client";

import { useId } from "react";

type Props = { size?: number; className?: string };

/**
 * "+" quick-create glyph — a true <circle> (smooth at any size) with the
 * plus cut out via a <mask>, rather than the original single hand-drawn
 * path (a circle approximated with bezier curves + a plus carved out via
 * fill-rule) that showed jagged/pixelated edges at small render sizes.
 * Same visual result, geometrically exact instead of curve-approximated.
 */
export function QuickCreateIcon({ size = 20, className = "" }: Props) {
  const maskId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
    >
      <mask id={maskId}>
        <rect width="20" height="20" fill="white" />
        <rect x="9" y="3.5" width="2" height="13" fill="black" />
        <rect x="3.5" y="9" width="13" height="2" fill="black" />
      </mask>
      <circle cx="10" cy="10" r="10" fill="#949599" mask={`url(#${maskId})`} />
    </svg>
  );
}
