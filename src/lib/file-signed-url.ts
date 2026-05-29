"use client";

import { supabase } from "@/lib/supabase";

/**
 * Generates a time-limited signed URL for a `pipeline_files` storage
 * object. Phase 4b-3-b — used for both image/PDF previews and "other
 * type" downloads.
 *
 * RLS-gated (the critical security property):
 *   `supabase.storage.createSignedUrl()` evaluates
 *   `pipeline_files_storage_select` against the calling user's session
 *   BEFORE signing. If the caller can't SELECT the underlying
 *   storage.objects row, no URL is minted — error is returned. This
 *   means a client viewer can't even MINT a signed URL for an
 *   internal file, never mind fetch it.
 *
 *   So this helper is safe to call from anywhere (agency or portal).
 *   The same call site in 4b-3-c (portal) returns errors for paths
 *   the client isn't authorized for; no extra gating needed.
 *
 * TTL defaults to 1 hour. Trade-off:
 *   * Shorter (5-15 min) = tighter leak window if a URL escapes
 *   * Longer (hours) = fewer regeneration round-trips for long sessions
 *   1 hour is a reasonable middle ground; bump shorter for the portal
 *   if there's a real leak-concern signal later.
 */

/**
 * Optional second-arg shape for createPipelineFileSignedUrl.
 *
 * `download`:
 *   * `string` — Supabase serves the file with
 *     `Content-Disposition: attachment; filename="<string>"`. Browser
 *     downloads with the given filename regardless of origin.
 *   * `true` — same but uses the storage object's original name
 *     (which for us is a UUID — ugly; prefer passing the file_name
 *     string when available).
 *   * omitted / undefined / false — no Content-Disposition header;
 *     the browser displays inline if it knows the MIME (preview path).
 *
 * Why this matters (the bug it fixes):
 *   The HTML `<a download="...">` attribute is IGNORED by browsers for
 *   cross-origin URLs unless the response itself includes a matching
 *   Content-Disposition header. Supabase signed URLs are on a different
 *   origin (project.supabase.co) than our app, so a bare <a download>
 *   gets ignored — the browser navigates to the URL and renders the
 *   file inline. Passing this `download` option to createSignedUrl
 *   makes Supabase add the header server-side, so the response forces
 *   a download regardless of the cross-origin policy.
 */
type SignedUrlOptions = {
  download?: string | true;
};

export async function createPipelineFileSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
  options?: SignedUrlOptions,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  // Supabase's createSignedUrl accepts an options object as its 3rd arg
  // with { download?: string | boolean, transform?: ... }. We pass
  // through whatever the caller provided; omitting it preserves the
  // inline-preview behavior (used by FilePreview for image lightbox +
  // PDF iframe).
  const { data, error } = await supabase
    .storage
    .from("pipeline_files")
    .createSignedUrl(storagePath, expiresInSeconds, options);

  if (error) {
    console.error(
      "[file-signed-url] createSignedUrl failed:",
      error?.message,
    );
    return { signedUrl: null, error };
  }

  if (!data?.signedUrl) {
    return {
      signedUrl: null,
      error: new Error("Signed URL response missing signedUrl field"),
    };
  }

  return { signedUrl: data.signedUrl, error: null };
}

/**
 * Trigger a browser download for a pipeline_files object.
 * Phase 4b-3-b: extracted so the explicit FileRow Download button AND
 * the FilesBody row-click fallback (for non-previewable types) share
 * one implementation. Reused unchanged by 4b-3-c (portal Files tab).
 *
 * Pattern: mint a signed URL WITH the `download` option (which makes
 * the response carry `Content-Disposition: attachment; filename="…"`),
 * then click a temporary anchor pointing at that URL. The browser sees
 * the Content-Disposition header and downloads — does NOT navigate the
 * current page even though the URL is cross-origin (a bare <a download>
 * pointed at a cross-origin URL would navigate + render inline because
 * the download attribute is cross-origin-ignored; the server-side
 * header is what works universally).
 *
 * The `download` attribute on the anchor is left on as a same-origin
 * fallback / hint but is functionally redundant — the response header
 * is doing the work.
 *
 * RLS guarantee inherited from createPipelineFileSignedUrl: if the
 * caller can't read the storage object, no URL is minted → no download
 * happens. Safe to call from any surface (agency OR client portal).
 *
 * Returns { error: null } on success, { error } on failure. The caller
 * surfaces the error to the user (typically via an inline error banner);
 * this helper does not display its own UI.
 */
export async function triggerFileDownload(
  storagePath: string,
  fileName: string | null,
): Promise<{ error: Error | null }> {
  const { signedUrl, error } = await createPipelineFileSignedUrl(
    storagePath,
    3600,
    // Force download via Content-Disposition: attachment header. When
    // fileName is null (rare; agency could upload without one), pass
    // `true` to fall back to the storage object's own name (a UUID).
    { download: fileName ?? true },
  );
  if (error || !signedUrl) {
    return {
      error: error ?? new Error("Couldn't generate download URL"),
    };
  }
  const a = document.createElement("a");
  a.href = signedUrl;
  a.download = fileName ?? "download";
  // Append → click → remove so the link isn't left in the DOM. Some
  // browsers ignore the download attribute on detached anchors; this
  // attach-then-click pattern works across Chrome/Firefox/Safari.
  // (The Content-Disposition header on the signed URL is what actually
  //  forces the download cross-origin; this attribute is a no-op /
  //  hint in that case but kept for same-origin safety.)
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return { error: null };
}
