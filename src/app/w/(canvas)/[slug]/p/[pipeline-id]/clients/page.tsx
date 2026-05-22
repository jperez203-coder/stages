import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { PipelineChromeShell } from "@/components/chrome/PipelineChromeShell";
import { fetchCanvasChromeData } from "@/lib/canvas-chrome-data";
import { ClientsBody } from "./ClientsBody";

/**
 * /w/[slug]/p/[pipeline-id]/clients — agency-side client invite UI for
 * a specific pipeline. Phase 4a step 5d.
 *
 * 5d split this route into a server wrapper (this file) + the existing
 * client component body (ClientsBody, formerly the page's default
 * export). The server wrapper:
 *   1. Auth-gates anonymous traffic (server-side redirect to /auth/signin)
 *   2. Fetches the canvas chrome data (pipeline metadata, members,
 *      canEditPipeline) via the shared helper
 *   3. Renders <PipelineChromeShell {...chrome}><ClientsBody /></PipelineChromeShell>
 *
 * The body component is unchanged from pre-5d — same useSession +
 * useUserContexts + usePipelineClientsData hooks, same invite form +
 * client roster. The body is wrapped now, that's all.
 *
 * Why split: pre-5d, /clients was a "use client" page rendered inside
 * AppShell from /w/[slug]/layout.tsx. Phase 1 (route-groups) moved
 * /clients into (canvas) and removed AppShell from its render path.
 * Phase 2 (this commit) restores chrome via PipelineChromeShell — but
 * the shell needs SERVER-FETCHED data (members, can_edit, etc.) which
 * a "use client" page can't do. The server wrapper handles fetch + shell.
 *
 * Task counts in the header subline: the chrome shell expects
 * completedTasks + totalTasks. /clients doesn't fetch tasks (it's not
 * about tasks), so we pass 0/0. The subline reads "Last edited X ago
 * · 0/0 completed · Company" which is technically accurate (we just
 * aren't displaying real counts on this surface). Future enhancement:
 * pass `null` and have the shell omit the segment when not fetched —
 * filed as a follow-up nit, not blocking.
 *
 * Auth fail behavior matches the canvas page.tsx exactly: anon → /auth/signin
 * with `next=` set to the current URL; non-workspace-member → /;
 * pipeline-not-found-or-wrong-workspace → /w/[slug].
 */

export const dynamic = "force-dynamic";

export default async function PipelineClientsPage({
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
      `/auth/signin?next=/w/${encodeURIComponent(
        slug,
      )}/p/${encodeURIComponent(pipelineId)}/clients`,
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

  // ── Pipeline + workspace match pre-check ──────────────────────────────
  const pipelineMatchRes = await supabase
    .from("pipelines")
    .select("id, workspace_id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipelineMatchRes.data || pipelineMatchRes.data.workspace_id !== ws.id) {
    redirect(`/w/${slug}`);
  }

  // ── Parallel: chrome data + caller's profile ──────────────────────────
  const [chrome, callerProfileRes] = await Promise.all([
    fetchCanvasChromeData(
      supabase,
      pipelineId,
      user.id,
      wsMembershipResult.data.role,
    ),
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (!chrome) {
    redirect(`/w/${slug}`);
  }

  return (
    <PipelineChromeShell
      workspaceSlug={ws.slug}
      chrome={chrome}
      // /clients doesn't fetch tasks — pass 0/0 for the subline. See
      // file header for the future "null = omit segment" nit.
      completedTasks={0}
      totalTasks={0}
      user={{
        email: user.email ?? "",
        displayName: callerProfileRes.data?.display_name ?? null,
        avatarUrl: callerProfileRes.data?.avatar_url ?? null,
      }}
    >
      <ClientsBody />
    </PipelineChromeShell>
  );
}
