/**
 * Builds a canonical storage path for the `pipeline_files` bucket.
 * Phase 4b-3-b.
 *
 * Path shape: `{pipelineId}/{uuid}.{ext}` (or `{pipelineId}/{uuid}` if
 * the file has no extension).
 *
 * Why this shape:
 *   * The storage INSERT RLS policy (20260509120000) extracts the
 *     pipeline UUID from the FIRST folder segment via
 *     `(storage.foldername(name))[1]::uuid` and calls
 *     `can_edit_pipeline(...)`. If the path doesn't start with a
 *     valid pipeline UUID the caller can edit, the upload is
 *     rejected. This helper guarantees the correct shape.
 *   * The UUID prevents collisions when two users upload identically-
 *     named files to the same pipeline (e.g., "Brief.pdf" twice). Each
 *     upload gets a fresh UUID; the original file_name is stored in
 *     pipeline_links.file_name for display.
 *   * Preserving the extension when present helps the browser sniff
 *     MIME from the URL (signed-URL fetches use the extension as a
 *     fallback) and gives nicer-looking signed-URL paths.
 *
 * Pure function — no imports, no side effects, no Supabase
 * dependency. Safe to call from any context (browser or server).
 */
export function buildStoragePath(
  pipelineId: string,
  fileName: string,
): string {
  const id = crypto.randomUUID();
  const dotIdx = fileName.lastIndexOf(".");
  const rawExt = dotIdx > 0 ? fileName.slice(dotIdx + 1).toLowerCase() : "";
  // Sanitize to alphanumeric — avoid weird unicode / spaces / symbols
  // that storage might reject or that would mangle URLs. Empty result
  // after sanitization → treat as no-extension.
  const safeExt = rawExt.replace(/[^a-z0-9]/g, "");
  return safeExt ? `${pipelineId}/${id}.${safeExt}` : `${pipelineId}/${id}`;
}
