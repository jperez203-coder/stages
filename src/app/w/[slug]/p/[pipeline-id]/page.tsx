import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineCanvas } from "@/components/canvas/PipelineCanvas";

/**
 * /w/[slug]/p/[pipeline-id] — pipeline canvas. Phase 4a step 5c.
 *
 * 5c scope: real tasks rendered as checkbox + title rows beneath each
 * stage box, completion writes to tasks.done (triggers set_task_completion
 * _metadata BEFORE UPDATE for completed_at/_by), live re-derivation of the
 * current stage after a toggle, badge→task connectors, +add task via
 * create_task RPC (owner/admin only).
 *
 * Server fetches the raw data; the client (PipelineCanvas) does the
 * derivation locally so post-toggle re-derive is immediate without a
 * server round-trip. Both server-side initial render and client-side
 * re-derive use the SAME helper (src/lib/current-stage.ts) — no
 * duplicated logic. This page just passes the RAW stages + tasks now;
 * derivation moved client-side.
 *
 * Still NOT in scope until later sub-steps:
 *   * Left rail + header chrome (5d)
 *   * Edit pipeline mode (5e)
 *   * Task detail panel — clicking a task ROW is stubbed (step 6)
 *   * Client portal — client_visible filtering NOT applied here; that's
 *     4c. All agency members see all tasks regardless of client_visible.
 *
 * Auth + redirect rules mirror the dashboard:
 *   * Anon → /auth/signin?next=/w/[slug]/p/[pipeline-id]
 *   * Non-workspace-member → / (workspace selector). Client-portal users
 *     get a separate canvas surface in 4c, not this route.
 *   * Pipeline not found OR not in this workspace → /w/[slug] (dashboard)
 *
 * Permissions for task interactions (UI gate mirrors the tightened RLS
 * from 20260521120000_tighten_member_task_update_to_assignee.sql):
 *   * canEditPipeline = workspace owner OR pipeline owner/admin
 *   * Per-task interactivity = canEditPipeline || task.assignee_id === userId
 *   * +add task affordance: canEditPipeline only
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

  // ── Pipeline lookup ────────────────────────────────────────────────────
  const pipelineRes = await supabase
    .from("pipelines")
    .select("id, name, workspace_id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipelineRes.data || pipelineRes.data.workspace_id !== ws.id) {
    redirect(`/w/${slug}`);
  }

  // ── Stages + tasks + pipeline membership + coachmark in parallel ──────
  const [stagesRes, tasksRes, pipelineMembershipRes, profileRes] =
    await Promise.all([
      supabase
        .from("stages")
        .select("id, position, name")
        .eq("pipeline_id", pipelineRes.data.id)
        .order("position", { ascending: true }),

      // Full task fields needed for rendering: title, position, assignee,
      // done, completed metadata. Filter to this pipeline only by joining
      // through stages.
      supabase
        .from("tasks")
        .select(
          `id, stage_id, position, title, done, assignee_id,
           completed_at, completed_by,
           stage:stages!inner(pipeline_id)`,
        )
        .eq("stage.pipeline_id", pipelineRes.data.id)
        .order("position", { ascending: true }),

      // Pipeline membership for the can_edit_pipeline computation.
      // can_edit_pipeline (per the SQL helper in
      // 20260509120000_rls_policies.sql) = workspace owner OR
      // pipeline_memberships.role IN ('owner','admin'). We fetch the
      // calling user's pipeline_memberships row (if any) to mirror the
      // helper in app code — keeps the UI gate consistent with RLS.
      supabase
        .from("pipeline_memberships")
        .select("role")
        .eq("pipeline_id", pipelineRes.data.id)
        .eq("user_id", user.id)
        .maybeSingle(),

      // Coachmark flag — SSR'd to avoid flashing on already-dismissed users.
      supabase
        .from("profiles")
        .select("canvas_hint_dismissed")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

  // ── Derive canEditPipeline (mirrors the SQL helper) ───────────────────
  // Workspace owner → can edit any pipeline in the workspace.
  // Pipeline owner/admin → can edit this specific pipeline.
  // Members (workspace OR pipeline member without admin role) → cannot.
  const isWorkspaceOwner = wsMembershipResult.data.role === "owner";
  const pipelineRole = pipelineMembershipRes.data?.role ?? null;
  const isPipelineOwnerOrAdmin =
    pipelineRole === "owner" || pipelineRole === "admin";
  const canEditPipeline = isWorkspaceOwner || isPipelineOwnerOrAdmin;

  // ── Cast to typed RawStage/RawTask shapes for the client ──────────────
  const stages: StageRaw[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    position: s.position,
    name: s.name,
  }));

  // Server-side TaskRaw cast. The stage join was for filtering, not for
  // shape — strip it out before passing to the client.
  const tasks: TaskRaw[] = (tasksRes.data ?? []).map((t) => ({
    id: t.id,
    stage_id: t.stage_id,
    position: t.position,
    title: t.title,
    done: t.done,
    assignee_id: (t as { assignee_id: string | null }).assignee_id,
    completed_at: (t as { completed_at: string | null }).completed_at,
    completed_by: (t as { completed_by: string | null }).completed_by,
  }));

  const coachmarkInitiallyDismissed =
    (profileRes.data?.canvas_hint_dismissed as boolean | null | undefined) ??
    false;

  return (
    <PipelineCanvas
      pipelineId={pipelineRes.data.id}
      pipelineName={pipelineRes.data.name}
      workspaceSlug={ws.slug}
      coachmarkInitiallyDismissed={coachmarkInitiallyDismissed}
      stages={stages}
      tasks={tasks}
      currentUserId={user.id}
      canEditPipeline={canEditPipeline}
    />
  );
}
