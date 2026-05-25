/**
 * Normalize a user-entered URL for safe linking.
 *
 * Bare domains like "facebook.com" and "www.facebook.com" are treated
 * as relative paths by the browser, so `window.open("facebook.com")`
 * navigates to `<app-origin>/facebook.com` and 404s. Prepending
 * `https://` makes them absolute.
 *
 * Rules:
 *   - Trim whitespace.
 *   - Empty / whitespace-only input → null (caller should reject).
 *   - Already starts with `http://` or `https://` (case-insensitive) → pass through unchanged.
 *   - Anything else → prepend `https://`.
 *
 * Examples:
 *   "facebook.com"           → "https://facebook.com"
 *   "www.facebook.com"       → "https://www.facebook.com"
 *   "http://example.com"     → "http://example.com"
 *   "https://example.com"    → "https://example.com"
 *   "HTTPS://Example.com"    → "HTTPS://Example.com"
 *   "  "                     → null
 *
 * Intentionally light. We don't try to validate that the host actually
 * resolves — if the agency typos a domain, they'll notice on the first
 * click. The fix here is specifically the protocol-prefix bug, not
 * general URL validation.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
