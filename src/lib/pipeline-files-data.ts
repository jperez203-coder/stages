import type { createSupabaseServerClient } from "./supabase-server";

/**
 * Server-side fetch for the pipeline-level files list. Phase 4b-3-b.
 * Shared shape — reused by the portal Files tab in 4b-3-c.
 *
 * RLS handles the agency-vs-client filter at the DB layer:
 *   pipeline_links_select: `is_pipeline_agency_member(pipeline_id)
 *     OR (is_pipeline_client(pipeline_id) AND client_visible = true)`
 *
 * So this helper just SELECTs as the caller. For agency members the
 * full set comes back; for clients (in 4b-3-c) only client_visible
 * rows return. No conditional UI filter needed on either surface.
 *
 * Ordering: most-recent first (added_at DESC) so newly-uploaded files
 * land at the top of the list — matches user expectation for any
 * file-management UI.
 */

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type FileItem = {
  id: string;
  /** Discriminant: 'file' = uploaded to pipeline_files bucket (has
   *  storage_path); 'url' = external link (has url). The DB CHECK
   *  constraint enforces exactly one of {storage_path, url} per kind. */
  kind: "url" | "file";
  /** Human-friendly label. For links, usually required (the UI gates
   *  the add-link save on non-empty). For files, optional — falls
   *  back to file_name in the row's display label resolution. */
  label: string | null;
  /** kind='url' only: the external URL. Always present for url rows,
   *  always null for file rows (per the DB payload constraint). */
  url: string | null;
  /** kind='file' only: the bucket path. Always present for file rows,
   *  always null for url rows. */
  storage_path: string | null;
  /** Original file name as uploaded — for display + as the suggested
   *  download filename. Null for kind='url'. */
  file_name: string | null;
  /** Bytes. Null for kind='url'. */
  file_size: number | null;
  /** MIME from File.type at upload (browser-sniffed). Null for
   *  kind='url' OR when the browser couldn't determine the MIME.
   *  The UI uses this to dispatch image/* → lightbox,
   *  application/pdf → iframe, everything else → download. */
  mime_type: string | null;
  /** Whether clients can see this row. Defaults to false at INSERT.
   *  The visibility toggle in FileRow flips it; the same RLS gates
   *  the toggle (uploader OR can_edit_pipeline). */
  client_visible: boolean;
  /** Original uploader's user_id. Used for the "uploader OR can_edit"
   *  branch of the UPDATE/DELETE RLS — and the UI's canEdit gate
   *  (members can manage their own uploads even without
   *  can_edit_pipeline). Null if the user has been deleted. */
  added_by: string | null;
  /** ISO timestamp. */
  added_at: string;
};

export async function fetchPipelineFiles(
  supabase: SupabaseServerClient,
  pipelineId: string,
): Promise<FileItem[]> {
  const { data, error } = await supabase
    .from("pipeline_links")
    .select(
      "id, kind, label, url, storage_path, file_name, file_size, mime_type, client_visible, added_by, added_at",
    )
    .eq("pipeline_id", pipelineId)
    .order("added_at", { ascending: false });

  if (error) {
    console.error("[pipeline-files] fetch failed:", error);
    return [];
  }

  return (data ?? []) as FileItem[];
}
