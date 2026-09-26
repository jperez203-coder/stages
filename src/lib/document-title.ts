/**
 * Same-tab signal that a document's title changed — fired by the doc page
 * title input and by the sidebar's inline Rename, so whichever one didn't
 * make the change updates its copy immediately (the DB write itself is
 * done by whoever fired it).
 */
export const DOCUMENT_RENAMED_EVENT = "stages:document-renamed";

export type DocumentRenamedDetail = { id: string; title: string };

export function notifyDocumentRenamed(id: string, title: string): void {
  window.dispatchEvent(
    new CustomEvent<DocumentRenamedDetail>(DOCUMENT_RENAMED_EVENT, { detail: { id, title } }),
  );
}
