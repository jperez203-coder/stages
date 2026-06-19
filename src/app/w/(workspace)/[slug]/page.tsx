import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DashboardGreeting } from "@/components/dashboard/DashboardGreeting";
import { MissingNameBanner } from "@/components/dashboard/MissingNameBanner";
import { StartTrialBanner } from "@/components/billing/StartTrialBanner";
import { FoundingTrialEndingBanner } from "@/components/billing/FoundingTrialEndingBanner";
import { formatTrialRemaining } from "@/lib/email";
import { MyTasksCard } from "@/components/dashboard/MyTasksCard";
import { ActivityCard } from "@/components/dashboard/ActivityCard";
// TeamChatStrip import intentionally removed — see deferred-not-deleted
// comment at the former mount point below. The component file is kept
// in src/components/dashboard/ for easy reinstatement.
import { PipelinesSection } from "@/components/dashboard/PipelinesSection";
import type { AvatarUser } from "@/components/UserAvatar";
import { pickAnchorStage, stageStateFromCounts } from "@/lib/current-stage";
import type { StageState } from "@/lib/current-stage";

/**
 * /w/[slug] — workspace dashboard. Phase 4a step 2.
 *
 * Replaces the legacy in-memory <App /> render that occupied this route
 * since Phase 2. Server component: all data is fetched here at page level,
 * no client useEffect waterfalls.
 *
 * Auth + redirect flow (in order):
 *   1. Anon → /auth/signin?next=/w/[slug] (closes phase 3.4 lesson #10
 *      gap for the dashboard surface)
 *   2. Authenticated workspace member → render dashboard
 *   3. Authenticated client (pipeline_memberships role='client' on a
 *      pipeline in this workspace, no workspace_memberships) →
 *      /portal/[first-pipeline-id]
 *   4. Neither member nor client → fall back to last_active_workspace_id
 *      (if it points elsewhere) or the workspace selector at /
 *
 * Data layout (all queries parallelized post-auth):
 *   * profile (display_name, avatar_url) — for greeting + future avatar
 *   * pipelines + stages + tasks — for current_stage derivation, progress,
 *     and the My Tasks card
 *   * pipeline_memberships + profiles join — for the member cluster on
 *     each pipeline card (single query, no N+1)
 *   * notifications — top 5 for the Activity card (NF-5) AND unread
 *     row list for per-pipeline red-dot indicators (NF-4). Previously
 *     both consumed activity_events (mention-less placeholder + 7-day
 *     proxy); now both use real notification read-state.
 *
 * Per-card error states: each card receives its own error prop; if one
 * query fails, the rest of the dashboard still renders. No top-level
 * error throw unless auth itself fails.
 */

export const dynamic = "force-dynamic";

