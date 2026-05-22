import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { RecentlyDoneView } from "@/components/my-tasks/RecentlyDoneView";
import type { TaskWithMeta } from "@/components/my-tasks/types";

/**
 * /w/[slug]/my-tasks/recently-done — companion to /my-tasks. Lists tasks
 * assigned to the current user, completed within the last 7 days. No
 * "dismiss" / "restore" concept — completion is the only signal, the
 * 7-day rolling window is the only filter. Permanent delete lives in
 * the task detail panel (step 6) with a confirm.
 *
 * Filter (storage-free):
 *   assignee_id = auth.uid()
 *   AND completed_at >= now() - interval '7 days'
 *   ORDER BY completed_at DESC
 *
 * Replaces the earlier /archived route + tasks.dismissed_at column.
 * That design layered a per-user dismiss flag on top of completion;
 * this one drops the flag entirely and trusts completed_at to be the
 * single source of truth.
 *
 * Reuses the same auth + redirect rules as the parent /my-tasks route.
 */

export const dynamic = "force-dynamic";

export default async function MyTasksRecentlyDonePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/w/${encodeURIComponent(slug)}/my-tasks/recently-done`,
    );
  }

  // Workspace membership check (same shape as /my-tasks page).
  const wsMembershipResult = await supabase
    .from("workspace_memberships")
    .select(`role, workspace:workspaces!inner(id, name, slug)`)
    .eq("user_id", user.id)
    .eq("workspace.slug", slug)
    .maybeSingle();

  type WsRow = { id: string; name: string; slug: string };
  const wsRaw = wsMembershipResult.data?.workspace as unknown;
  const ws: WsRow | null = Array.isArray(wsRaw)
    ? ((wsRaw[0] as WsRow | undefined) ?? null)
    : ((wsRaw as WsRow | null) ?? null);

  if (!wsMembershipResult.data || !ws) {
    // Non-member fallback — same chain as /my-tasks. Clients have no
    // /my-tasks surface, so /recently-done doesn't make sense for them
    // either.
    redirect("/");
  }

  // 7-day rolling cutoff. Computed server-side at request time so the
  // window slides naturally — no cron / cleanup needed. Server-UTC
  // boundary (same caveat as the today-boundary helper; migrates to
  // user-TZ when the TZ-cookie fix ships).
  const sevenDaysAgoIso = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  // Same nested-select shape as the /my-tasks query so the row render
  // can reuse the TaskWithMeta type. PostgREST FK disambiguation on
  // stages↔pipelines (two FKs between them, see CLAUDE.md / lessons).
  const tasksRes = await supabase
    .from("tasks")
    .select(
      `id, title, deadline, completed_at, done, created_at, stage_id,
       stage:stages!inner(
         id, name, color, position, pipeline_id,
         pipeline:pipelines!stages_pipeline_id_fkey!inner(id, name, emoji, workspace_id)
       )`,
    )
    .eq("assignee_id", user.id)
    .eq("stage.pipeline.workspace_id", ws.id)
    .not("completed_at", "is", null)
    .gte("completed_at", sevenDaysAgoIso)
    .order("completed_at", { ascending: false });

  type StageJoin = {
    id: string;
    name: string;
    color: string | null;
    position: number;
    pipeline_id: string;
    pipeline:
      | { id: string; name: string; emoji: string | null; workspace_id: string }
      | Array<{
          id: string;
          name: string;
          emoji: string | null;
          workspace_id: string;
        }>;
  };
  const flattenStage = (s: unknown) => {
    const obj = (Array.isArray(s) ? s[0] : s) as StageJoin | undefined;
    if (!obj) return null;
    const p = Array.isArray(obj.pipeline) ? obj.pipeline[0] : obj.pipeline;
    return {
      id: obj.id,
      name: obj.name,
      color: obj.color,
      position: obj.position,
      pipelineId: obj.pipeline_id,
      pipelineName: p?.name ?? "",
      pipelineEmoji: p?.emoji ?? null,
    };
  };

  const tasks: TaskWithMeta[] = (tasksRes.data ?? [])
    .map((t) => {
      const stage = flattenStage(t.stage);
      if (!stage) return null;
      return {
        id: t.id,
        title: t.title,
        deadline: t.deadline as string | null,
        completedAt: t.completed_at as string | null,
        done: t.done as boolean,
        createdAt: t.created_at as string,
        stage,
      };
    })
    .filter((t): t is TaskWithMeta => t !== null);

  return (
    <RecentlyDoneView
      workspaceSlug={ws.slug}
      tasks={tasks}
      fetchError={tasksRes.error?.message ?? null}
    />
  );
}
