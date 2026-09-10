"use client";

/**
 * sessionStorage cache for workspace logo signed URLs. Without this, every
 * mount of HeaderWorkspaceSwitcher (a page refresh, or the sidebar toggle
 * — which unmounts/remounts the switcher along with it) starts with an
 * empty logoUrlsByWorkspaceId map, so the generated "#" tile flashes
 * briefly before the signed URL round-trip resolves. Caching the URL
 * (keyed to the exact logoPath, so a re-upload invalidates it) lets a
 * remount read a still-valid URL synchronously instead of waiting on the
 * network.
 *
 * TTL is shorter than the signed URL's own 3600s lifetime (see
 * createWorkspaceLogoSignedUrl) so a cached entry is never served past
 * the point where Supabase would reject it.
 */

const TTL_MS = 55 * 60 * 1000;

type CacheEntry = { url: string; logoPath: string; expiresAt: number };

function storageKey(workspaceId: string): string {
  return `stages:workspace-logo:${workspaceId}`;
}

export function getCachedLogoUrl(
  workspaceId: string,
  logoPath: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(workspaceId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.logoPath !== logoPath || entry.expiresAt < Date.now()) {
      return null;
    }
    return entry.url;
  } catch {
    return null;
  }
}

export function setCachedLogoUrl(
  workspaceId: string,
  logoPath: string,
  url: string,
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry = { url, logoPath, expiresAt: Date.now() + TTL_MS };
    window.sessionStorage.setItem(storageKey(workspaceId), JSON.stringify(entry));
  } catch {
    // Storage full/unavailable (private browsing, etc.) — the cache is a
    // pure optimization, so just skip it silently.
  }
}
