"use client";

import { supabase } from "@/lib/supabase";

/**
 * Uploads a workspace logo image to the private `workspace_logos` bucket
 * and points `workspaces.logo_path` at it.
 *
 * Path convention: `{workspaceId}/logo.{ext}` — one logo per workspace, so
 * re-uploading overwrites the same object via `upsert: true` rather than
 * accumulating orphaned files.
 *
 * RLS on both the bucket (workspace_logos_storage_insert/update) and the
 * `workspaces` row (workspaces_update) require the caller to be the
 * workspace owner — this helper doesn't re-check that client-side, it
 * relies on the database rejecting an unauthorized caller.
 */
export async function uploadWorkspaceLogo(
  workspaceId: string,
  file: File,
): Promise<{ path: string | null; error: Error | null }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${workspaceId}/logo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("workspace_logos")
    .upload(path, file, { contentType: file.type, upsert: true });

  if (uploadError) {
    console.error("[workspace-logo] upload failed:", uploadError.message);
    return { path: null, error: uploadError };
  }

  const { error: updateError } = await supabase
    .from("workspaces")
    .update({ logo_path: path })
    .eq("id", workspaceId);

  if (updateError) {
    console.error(
      "[workspace-logo] workspaces.logo_path update failed:",
      updateError.message,
    );
    return { path: null, error: updateError };
  }

  return { path, error: null };
}

/**
 * Signed URL for a workspace_logos object — same private-bucket +
 * signed-URL pattern as createPipelineFileSignedUrl (see
 * src/lib/file-signed-url.ts). RLS-gated: a caller who isn't a member of
 * the owning workspace can't mint a URL for its logo.
 */
export async function createWorkspaceLogoSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<{ signedUrl: string | null; error: Error | null }> {
  const { data, error } = await supabase.storage
    .from("workspace_logos")
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error) {
    console.error(
      "[workspace-logo] createSignedUrl failed:",
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
