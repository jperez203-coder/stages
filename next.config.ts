import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
