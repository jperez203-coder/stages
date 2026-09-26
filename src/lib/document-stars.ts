/**
 * Same-tab signal that the signed-in user's starred documents changed
 * (the doc page's star toggle fires it; the sidebar's "Starred" section
 * listens and re-fetches from `document_stars`). Stars themselves live in
 * the database — per-user, see 20260906120000_document_stars.sql.
 */
export const DOCUMENT_STARS_CHANGE_EVENT = "stages:document-stars-change";

export function notifyDocumentStarsChanged(): void {
  window.dispatchEvent(new Event(DOCUMENT_STARS_CHANGE_EVENT));
}
