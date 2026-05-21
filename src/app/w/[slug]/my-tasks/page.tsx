import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { MyTasksView } from "@/components/my-tasks/MyTasksView";
import type { TaskWithMeta, PipelineLite } from "@/components/my-tasks/types";

/**
 * /w/[slug]/my-tasks — Phase 4a step 4. The full My Tasks view.
 *
 * Server component, all initial data fetched at page level. Buckets +
 * filtering happen CLIENT-side on the prefetched list so chips, search,
 * and hide-completed don't trigger refetches.
 *
 * Auth + redirect rules mirror the dashboard (/w/[slug] page.tsx):
 *   * Anon → /auth/signin?next=/w/[slug]/my-tasks
 *   * Client-only here → /portal/[first-pipeline-id]
 *   * Non-member with last_active_workspace_id elsewhere → /w/[that-slug]
 *   * Else → / (workspace selector)
 *
 * Data fetched:
 *   * All tasks assigned to current user in this workspace (id, title,
 *     deadline, completed_at, stage_id) joined to stage (id, name,
 *     position, color, pipeline_id) and pipeline (id, name, emoji).
 *   * Pipelines list for the quick-add picker (id, name, emoji), with
 *     each pipeline's stages so the client can pick the current stage
 *     for new tasks per the locked 3-state derivation.
 */

export const dynamic = "force-dynamic";

export default async function MyTasksPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  // ── Auth gate ──────────────────────────────────────────────────────────
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(`/auth/signin?next=/w/${encodeURIComponent(slug)}/my-tasks`);
  }

  // ── Workspace membership check ─────────────────────────────────────────
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
    // Not a workspace member. Check for client membership in this workspace.
    const clientResult = await supabase
      .from("pipeline_memberships")
      .select(
        `pipeline_id, pipeline:pipelines!inner(workspace_id, workspace:workspaces!inner(slug))`,
      )
      .eq("user_id", user.id)
      .eq("role", "client")
      .eq("pipeline.workspace.slug", slug)
      .limit(1)
      .maybeSingle();

    if (clientResult.data) {
      redirect(`/portal/${clientResult.data.pipeline_id}`);
    }

    // Try last_active_workspace_id.
    const profileResult = await supabase
      .from("profiles")
      .select("last_active_workspace_id")
      .eq("id", user.id)
      .maybeSingle();

    const lastActiveId = profileResult.data?.last_active_workspace_id;
    if (lastActiveId) {
      const lastWsResult = await supabase
        .from("workspaces")
        .select("slug")
        .eq("id", lastActiveId)
        .maybeSingle();
      if (lastWsResult.data?.slug && lastWsResult.data.slug !== slug) {
        redirect(`/w/${lastWsResult.data.slug}`);
      }
    }

    redirect("/");
  }

  // ── Data fetch (parallel) ──────────────────────────────────────────────
  // Same PostgREST disambiguation as the dashboard:
  // `pipelines!stages_pipeline_id_fkey!inner` selects the parent-FK side
  // of the stages↔pipelines two-FK relationship (the back-pointer from
  // pipelines.current_stage_id is the other FK).
  const [
    profileRes,
    pipelinesRes,
    tasksRes,
    stagesRes,
    workspaceTasksRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("last_active_pipeline_id, display_name")
      .eq("id", user.id)
      .single(),

    // Pipelines list for the quick-add picker.
    supabase
      .from("pipelines")
      .select("id, name, emoji, last_edited_at")
      .eq("workspace_id", ws.id)
      .order("name", { ascending: true }),

    // All tasks assigned to current user in this workspace that aren't
    // completed-before-today. End-of-day auto-hide threshold uses
    // server-UTC midnight (current_date), same caveat as the bucketing
    // logic — migrates to user-TZ via the cookie fix when that ships.
    //
    // Completed-before-today tasks are not gone — they surface in
    // /my-tasks/recently-done with a rolling 7-day window. There is no
    // "dismiss" affordance on this view; permanent delete lives in the
    // task detail panel (step 6) with a confirm.
    supabase
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
      .or(
        `completed_at.is.null,completed_at.gte.${new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          new Date().getDate(),
        ).toISOString()}`,
      ),

    // Stages list for quick-add's current-stage derivation. Bounded by
    // workspace so the result stays small.
    supabase
      .from("stages")
      .select(
        `id, pipeline_id, position, name, color,
         pipeline:pipelines!stages_pipeline_id_fkey!inner(workspace_id)`,
      )
      .eq("pipeline.workspace_id", ws.id)
      .order("position", { ascending: true }),

    // Workspace-wide task counts for the same current-stage derivation
    // (matches the dashboard's algorithm so quick-add lands tasks in
    // the visibly "active" stage).
    supabase
      .from("tasks")
      .select(
        `id, done, stage_id,
         stage:stages!inner(pipeline_id, pipeline:pipelines!stages_pipeline_id_fkey!inner(workspace_id))`,
      )
      .eq("stage.pipeline.workspace_id", ws.id),
  ]);

  // ── Flatten task rows ──────────────────────────────────────────────────
  // PostgREST nested-select typing returns the join as either object or
  // array depending on codegen heuristic; normalize via Array.isArray.
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

  // ── Per-pipeline current-stage derivation (for quick-add) ─────────────
  // Same locked rule the dashboard uses: highest-position stage with any
  // completed task, falling back to position-1 when nothing's done. Drop
  // into the pipeline list passed to the quick-add picker.
  const stages = stagesRes.data ?? [];
  const workspaceTasks = workspaceTasksRes.data ?? [];

  const stageCounts = new Map<string, { total: number; completed: number }>();
  for (const t of workspaceTasks) {
    const sc = stageCounts.get(t.stage_id) ?? { total: 0, completed: 0 };
    sc.total += 1;
    if (t.done) sc.completed += 1;
    stageCounts.set(t.stage_id, sc);
  }

  const stagesByPipeline = new Map<string, typeof stages>();
  for (const s of stages) {
    const list = stagesByPipeline.get(s.pipeline_id) ?? [];
    list.push(s);
    stagesByPipeline.set(s.pipeline_id, list);
  }
  for (const list of stagesByPipeline.values()) {
    list.sort((a, b) => a.position - b.position);
  }

  const pipelines: PipelineLite[] = (pipelinesRes.data ?? []).map((p) => {
    const stageList = stagesByPipeline.get(p.id) ?? [];
    let currentStageId: string | null = null;
    if (stageList.length > 0) {
      const withCompleted = stageList.filter(
        (s) => (stageCounts.get(s.id)?.completed ?? 0) > 0,
      );
      currentStageId =
        withCompleted.length > 0
          ? withCompleted[withCompleted.length - 1].id
          : stageList[0].id;
    }
    return {
      id: p.id,
      name: p.name,
      emoji: p.emoji ?? null,
      currentStageId,
    };
  });

  const lastActivePipelineId =
    (profileRes.data?.last_active_pipeline_id as string | null) ?? null;

  return (
    <MyTasksView
      workspaceSlug={ws.slug}
      tasks={tasks}
      pipelines={pipelines}
      lastActivePipelineId={lastActivePipelineId}
      currentUserId={user.id}
      taskFetchError={tasksRes.error?.message ?? null}
    />
  );
}
