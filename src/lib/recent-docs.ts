/**
 * Sidebar "Recents" — the last few docs/sheets the signed-in user opened
 * in a workspace, newest first.
 *
 * Stored per browser in localStorage (keyed by user + workspace), not in
 * the database: it's a per-viewer convenience, so it doesn't sync across
 * devices. Only document ids are stored — titles/types come from the
 * sidebar's live `documents` list, so renames show up immediately and
 * deleted docs simply drop out.
 *
 * Exposed as a tiny external store so the Sidebar can read it with
 * useSyncExternalStore (no setState-in-effect) and re-render the moment a
 * doc is recorded, in this tab or another one.
 */

export const RECENT_DOCS_LIMIT = 5;
// Keep a few more ids than we show, so deleting a recent doc still
// leaves 5 to display.
const STORED_LIMIT = 20;
const CHANGE_EVENT = "stages:recent-docs-change";

function storageKey(userId: string, workspaceId: string): string {
  return `stages:recentDocs:${userId}:${workspaceId}`;
}

/** Raw stored string (stable for useSyncExternalStore's snapshot compare). */
export function readRecentDocsRaw(userId: string | null, workspaceId: string | null): string {
  if (!userId || !workspaceId) return "";
  try {
    return window.localStorage.getItem(storageKey(userId, workspaceId)) ?? "";
  } catch {
    return "";
  }
}

export function parseRecentDocIds(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Move `docId` to the front of the user's recents for this workspace. */
export function recordRecentDoc(userId: string, workspaceId: string, docId: string): void {
  try {
    const key = storageKey(userId, workspaceId);
    const current = parseRecentDocIds(window.localStorage.getItem(key) ?? "");
    if (current[0] === docId) return;
    const next = [docId, ...current.filter((id) => id !== docId)].slice(0, STORED_LIMIT);
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage blocked (private mode, quota) — Recents just stays as-is.
  }
}

export function subscribeRecentDocs(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  // Other tabs write → the native `storage` event fires here.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
