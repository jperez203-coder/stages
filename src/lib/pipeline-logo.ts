"use client";

import { supabase } from "@/lib/supabase";

/**
 * Uploads a pipeline (= "Company"/portal) logo image to the private
 * `pipeline_logos` bucket and points `pipelines.logo_path` at it. Mirrors
 * workspace-logo.ts exactly, scoped to a pipeline instead of a workspace —
 * see 20260911130000_pipeline_logo.sql for the RLS gate (can_edit_pipeline
 * instead of workspace-owner-only).
 *
 * Path convention: `{pipelineId}/logo.{ext}` — one logo per pipeline, so
 * re-uploading overwrites the same object via `upsert: true` rather than
 * accumulating orphaned files.
 */
export async function uploadPipelineLogo(
  pipelineId: string,
  file: File,
): Promise<{ path: string | null; error: Error | null }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${pipelineId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("pipeline_logos")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[pipeline-logo] upload failed:", uploadError.message);
    return { path: null, error: uploadError };
  }

  const { error: updateError } = await supabase
    .from("pipelines")
    .update({ logo_path: path })
    .eq("id", pipelineId);

  if (updateError) {
    console.error(
      "[pipeline-logo] pipelines.logo_path update failed:",
      updateError.message,
    );
    return { path: null, error: updateError };
  }

  return { path, error: null };
}

/**
 * Signed URL for a pipeline_logos object — same private-bucket +
 * signed-URL pattern as createWorkspaceLogoSignedUrl. RLS-gated: a caller
 * without pipeline visibility can't mint a URL for its logo.
 */
export async function createPipelineLogoSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from("pipeline_logos")
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    console.error("[pipeline-logo] createSignedUrl failed:", error?.message);
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
