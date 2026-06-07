import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Shared chrome for public legal pages (/privacy, /terms).
 *
 * Renders:
 *   - Top: a thin back-to-app link.
 *   - Pre-legal-review banner (locked copy — see Slice S7).
 *   - The page content (centered, max-width prose width).
 *   - Footer: cross-link to the sibling legal page + locked disclaimer.
 *
 * Both pages render without authentication. The (legal) route group
 * is invisible in URLs — /privacy and /terms resolve directly.
 *
 * Aesthetic: dark mode + stages-purple accents (matches Slice 0.1's
 * OwnerOnlyPill styling for visual continuity with the in-app AI
 * features surface).
 */
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-stages-bg text-zinc-100 antialiased dotted-grid">
      {/* Top bar */}
      <header className="border-b border-zinc-800/60">
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="text-[14px] font-semibold text-zinc-100 hover:text-zinc-200 transition-colors"
          >
            Stages
          </Link>
          <Link
            href="/"
            className="text-[13px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Back to app
          </Link>
        </div>
      </header>

      {/* Pre-legal-review banner */}
      <div
        className="border-b"
        style={{
          background: "rgba(245, 158, 11, 0.08)",
          borderBottomColor: "rgba(245, 158, 11, 0.25)",
        }}
      >
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 py-3 flex items-start gap-3">
          <AlertTriangle
            size={16}
            className="text-stages-amber flex-shrink-0 mt-0.5"
            strokeWidth={2}
          />
          <p className="text-[13px] text-zinc-300 leading-snug">
            <span className="font-semibold text-zinc-100">
              This document is pending professional legal review.
            </span>{" "}
            We&apos;ve published it to set expectations honestly while we engage
            counsel; the substantive commitments are accurate to the
            system&apos;s current behavior, but specific language may be refined.
            Last reviewed by: pending — engaging legal review.
          </p>
        </div>
      </div>

      {/* Page content */}
      <main className="max-w-[1080px] mx-auto px-4 sm:px-6 py-10">
        {children}
      </main>

      {/* Footer with cross-link + disclaimer */}
      <footer className="border-t border-zinc-800/60 mt-12">
        <div className="max-w-[1080px] mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
            <div className="flex gap-5 text-[13px]">
              <Link
                href="/privacy"
                className="text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Terms of Service
              </Link>
              <Link
                href="/"
                className="text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Back to app
              </Link>
            </div>
            <div className="text-[12.5px] text-zinc-500">
              © 2026 SalesEdge LLC d/b/a Stages
            </div>
          </div>
          <p className="text-[12px] text-zinc-500 leading-relaxed italic">
            This document does not constitute legal advice. We recommend
            customers consult their own counsel regarding any contractual
            obligations described herein.
          </p>
        </div>
      </footer>
    </div>
  );
}
