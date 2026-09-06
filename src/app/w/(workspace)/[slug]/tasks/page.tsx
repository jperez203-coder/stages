import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { TaskListView } from "@/components/tasks/TaskListView";
import type { TaskRow } from "@/components/tasks/types";

/**
 * /w/[slug]/tasks — the global Task tab (Figma V2): every not-done task
 * across every pipeline in the workspace, not just the caller's own (that
 * personal view already exists at /w/[slug]/my-tasks). Grouped into
 * Overdue / In progress / Not started; see TaskListView's doc comment for
 * how those groups are derived.
 *
 * Auth + redirect rules mirror /my-tasks (simplified: doesn't handle the
 * pipeline-only-member fallback the dashboard has — a plain workspace
 * member is required to see the cross-project list, which matches "Task"
 * being an agency-wide surface). Flagging this as a known gap rather than
 * fixing silently, per project convention.
 */

export const dynamic = "force-dynamic";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(`/auth/signin?next=/w/${encodeURIComponent(slug)}/tasks`);
  }

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

  const [profileRes, tasksRes, assigneesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle(),

    // Every not-done task across the workspace's pipelines — this is the
    // whole-team list, unlike /my-tasks' assignee_id filter.
    supabase
      .from("tasks")
      .select(
        `id, title, deadline, priority, status, done, created_at, stage_id,
         stage:stages!inner(
           id, pipeline_id,
           pipeline:pipelines!stages_pipeline_id_fkey!inner(id, name, emoji, workspace_id)
         )`,
      )
      .eq("done", false)
      .eq("stage.pipeline.workspace_id", ws.id),

    // Assignees for those tasks, joined separately (task_assignees has no
    // direct FK to profiles — same reason notifications does its own
    // batched profile fetch instead of a PostgREST embed).
    supabase
      .from("task_assignees")
      .select(
        `task_id, user_id,
         task:tasks!inner(stage_id, stage:stages!inner(pipeline_id, pipeline:pipelines!stages_pipeline_id_fkey!inner(workspace_id)))`,
      )
      .eq("task.stage.pipeline.workspace_id", ws.id),
  ]);

  if (tasksRes.error) {
    console.error("[tasks] fetch failed:", tasksRes.error.message);
  }
  if (assigneesRes.error) {
    console.error("[tasks] assignees fetch failed:", assigneesRes.error.message);
  }

  const assigneeUserIds = Array.from(
    new Set((assigneesRes.data ?? []).map((a) => a.user_id)),
  );
  const profilesByIdRes = assigneeUserIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", assigneeUserIds)
    : { data: [] as { id: string; display_name: string | null; avatar_url: string | null }[] };

  const profilesById = new Map(
    (profilesByIdRes.data ?? []).map((p) => [p.id, p]),
  );

  const assigneesByTaskId = new Map<string, TaskRow["assignees"]>();
  for (const row of assigneesRes.data ?? []) {
    const profile = profilesById.get(row.user_id);
    const list = assigneesByTaskId.get(row.task_id) ?? [];
    list.push({
      id: row.user_id,
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    });
    assigneesByTaskId.set(row.task_id, list);
  }

  type StageJoin = {
    id: string;
    pipeline_id: string;
    pipeline:
      | { id: string; name: string; emoji: string | null }
      | Array<{ id: string; name: string; emoji: string | null }>;
  };
  const flattenStage = (s: unknown) => {
    const obj = (Array.isArray(s) ? s[0] : s) as StageJoin | undefined;
    if (!obj) return null;
    const p = Array.isArray(obj.pipeline) ? obj.pipeline[0] : obj.pipeline;
    return { id: p?.id ?? "", name: p?.name ?? "", emoji: p?.emoji ?? "📋" };
  };

  const tasks: TaskRow[] = (tasksRes.data ?? [])
    .map((t) => {
      const pipeline = flattenStage(t.stage);
      if (!pipeline) return null;
      return {
        id: t.id,
        title: t.title,
        deadline: t.deadline as string | null,
        priority: t.priority as TaskRow["priority"],
        status: t.status as TaskRow["status"],
        createdAt: t.created_at as string,
        pipeline,
        assignees: assigneesByTaskId.get(t.id) ?? [],
      };
    })
    .filter((t): t is TaskRow => t !== null);

  const rawName = profileRes.data?.display_name ?? null;
  const emailLocal = user.email?.split("@")[0] ?? null;
  const nameBase = rawName && rawName.trim() ? rawName.trim() : emailLocal;
  const firstWord = nameBase ? nameBase.split(/\s+/)[0] : "";
  const firstName = firstWord ? firstWord[0].toUpperCase() + firstWord.slice(1) : null;

  return <TaskListView slug={slug} firstName={firstName} initialTasks={tasks} />;
}