export default async function WorkspaceDashboardPage({
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
    redirect(`/auth/signin?next=/w/${encodeURIComponent(slug)}`);
  }

  // ── Membership check ───────────────────────────────────────────────────
  // PI-5a: two queries in parallel. workspace_memberships is the
  // existing path; pipeline_memberships(role IN admin/member) is the
  // new pipeline-only fallback. The latter exists because RLS already
  // grants pipeline-only agency members visibility (via the
  // is_pipeline_agency_member clause on pipelines_select added in
  // 20260509130000), but the dashboard route gate was bouncing them
  // out — strict bug fix. Clients are NOT included in this widen;
  // they're handled by the existing case-3 redirect to /portal below
  // and shouldn't see the agency dashboard either way.
  //
  // First hit wins:
  //   1. workspace_memberships present → existing render path, real role.
  //   2. pipeline_memberships(role admin|member) present → render the
  //      dashboard with workspace info derived from the pipeline embed;
  //      workspaceRole stays "" for downstream gates (no privilege
  //      escalation — workspace owner/admin affordances stay hidden).
  //   3. Neither → existing client-pipeline check below, then existing
  //      last_active / selector fallback chain.
  const [wsMembershipResult, pipMembershipResult] = await Promise.all([
    supabase
      .from("workspace_memberships")
      .select(`role, workspace:workspaces!inner(id, name, slug)`)
      .eq("user_id", user.id)
      .eq("workspace.slug", slug)
      .maybeSingle(),
    supabase
      .from("pipeline_memberships")
      .select(
        `role, pipeline:pipelines!inner(workspace:workspaces!inner(id, name, slug))`,
      )
      .eq("user_id", user.id)
      .in("role", ["admin", "member"])
      .eq("pipeline.workspace.slug", slug)
      .limit(1)
      .maybeSingle(),
  ]);

  type WsRow = { id: string; name: string; slug: string };

  // PostgREST returns nested-select rows as either object or array
  // depending on codegen heuristic. Cast through unknown + normalize.
  let ws: WsRow | null = null;
  if (wsMembershipResult.data) {
    const wsRaw = wsMembershipResult.data.workspace as unknown;
    ws = Array.isArray(wsRaw)
      ? ((wsRaw[0] as WsRow | undefined) ?? null)
      : ((wsRaw as WsRow | null) ?? null);
  }

  if (!ws && pipMembershipResult.data) {
    // PI-5a pipeline-only fallback. Embed shape:
    //   pipeline: { workspace: { id, name, slug } }
    // The .eq("pipeline.workspace.slug", slug) + !inner joins already
    // verified the pipeline belongs to a workspace with this slug.
    const pipRaw = pipMembershipResult.data.pipeline as unknown;
    const pipObj = (Array.isArray(pipRaw) ? pipRaw[0] : pipRaw) as
      | { workspace?: unknown }
      | undefined;
    const wsRaw = pipObj?.workspace as unknown;
    ws = Array.isArray(wsRaw)
      ? ((wsRaw[0] as WsRow | undefined) ?? null)
      : ((wsRaw as WsRow | null) ?? null);
  }

  if (!ws) {
    // Not a workspace member, not a pipeline-only agency member.
    // Check if they're a client on a pipeline here.
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

    // Not workspace member, not client. Try last_active_workspace_id.
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

    // Fallback: workspace selector.
    redirect("/");
  }

  // ── Dashboard data fetch (all parallel) ────────────────────────────────
  // Eight queries fired in parallel. Each scoped through the workspace_id
  // (either directly or via a nested !inner join) so RLS doesn't need a
  // second-pass filter. Per-query failure is captured in per-card error
  // props rather than crashing the page.
  //
  const [
    profileRes,
    pipelinesRes,
    stagesRes,
    workspaceTasksRes,
    myTasksRes,
    membershipsRes,
    activityRes,
    pipelineUnreadRes,
    billingRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url, is_founding_member")
      .eq("id", user.id)
      .single(),

    supabase
      .from("pipelines")
      .select("id, name, emoji, company, last_edited_at, created_at")
      .eq("workspace_id", ws.id),

    supabase
      .from("stages")
      .select(
        // `pipelines!stages_pipeline_id_fkey` disambiguates the FK —
        // there are TWO stages↔pipelines relationships in the schema:
        // stages.pipeline_id → pipelines.id (the parent FK we want here)
        // pipelines.current_stage_id → stages.id (back-pointer from the
        // auto_advance_stage trigger). Without the FK name, PostgREST
        // returns PGRST201 (ambiguous embed). Same fix below in
        // workspaceTasks + myTasks queries.
        `id, pipeline_id, position, name, color, pipeline:pipelines!stages_pipeline_id_fkey!inner(workspace_id)`,
      )
      .eq("pipeline.workspace_id", ws.id),

    // All tasks across the workspace's pipelines — for current_stage
    // derivation and progress aggregation. Tiny columns; aggregate in JS.
    // FK hint on the inner pipelines join — see stages query above.
    supabase
      .from("tasks")
      .select(
        `id, done, stage_id, stage:stages!inner(pipeline_id, pipeline:pipelines!stages_pipeline_id_fkey!inner(workspace_id))`,
      )
      .eq("stage.pipeline.workspace_id", ws.id),

    // Tasks assigned to ME, not done, in this workspace — for the My Tasks
    // card. Pulls extra fields needed for the row render.
    // FK hint on the inner pipelines join — see stages query above.
    supabase
      .from("tasks")
      .select(
        `id, title, deadline, created_at, stage_id,
         stage:stages!inner(
           id, name, color, position, pipeline_id,
           pipeline:pipelines!stages_pipeline_id_fkey!inner(id, name, emoji, workspace_id)
         )`,
      )
      .eq("assignee_id", user.id)
      .eq("done", false)
      .eq("stage.pipeline.workspace_id", ws.id),

    // Member clusters: all pipeline_memberships rows for pipelines in
    // this workspace. Single query — no per-pipeline N+1. profiles get
    // a separate batch fetch below (no direct PostgREST FK between
    // pipeline_memberships.user_id and profiles.id).
    supabase
      .from("pipeline_memberships")
      .select(
        `pipeline_id, user_id, role, joined_at, pipeline:pipelines!inner(workspace_id)`,
      )
      .eq("pipeline.workspace_id", ws.id),

    // NF-5: Activity feed swapped from prototype activity_events to the
    // per-user notifications table (NF-1). Top 5 events directed at the
    // caller in this workspace, newest first. RLS already scopes to
    // recipient_id = auth.uid(); we add workspace_id for clarity +
    // index alignment with notifications_recipient_created_idx.
    //
    // No PostgREST embeds — NF-3.1 lesson: notifications.actor_id FKs to
    // auth.users(id), not profiles(id); embedding profiles!actor_id
    // could fail with PGRST20x relationship-ambiguity and nuke the
    // whole select. All joined data (actor profile, pipeline name,
    // message text + channel) is fetched in follow-up batched IN(...)
    // queries below.
    supabase
      .from("notifications")
      .select(
        `id, kind, source_kind, source_id, read_at, created_at,
         actor_id, pipeline_id`,
      )
      .eq("recipient_id", user.id)
      .eq("workspace_id", ws.id)
      .order("created_at", { ascending: false })
      .limit(5),

    // NF-4: per-pipeline unread indicator — now sourced from the
    // notifications table (NF-1) instead of the prototype 7-day
    // activity_events proxy. Real read-state semantics: the dot fires
    // only when the caller has unread notifications scoped to that
    // pipeline, and disappears the moment they mark them read (whether
    // via the activity page's per-item click, the Mark all read button,
    // or the dashboard preview's row click).
    //
    // Self-exclusion is implicit: NF-1's trigger never creates rows
    // where recipient_id = actor_id (client_message fan-out skips the
    // actor; mention fan-out skips self-mentions). So no `.neq` filter
    // needed here.
    //
    // recipient_id RLS already constrains to auth.uid(); the explicit
    // .eq below is belt-and-suspenders + lines up with
    // notifications_recipient_pipeline_unread_idx (the partial index
    // on read_at IS NULL).
    supabase
      .from("notifications")
      .select("pipeline_id")
      .eq("recipient_id", user.id)
      .eq("workspace_id", ws.id)
      .is("read_at", null),

    // Workspace billing status — drives the StartTrialBanner AND
    // FoundingTrialEndingBanner mount decisions below. RLS lets owner +
    // admin SELECT this row; members + clients get 0 rows (which our
    // null-coalesce treats as "no subscription provisioned"). For
    // members the banner is gated separately by role, so the null
    // result is a no-op for them.
    //
    // stripe_subscription_id distinguishes Track A founders (NULL —
    // no Stripe sub yet during the no-card trial) from Track B
    // subscribers (sub_id set). trial_ends_at feeds the founding
    // banner's pre-expiry 72h window check + drives the dynamic
    // remaining-time copy via formatTrialRemaining.
    supabase
      .from("workspace_billing")
      .select("subscription_status, stripe_subscription_id, trial_ends_at")
      .eq("workspace_id", ws.id)
      .maybeSingle(),
  ]);

  // ── NF-5: resolve source channel_messages for the notifications feed ──
  // Embeds channels (FK is explicit + RLS-safe). Same pattern as NF-3.1
  // on /w/[slug]/activity.
  const sourceMessageIds = (activityRes.data ?? [])
    .filter((n) => n.source_kind === "channel_message")
    .map((n) => n.source_id as string);

  type ChannelMessageRow = {
    id: string;
    text: string;
    channel:
      | { id: string; name: string; is_client: boolean }
      | Array<{ id: string; name: string; is_client: boolean }>;
  };

  const sourceMessagesResult = sourceMessageIds.length
    ? await supabase
        .from("channel_messages")
        .select(
          `id, text,
           channel:channels!channel_id(id, name, is_client)`,
        )
        .in("id", sourceMessageIds)
    : { data: [], error: null };

  if (sourceMessagesResult.error) {
    // NF-3.1 lesson: log PostgrestError fields explicitly — bare
    // console.error(err) serializes to `{}`.
    const err = sourceMessagesResult.error;
    console.error(
      "[dashboard/activity] source messages fetch failed:",
      err.message,
      "code:",
      err.code,
      "details:",
      err.details,
      "hint:",
      err.hint,
    );
  }

  const sourceMessagesById = new Map<
    string,
    {
      text: string;
      channelId: string;
      channelName: string;
      channelIsClient: boolean;
    }
  >();
  for (const m of (sourceMessagesResult.data ?? []) as ChannelMessageRow[]) {
    const chEmbed = m.channel as unknown;
    const chObj = (Array.isArray(chEmbed) ? chEmbed[0] : chEmbed) as
      | { id: string; name: string; is_client: boolean }
      | undefined;
    if (!chObj) continue;
    sourceMessagesById.set(m.id, {
      text: m.text,
      channelId: chObj.id,
      channelName: chObj.name,
      channelIsClient: chObj.is_client,
    });
  }

  // ── Resolve secondary profiles (members + activity actors) ────────────
  const memberUserIds = new Set<string>(
    (membershipsRes.data ?? []).map((m) => m.user_id),
  );
  const activityActorIds = new Set<string>(
    (activityRes.data ?? [])
      .map((e) => e.actor_id)
      .filter((id): id is string => !!id),
  );
  const allUserIds = Array.from(
    new Set<string>([...memberUserIds, ...activityActorIds]),
  );

  const profilesByUserIdResult = allUserIds.length
    ? await supabase
        .from("profiles")
        .select("id, display_name, avatar_url, email")
        .in("id", allUserIds)
    : { data: [], error: null };

  const profilesById = new Map<
    string,
    AvatarUser & { email: string | null }
  >();
  for (const p of profilesByUserIdResult.data ?? []) {
    profilesById.set(p.id, {
      id: p.id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      email: p.email,
    });
  }

  // ── Derive per-pipeline data ──────────────────────────────────────────
  const stages = stagesRes.data ?? [];
  const workspaceTasks = workspaceTasksRes.data ?? [];
  const memberships = membershipsRes.data ?? [];
  const pipelineUnreadRows = pipelineUnreadRes.data ?? [];
  if (pipelineUnreadRes.error) {
    const err = pipelineUnreadRes.error;
    console.error(
      "[dashboard/pipeline-unread] notifications fetch failed:",
      err.message,
      "code:",
      err.code,
      "details:",
      err.details,
      "hint:",
      err.hint,
    );
  }

  const stageToPipeline = new Map<string, string>();
  for (const s of stages) stageToPipeline.set(s.id, s.pipeline_id);

  // Per-pipeline totals + per-stage totals.
  const pipelineTotals = new Map<
    string,
    { total: number; completed: number }
  >();
  const stageCounts = new Map<
    string,
    { total: number; completed: number }
  >();
  for (const t of workspaceTasks) {
    const pipelineId = stageToPipeline.get(t.stage_id);
    if (!pipelineId) continue;
    const pt = pipelineTotals.get(pipelineId) ?? { total: 0, completed: 0 };
    pt.total += 1;
    if (t.done) pt.completed += 1;
    pipelineTotals.set(pipelineId, pt);

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

  // NF-4: per-pipeline unread counts from notifications. Each row in
  // pipelineUnreadRows represents one unread notification addressed to
  // the caller scoped to a pipeline in this workspace. Tally client-
  // side — PostgREST doesn't expose GROUP BY, but the partial index
  // notifications_recipient_pipeline_unread_idx keeps the count
  // bounded so the row-list is cheap to iterate.
  const unreadCountByPipeline = new Map<string, number>();
  for (const r of pipelineUnreadRows) {
    const pid = r.pipeline_id as string;
    unreadCountByPipeline.set(pid, (unreadCountByPipeline.get(pid) ?? 0) + 1);
  }

  // Members per pipeline, agency before clients, joined_at asc within group.
  const membersByPipeline = new Map<string, typeof memberships>();
  for (const m of memberships) {
    const list = membersByPipeline.get(m.pipeline_id) ?? [];
    list.push(m);
    membersByPipeline.set(m.pipeline_id, list);
  }
  const roleOrder = (role: string) => (role === "client" ? 1 : 0);
  for (const list of membersByPipeline.values()) {
    list.sort((a, b) => {
      const ro = roleOrder(a.role) - roleOrder(b.role);
      if (ro !== 0) return ro;
      return (
        new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
      );
    });
  }

  const pipelines = (pipelinesRes.data ?? []).map((p) => {
    const stagesList = stagesByPipeline.get(p.id) ?? [];
    const totals = pipelineTotals.get(p.id) ?? { total: 0, completed: 0 };

    // Per-stage state classifier + headline picker — shared with canvas.
    // See src/lib/current-stage.ts for the rules. New model (5c
    // annotation polish): per-stage state independent of position;
    // dashboard surfaces ONE focal stage as the tile headline, picked
    // by the same rule the canvas uses for auto-center + pill (first
    // in-progress → first not-started → last). Keeps headline + canvas
    // focus in sync.
    const stageStatesForPipeline = new Map<string, StageState>();
    for (const s of stagesList) {
      const c = stageCounts.get(s.id) ?? { total: 0, completed: 0 };
      stageStatesForPipeline.set(s.id, stageStateFromCounts(c));
    }
    const headlineStage = pickAnchorStage(stagesList, stageStatesForPipeline);

    const memberRows = membersByPipeline.get(p.id) ?? [];
    const visibleMembers = memberRows.slice(0, 3).map((m) => ({
      role: m.role,
      user: profilesById.get(m.user_id) ?? {
        id: m.user_id,
        display_name: null,
        avatar_url: null,
        email: null,
      },
    }));
    const totalMembers = memberRows.length;
    const overflowMembers = Math.max(0, totalMembers - 3);
    const allMembers = memberRows.map((m) => ({
      role: m.role,
      user: profilesById.get(m.user_id) ?? {
        id: m.user_id,
        display_name: null,
        avatar_url: null,
        email: null,
      },
    }));

    return {
      id: p.id,
      name: p.name,
      emoji: p.emoji ?? "📋",
      company: (p as { company: string | null }).company ?? null,
      last_edited_at: p.last_edited_at,
      created_at: p.created_at,
      currentStage: headlineStage
        ? {
            id: headlineStage.id,
            name: headlineStage.name,
            color: headlineStage.color,
          }
        : null,
      progress: totals,
      unreadCount: unreadCountByPipeline.get(p.id) ?? 0,
      visibleMembers,
      overflowMembers,
      allMembers,
    };
  });

  // ── My Tasks: enrich + sort per locked rule ──────────────────────────
  type StageJoin = {
    id: string;
    name: string;
    color: string | null;
    position: number;
    pipeline_id: string;
    pipeline:
      | {
          id: string;
          name: string;
          emoji: string | null;
          workspace_id: string;
        }
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
      pipelineEmoji: p?.emoji ?? "📋",
    };
  };
  // Overdue threshold = midnight-today (NOT now()). Spec sort rule lists
  // "today" as part of step 2 (deadline asc), not step 1 (overdue). A task
  // due today at 9am, viewed at 5pm, should still be in the "Today" bucket
  // (pill = "Today", title color white), not the overdue bucket. Matches
  // describeDeadline's pill semantics in MyTasksCard.
  //
  // KNOWN LIMITATION (timezone): this server component runs in the
  // server's local TZ (UTC on Vercel). For users west of UTC, the
  // mismatch is: deadlines that fall AFTER the server's UTC midnight but
  // BEFORE the user's local midnight (e.g. 8pm ET Monday = 1am UTC
  // Tuesday) get classified as "not overdue" by the server while still
  // being in the user's "today." When the user views the task later that
  // same local evening (e.g. 11pm ET Monday = 4am UTC Tuesday), the
  // server says NOT overdue (deadline > UTC midnight today) — but the
  // user mental model says overdue (3hrs past in their TZ).
  //
  // The pill itself (rendered client-side in browser-local TZ) shows
  // "Today" correctly in this case; only the sort bucket diverges.
  // Affected window: roughly the user's last `UTC_offset` hours of their
  // local day (5hrs for ET, 8hrs for PT).
  //
  // Launch-prep blocker, NOT someday pile: Stages' beachhead is US-based
  // GHL agencies, so "west of UTC" is the majority of users. "My overdue
  // tasks don't show red in the evening" would erode trust the moment a
  // real customer logs in after 7pm ET. Must ship the fix before any
  // serious customer launch.
  //
  // Proper fix (locked direction): read the user's TZ from a cookie set
  // client-side on first load, then pass it into this server component
  // so the day boundary is computed in the user's TZ. The alternative —
  // moving the sort to a client component — was considered and rejected:
  // it would require shipping the full assigned-tasks list to the
  // browser and re-sorting after hydration, reintroducing the waterfall
  // the server-component design exists to avoid.
  //
  // Tracked in PROGRESS.md launch-prep checklist (2026-05-19).
  const now = new Date();
  const todayStartMs = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const myTasks = (myTasksRes.data ?? [])
    .map((t) => {
      const stage = flattenStage(t.stage);
      return stage
        ? {
            id: t.id,
            title: t.title,
            deadline: t.deadline as string | null,
            createdAt: t.created_at as string,
            stage,
          }
        : null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const myTasksSorted = [...myTasks].sort((a, b) => {
    const aOverdue =
      a.deadline !== null &&
      new Date(a.deadline).getTime() < todayStartMs;
    const bOverdue =
      b.deadline !== null &&
      new Date(b.deadline).getTime() < todayStartMs;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (aOverdue && bOverdue) {
      return (
        new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime()
      );
    }
    if (a.deadline !== null && b.deadline !== null) {
      return (
        new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
      );
    }
    if (a.deadline !== null) return -1;
    if (b.deadline !== null) return 1;
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });

  const myTasksTopFive = myTasksSorted.slice(0, 5);

  // ── NF-5: notification enrichment for the ActivityCard ────────────────
  // Reshape each notifications row into the compact view-model the
  // ActivityCard consumes. Skips events whose source message was
  // deleted (cascade) — we can't render "Sam sent a message in #?"
  // without the channel context.
  const activityEnriched = (activityRes.data ?? [])
    .map((n) => {
      const message = sourceMessagesById.get(n.source_id as string);
      if (!message) return null;
      const actorProfile = n.actor_id
        ? profilesById.get(n.actor_id as string) ?? null
        : null;
      return {
        id: n.id as string,
        kind: n.kind as "mention" | "client_message",
        read: Boolean(n.read_at),
        actorUser: actorProfile
          ? {
              id: actorProfile.id,
              display_name: actorProfile.display_name,
              avatar_url: actorProfile.avatar_url,
              email: actorProfile.email,
            }
          : {
              // Source message author was deleted (FK set null) → render
              // a neutral placeholder. Matches the convention used in
              // MessageRow and the activity-page event card.
              id: `deleted:${n.id as string}`,
              display_name: null,
              avatar_url: null,
              email: null,
            },
        actorName: actorProfile
          ? actorProfile.display_name ?? actorProfile.email ?? "Pending member"
          : "Deleted user",
        pipelineId: n.pipeline_id as string,
        channelId: message.channelId,
        channelName: message.channelName,
        channelIsClient: message.channelIsClient,
        messageId: n.source_id as string,
        messageText: message.text,
        createdAt: n.created_at as string,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  // ── Greeting first-name parsing ──────────────────────────────────────
  // display_name might be stored lowercase (email-signup users on
  // jordanperez1270@gmail.com show "jordan", Google OAuth users show
  // "Jordan Perez"). Force first-letter capitalization at render time
  // so the greeting is consistent regardless of what's in the DB. No
  // backfill needed; handles all existing rows.
  //
  // Null-safe resolution chain (PIECE 5 follow-up):
  //   1. display_name's first word — the normal case
  //   2. email local-part — when display_name is null/empty (e.g. an
  //      email+password user who signed up before the name field
  //      existed and hasn't filled it in yet)
  //   3. null → DashboardGreeting renders "Hey there! 👋"
  // Never produces "Hey ! 👋" — an empty firstWord collapses to null.
  const displayName = profileRes.data?.display_name ?? null;
  const greetingBase =
    (displayName && displayName.trim() ? displayName.trim() : null) ??
    (user.email ? user.email.split("@")[0] : null);
  const firstWord = greetingBase ? greetingBase.split(/\s+/)[0] : "";
  const firstName = firstWord
    ? firstWord[0].toUpperCase() + firstWord.slice(1)
    : null;

  return (
    <div className="dotted-grid flex-1 px-6 sm:px-12 py-6">
      <div className="max-w-[1600px] mx-auto">
        <DashboardGreeting firstName={firstName} />

        {/* Missing-name nudge — renders only when display_name is
            null/empty AND the user hasn't dismissed it in this
            browser. Client component; the dismissal logic lives
            there. Passes the server-fetched displayName so the
            client side doesn't need a second query. */}
        <MissingNameBanner displayName={displayName} />

        {/* Billing banner — at most one of StartTrialBanner (Track B)
            or FoundingTrialEndingBanner (Track A) renders, per the
            precedence below. Owner/admin only; RLS already gates
            workspace_billing SELECT to owner/admin but the explicit
            role check is defense in depth (two layers, both
            independently sufficient — see Slice 5 plan thread 1).

            PRECEDENCE (updated for Slice 6)
              1. Non-owner/admin → no banner.
              2. Founders (profiles.is_founding_member=true) →
                 FoundingTrialEndingBanner with its own pre/post
                 expiry variants based on status + trial_ends_at.
                 Same Slice 5 logic, unchanged by Slice 6.
              3. Track B (non-founders):
                 a. stripe_subscription_id IS NOT NULL → no banner
                    (Stripe-managed sub or trial; webhook handles
                    state transitions).
                 b. status='trialing' + sub_id IS NULL +
                    trial_ends_at > now() → StartTrialBanner
                    variant="pre_expiry" with formatTrialRemaining
                    subtitle.
                 c. status='trialing' + sub_id IS NULL +
                    trial_ends_at <= now() → StartTrialBanner
                    variant="expired" (Slice 6 NEW — red urgent
                    treatment; billing-guard enforces read-only
                    at the API surface for this same condition).
                 d. canceled / past_due / etc. → no banner. Rare in
                    practice; billing-guard will block any writes
                    these users attempt anyway. */}
        {(() => {
          const role = wsMembershipResult.data?.role;
          const isOwnerOrAdmin = role === "owner" || role === "admin";
          if (!isOwnerOrAdmin) return null;

          const isFounder =
            profileRes.data?.is_founding_member === true;
          const status = billingRes.data?.subscription_status ?? null;
          const subId = billingRes.data?.stripe_subscription_id ?? null;
          const trialEndsAt = billingRes.data?.trial_ends_at ?? null;

          // BR-1 (fix): inactive-subscription branch hoisted ABOVE the
          // founder/Track-B split. subscription_status describes the
          // workspace's billing state, not the owner's identity — a
          // broken sub is a broken sub regardless of who owns the
          // workspace. Pre-fix, the founder branch's catch-all
          // "all other founder states → no banner" return null swallowed
          // 'past_due' / 'canceled' (post-Stripe-billing, not the
          // founder-cron path) / 'incomplete' / 'unpaid' / 'paused' for
          // founder-owned workspaces, leaving Jordan (and any future
          // founder whose sub breaks) with zero in-app signal.
          //
          // Special case: status === 'canceled' AND subId IS NULL is the
          // founder-day-30-cron post-expiry state — that path keeps
          // routing through FoundingTrialEndingBanner below, since the
          // copy is founder-specific ("Your founding trial ended, want
          // to convert?"). All OTHER 'canceled' variants (Stripe sub
          // deletion, etc.) route through the inactive banner.
          const INACTIVE_STATUSES = [
            "canceled",
            "past_due",
            "incomplete",
            "incomplete_expired",
            "unpaid",
            "paused",
          ] as const;
          type InactiveStatus = (typeof INACTIVE_STATUSES)[number];
          const isFounderPostCronCanceled =
            isFounder && status === "canceled" && subId === null;
          if (
            status &&
            (INACTIVE_STATUSES as readonly string[]).includes(status) &&
            !isFounderPostCronCanceled
          ) {
            return (
              <StartTrialBanner
                workspaceId={ws.id}
                workspaceSlug={ws.slug}
                variant="inactive"
                remainingPhrase={null}
                inactiveStatus={status as InactiveStatus}
              />
            );
          }

          if (isFounder) {
            // pre_expiry — Track A trial within 72h of deadline.
            if (
              status === "trialing" &&
              subId === null &&
              trialEndsAt
            ) {
              const trialEnd = new Date(trialEndsAt);
              // eslint-disable-next-line react-hooks/purity
              const remainingMs = trialEnd.getTime() - Date.now();
              if (remainingMs > 0 && remainingMs <= 72 * 60 * 60 * 1000) {
                return (
                  <FoundingTrialEndingBanner
                    workspaceId={ws.id}
                    workspaceSlug={ws.slug}
                    variant="pre_expiry"
                    remainingPhrase={formatTrialRemaining(trialEnd)}
                  />
                );
              }
              return null;
            }
            // post_expiry — Track A trial has been canceled by the
            // day-30 cron.
            if (status === "canceled" && subId === null) {
              return (
                <FoundingTrialEndingBanner
                  workspaceId={ws.id}
                  workspaceSlug={ws.slug}
                  variant="post_expiry"
                  remainingPhrase={null}
                />
              );
            }
            // All other founder states (active sub, past_due, null
            // row, trialing >72h out, etc.) → no banner.
            return null;
          }

          // Track B (non-founder) — Slice 6 logic.
          if (subId !== null) {
            // Stripe-managed sub or post-checkout trial: no banner.
            // If billing state goes bad (past_due, canceled), the
            // Stripe webhook updates workspace_billing and the
            // billing-guard takes over enforcement.
            return null;
          }

          if (status === "trialing" && trialEndsAt) {
            const trialEnd = new Date(trialEndsAt);
            // eslint-disable-next-line react-hooks/purity
            const remainingMs = trialEnd.getTime() - Date.now();
            if (remainingMs > 0) {
              // pre_expiry — Track B in-flight 14-day trial.
              return (
                <StartTrialBanner
                  workspaceId={ws.id}
                  workspaceSlug={ws.slug}
                  variant="pre_expiry"
                  remainingPhrase={formatTrialRemaining(trialEnd)}
                />
              );
            }
            // expired — trial deadline has passed and the day-12
            // cron hasn't flipped status to 'canceled' yet (or it
            // never will because there's no Stripe sub to manage).
            // billing-guard.ts gate 5 returns 403 for write attempts
            // on this state, so the banner's "read-only" promise is
            // truthful.
            return (
              <StartTrialBanner
                workspaceId={ws.id}
                workspaceSlug={ws.slug}
                variant="expired"
                remainingPhrase={null}
              />
            );
          }

          // BR-1 fix: inactive-status branch hoisted to the top of
          // this block (see the comment above the hoisted check). The
          // original Track-B-position branch that used to live here is
          // gone — the hoisted version handles both founder + non-
          // founder paths, and removing the duplicate keeps the
          // INACTIVE_STATUSES array single-sourced.

          // Final fallthrough — null workspace_billing row (personal
          // workspaces, or a future state that slips through). No
          // banner; billing-guard handles writes if applicable.
          return null;
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-7">
          <MyTasksCard
            workspaceName={ws.name}
            workspaceSlug={ws.slug}
            tasks={myTasksTopFive}
            totalCount={myTasks.length}
            error={myTasksRes.error?.message ?? null}
          />
          <ActivityCard
            workspaceSlug={ws.slug}
            events={activityEnriched}
            error={activityRes.error?.message ?? null}
          />
        </div>

        {/* Team chat strip — DEFERRED, not deleted (2026-05-25).
            Workspace-level team chat was scoped out for v1: the prior
            "Team / internal only / no messages yet / Start a
            conversation / Open chat" empty-state strip rendered on
            every dashboard load with no path to a working surface,
            which read as a broken promise to first-time users.
            Per-pipeline chat is unaffected — fully live in the canvas
            chrome (/w/[slug]/p/[id]/chat).
            To re-add when workspace chat schema lands:
              1. Re-import TeamChatStrip from
                 @/components/dashboard/TeamChatStrip (file kept).
              2. Re-mount here between ActivityCard and
                 PipelinesSection — same slot as before.
              3. Gate on workspaces.plan === 'team' once the plan
                 column ships (Phase 6 Stripe billing).
            No tables, no migrations, no per-pipeline chat affected. */}

        <PipelinesSection
          workspaceSlug={ws.slug}
          pipelines={pipelines}
          error={pipelinesRes.error?.message ?? null}
          // Role gate for the "Create pipeline" CTA on the empty-state
          // card. Same rule as the AppShell header button + the RPC's
          // is_workspace_owner_or_admin gate. Members see a member-
          // appropriate empty-state message instead of the CTA.
          canCreatePipeline={
            wsMembershipResult.data?.role === "owner" ||
            wsMembershipResult.data?.role === "admin"
          }
        />
      </div>
    </div>
  );
}
