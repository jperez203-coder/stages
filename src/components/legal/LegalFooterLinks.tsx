import Link from "next/link";

/**
 * Compact link row for the bottom of public-facing surfaces (signin,
 * signup, landing). Provides discoverability of the legal pages from
 * unauthenticated routes per Slice S7's "publicly discoverable" bar.
 *
 * Not used inside authenticated workspace surfaces — those have their
 * own chrome and the in-workspace Privacy tab (Slice 0.1) is the more
 * direct path.
 *
 * Variants:
 *   - default: "Privacy · Terms" + © line
 *   - signup:  ALSO renders an above-the-fold consent microcopy line
 *              that the SignUpPanel's submit button is positioned near
 *              (the microcopy itself lives inside SignUpPanel.tsx for
 *              proximity to the button; this footer is just discoverability)
 */
export function LegalFooterLinks() {
  return (
    <footer className="mt-12 mb-6">
      <div className="max-w-[440px] mx-auto px-4 flex flex-col items-center gap-2">
        <div className="flex gap-4 text-[12.5px]">
          <Link
            href="/privacy"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Privacy
          </Link>
          <span className="text-zinc-700">·</span>
          <Link
            href="/terms"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Terms
          </Link>
        </div>
        <div className="text-[11px] text-zinc-600">
          © 2026 SalesEdge LLC d/b/a Stages
        </div>
      </div>
    </footer>
  );
}
