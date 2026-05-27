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
 *
 * Uploader profile join — TWO-QUERY PATTERN (locked):
 *   pipeline_links.added_by references auth.users(id), NOT
 *   public.profiles(id). PostgREST's nested
 *   `added_by_profile:profiles!inner(...)` returns 0 rows because the
 *   schema has no direct FK between the two. Same forever-rule as
 *   canvas-chrome-data.ts and chat-data.ts. We collect distinct
 *   added_by uuids, batch SELECT profiles, in-memory join.
 *
 *   Profile RLS coverage:
 *     * Agency-side callers see uploader profiles via the existing
 *       workspace-membership + pipeline-membership branches.
 *     * Client-side callers (4b-3-c portal) see them via branches 5
 *       (users_share_pipeline) and 6 (caller_pipeline_in_workspace_
 *       owned_by) added in migrations 20260527120000 + 20260529120000.
 *
 *   If a profile isn't readable (RLS denies for some unexpected
 *   relationship OR the user has been deleted), added_by_profile is
 *   null — the card falls back to a placeholder avatar + "Pending
 *   member" label, same pattern chat uses for un-resolvable authors.
 */

type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export type UploaderProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
};

export type FileItem = {
  id: string;
  /** Discriminant: 'file' = uploaded to pipeline_files bucket (has
   *  storage_path); 'url' = external link (has url). The DB CHECK
   *  constraint enforces exactly one of {storage_path, url} per kind. */
  kind: "url" | "file";
  /** Task this row is attached to. Null = pipeline-scoped (Files tab
   *  default). Non-null = task-scoped (still appears on the Files tab
   *  with a "from: <task title>" badge AND inside that task's
   *  attachments section). */
  task_id: string | null;
  /** Joined task title for the badge on the Files tab. Populated by
   *  this fetch via a batched SELECT on tasks. Null when task_id is
   *  null, OR when RLS denies the task read (defense-in-depth — the
   *  same RLS that hides the parent task would also hide its
   *  attachments via pipeline_links_select gating on pipeline_id, so
   *  in practice this should only be null for pipeline-scoped rows). */
  task_title: string | null;
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
   *  The UI uses this to dispatch image/* → lightbox / inline thumb,
   *  application/pdf → iframe / inline embed,
   *  everything else → download-only. */
  mime_type: string | null;
  /** Whether clients can see this row. Defaults to false at INSERT.
   *  The visibility toggle in FileCard flips it; the same RLS gates
   *  the toggle (uploader OR can_edit_pipeline). */
  client_visible: boolean;
  /** Original uploader's user_id. Null if the user has been deleted. */
  added_by: string | null;
  /** Joined profile for the uploader. Null when added_by is null OR
   *  when RLS denies the profile read (defense-in-depth — would only
   *  trigger in edge cases). */
  added_by_profile: UploaderProfile | null;
  /** ISO timestamp. */
  added_at: string;
};

export async function fetchPipelineFiles(
  supabase: SupabaseServerClient,
  pipelineId: string,
): Promise<FileItem[]> {
  // 1. Files
  const { data: filesData, error: filesErr } = await supabase
    .from("pipeline_links")
    .select(
      "id, kind, label, url, storage_path, file_name, file_size, mime_type, client_visible, added_by, added_at, task_id",
    )
    .eq("pipeline_id", pipelineId)
    .order("added_at", { ascending: false });

  if (filesErr) {
    console.error("[pipeline-files] files fetch failed:", filesErr);
    return [];
  }

  const rawFiles = (filesData ?? []) as Array<
    Omit<FileItem, "added_by_profile" | "task_title">
  >;

  // 2. Batch uploader profiles. Same forever-pattern as chat-data.ts /
  //    canvas-chrome-data.ts — no nested PostgREST join because
  //    added_by → auth.users, not profiles.
  const uploaderIds = Array.from(
    new Set(
      rawFiles
        .map((f) => f.added_by)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const profilesRes = uploaderIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email")
        .in("id", uploaderIds)
    : { data: [], error: null };

  if (profilesRes.error) {
    console.error(
      "[pipeline-files] profile fetch failed (will fall back to null profiles):",
      profilesRes.error,
    );
  }

  const profileById = new Map<string, UploaderProfile>();
  for (const p of (profilesRes.data ?? []) as UploaderProfile[]) {
    profileById.set(p.id, p);
  }

  // 3. Batch task titles for task-scoped rows. Same two-query pattern
  //    as the uploader-profile join — task_id refs tasks(id), so
  //    PostgREST nested joins would work, but going through the same
  //    explicit batch pattern keeps fallback semantics consistent
  //    (denied row → null title → no badge, instead of mystery empty
  //    string). Task RLS gates on stage→pipeline membership; in
  //    practice the same caller that can read the pipeline_links row
  //    can read the task title.
  const taskIds = Array.from(
    new Set(
      rawFiles
        .map((f) => f.task_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const tasksRes = taskIds.length
    ? await supabase.from("tasks").select("id, title").in("id", taskIds)
    : { data: [], error: null };

  if (tasksRes.error) {
    console.error(
      "[pipeline-files] task fetch failed (badges will not render):",
      tasksRes.error,
    );
  }

  const taskTitleById = new Map<string, string>();
  for (const t of (tasksRes.data ?? []) as Array<{
    id: string;
    title: string;
  }>) {
    taskTitleById.set(t.id, t.title);
  }

  // 4. In-memory join — uploader profile + task title.
  return rawFiles.map((f) => ({
    ...f,
    added_by_profile: f.added_by
      ? (profileById.get(f.added_by) ?? null)
      : null,
    task_title: f.task_id ? (taskTitleById.get(f.task_id) ?? null) : null,
  }));
}
