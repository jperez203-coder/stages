import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every route.
 *
 * Locked in Slice S8 — the OWASP A05 (Security Misconfiguration) gap
 * surfaced "no security headers in next.config.ts." These 5 headers are
 * statically-safe (no breaking-change risk; they refuse certain browser-
 * default behaviors rather than adding new behavior).
 *
 *   X-Content-Type-Options: nosniff
 *     Blocks browser MIME-sniffing. Prevents a .txt response with a
 *     misclassified Content-Type from being executed as a script.
 *
 *   X-Frame-Options: DENY
 *     Refuses framing by any origin. Hard clickjacking defense. We
 *     don't embed the app in iframes anywhere; if we ever do, switch
 *     to "SAMEORIGIN" or a CSP frame-ancestors directive.
 *
 *   Referrer-Policy: strict-origin-when-cross-origin
 *     When the user navigates from our app to an external link, the
 *     destination only sees our origin (not the full URL including
 *     workspace slug / pipeline id). Stops leaking workspace identifiers
 *     to whatever the user clicks to.
 *
 *   Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
 *     Forces HTTPS for 2 years. includeSubDomains covers any future
 *     subdomain. preload lets us submit to the browser-shipped HSTS
 *     preload list later if desired (the directive itself doesn't enroll
 *     us — that's a separate submission).
 *
 *   Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
 *     Denies these powerful browser features. We don't use any of them
 *     today (verified during Slice 0 Part 0.B audit — no
 *     navigator.geolocation, no getUserMedia, no Payment Request API).
 *     The empty allowlists mean even if a malicious iframe is somehow
 *     embedded (X-Frame-Options should prevent it, but defense in
 *     depth), it can't access these APIs.
 *
 * EXPLICITLY DEFERRED — full Content-Security-Policy:
 *
 *   A real CSP requires enumerating every script/style/image/font/
 *   connect origin the app loads from (Supabase, Stripe iframe, Google
 *   OAuth, our own dynamic imports, etc.) — and is easy to break with a
 *   single missing origin. WISHLIST'd as a follow-on with a "tighten
 *   from telemetry" plan: deploy permissively in report-only mode
 *   first, collect violation reports, then tighten. Slice S8 ships the
 *   5 statically-safe headers above; CSP work is its own sub-slice.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply baseline security headers to every route.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  experimental: {
    // Disable Turbopack's persistent on-disk cache for `next dev`.
    //
    // Background: Next 16.1+ enables the FileSystem cache by default for
    // dev (next dev writes incremental compilation state as SST — Sorted
    // String Table — files to .next/dev/cache/turbopack/...). When an
    // SST write is interrupted (machine sleep mid-flush, two next-dev
    // workers racing, or a sibling process wiping .next), the SST
    // headers can be left unreadable. Subsequent `next dev` starts then
    // crash with a Rust-side panic + ENOENT on build-manifest.json,
    // unrecoverable without `rm -rf .next` + restart.
    //
    // Hit this 3 times during Phase 4a step 5 — each costing ~10 min
    // of debugging + cache wipe + cold restart. The disk cache layer is
    // not worth it on a project this size: the cold-start time savings
    // (~500ms) are an order of magnitude smaller than the corruption
    // recovery cost.
    //
    // Setting this to `false`:
    //   * Keeps Turbopack itself ON (no speed regression on hot reload,
    //     no fallback to webpack)
    //   * Disables the on-disk SST cache layer — nothing is written to
    //     .next/dev/cache/turbopack/, so nothing can corrupt there
    //   * Cost: ~+500-800ms per `npm run dev` cold start (rebuilds the
    //     module graph from scratch instead of restoring from disk)
    //
    // REVISIT WHEN: Next.js hardens the SST cache format against
    // interrupted-write corruption — likely 16.3 or 16.4. When this
    // change can be reverted (flag deleted, default restored), the
    // PROGRESS.md note for 2026-05-21 documents the original symptoms
    // so any future maintainer can verify the fix took.
    //
    // Do NOT blindly re-enable this in a "speed it up" sweep without
    // first verifying the SST corruption class is fixed upstream.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
