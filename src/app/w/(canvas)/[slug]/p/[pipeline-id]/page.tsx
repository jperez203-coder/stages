import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineCanvas } from "@/components/canvas/PipelineCanvas";
import { PipelineChromeShell } from "@/components/chrome/PipelineChromeShell";
import { fetchCanvasChromeData } from "@/lib/canvas-chrome-data";

/**
 * /w/[slug]/p/[pipeline-id] — pipeline canvas. Phase 4a step 5d.
 *
 * 5d adds the canvas chrome (PipelineHeader + LeftRail) around the
 * canvas surface from 5c. The page now:
 *   1. Auth gate (unchanged)
 *   2. Workspace membership (unchanged)
 *   3. Pipeline lookup (extended — emoji/company/last_edited_at)
 *   4. Stages + tasks + member roster + caller's pipeline_memberships
 *      + caller's profile (added member roster query for the chrome's
 *      avatar cluster + popover; profile for the HeaderProfileMenu)
 *   5. Derive canEditPipeline (unchanged)
 *   6. Render <PipelineChromeShell {...chromeData}><PipelineCanvas /></PipelineChromeShell>
 *
 * The chrome fetches happen via the shared `fetchCanvasChromeData()`
 * helper so this page and /clients (the sibling route in the canvas
 * group) share one definition of "what the chrome needs."
 *
 * Pipeline data sent to PipelineCanvas no longer includes
 * pipelineName/workspaceSlug — the chrome owns those; PipelineCanvas is
 * just the pan/zoom + stages + tasks surface now.
 *
 * Auth + redirect rules unchanged from 5c.
 */

export const dynamic = "force-dynamic";

export type StageRaw = {
  id: string;
  position: number;
  name: string;
};

export type TaskRaw = {
  id: string;
  stage_id: string;
  position: number;
  title: string;
  done: boolean;
  assignee_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  // Step 6 fields — read/edited only by TaskDetailPanel; the canvas
  // itself doesn't display these but they're loaded upfront so the
  // panel can render synchronously off `tasksState` (no round-trip
  // on panel open). Plus all panel mutations are optimistic; canvas
  // and panel share the same state.
  description: string | null;
  deadline: string | null;        // timestamptz from server, ISO string client-side
  client_visible: boolean;
  created_at: string;             // not null in DB (default now())
};

export default async function PipelineCanvasPage({
  params,
}: {
  params: Promise<{ slug: string; "pipeline-id": string }>;
}) {
  const resolved = await params;
  const { slug } = resolved;
  const pipelineId = resolved["pipeline-id"];
  const supabase = await createSupabaseServerClient();

  // ── Auth gate ──────────────────────────────────────────────────────────
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    redirect(
      `/auth/signin?next=/w/${encodeURIComponent(slug)}/p/${encodeURIComponent(
        pipelineId,
      )}`,
    );
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
    redirect("/");
  }

  // ── Pipeline workspace match (cheap pre-check) ────────────────────────
  // Quick query to confirm the pipeline belongs to this workspace before
  // we kick off the parallel chrome + stages + tasks fetch. Saves a
  // round-trip if the pipeline-id is wrong/stale.
  const pipelineMatchRes = await supabase
    .from("pipelines")
    .select("id, workspace_id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipelineMatchRes.data || pipelineMatchRes.data.workspace_id !== ws.id) {
    redirect(`/w/${slug}`);
  }

  // ── Parallel fetches: chrome data + stages + tasks + coachmark + profile ──
  const [chrome, stagesRes, tasksRes, profileRes, callerProfileRes] =
    await Promise.all([
      // Chrome data (pipeline emoji/company/last_edited_at + member
      // roster + canEditPipeline). Shared helper used by /clients too.
      fetchCanvasChromeData(
        supabase,
        pipelineId,
        user.id,
        wsMembershipResult.data.role,
      ),

      supabase
        .from("stages")
        .select("id, position, name")
        .eq("pipeline_id", pipelineId)
        .order("position", { ascending: true }),

      supabase
        .from("tasks")
        .select(
          `id, stage_id, position, title, done, assignee_id,
           completed_at, completed_by,
           description, deadline, client_visible, created_at,
           stage:stages!inner(pipeline_id)`,
        )
        .eq("stage.pipeline_id", pipelineId)
        .order("position", { ascending: true }),

      // Coachmark flag — SSR'd to avoid flash on dismissed users.
      supabase
        .from("profiles")
        .select("canvas_hint_dismissed")
        .eq("id", user.id)
        .maybeSingle(),

      // Caller's profile fields — feed HeaderProfileMenu (display_name,
      // avatar_url for the top-right user menu in the chrome).
      supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

  if (!chrome) {
    // Pipeline lookup inside fetchCanvasChromeData returned null —
    // shouldn't happen after the pre-check above, but defensive.
    redirect(`/w/${slug}`);
  }

  // ── Cast stages + tasks ───────────────────────────────────────────────
  const stages: StageRaw[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    position: s.position,
    name: s.name,
  }));

  const tasks: TaskRaw[] = (tasksRes.data ?? []).map((t) => {
    const row = t as TaskRaw & Record<string, unknown>;
    return {
      id: row.id,
      stage_id: row.stage_id,
      position: row.position,
      title: row.title,
      done: row.done,
      assignee_id: row.assignee_id,
      completed_at: row.completed_at,
      completed_by: row.completed_by,
      description: row.description,
      deadline: row.deadline,
      client_visible: row.client_visible,
      created_at: row.created_at,
    };
  });

  // Task counts for the header subline. Compute once here vs duplicating
  // a count() server query.
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.done).length;

  const coachmarkInitiallyDismissed =
    (profileRes.data?.canvas_hint_dismissed as boolean | null | undefined) ??
    false;

  return (
    <PipelineChromeShell
      workspaceSlug={ws.slug}
      chrome={chrome}
      completedTasks={completedTasks}
      totalTasks={totalTasks}
      user={{
        email: user.email ?? "",
        displayName: callerProfileRes.data?.display_name ?? null,
        avatarUrl: callerProfileRes.data?.avatar_url ?? null,
      }}
    >
      <PipelineCanvas
        pipelineId={chrome.pipeline.id}
        pipelineName={chrome.pipeline.name}
        coachmarkInitiallyDismissed={coachmarkInitiallyDismissed}
        stages={stages}
        tasks={tasks}
        members={chrome.members}
        currentUserId={user.id}
        canEditPipeline={chrome.canEditPipeline}
      />
    </PipelineChromeShell>
  );
}
