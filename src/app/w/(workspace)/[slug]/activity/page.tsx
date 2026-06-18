import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ActivityBody } from "./ActivityBody";
import type { ActivityEventVM } from "./ActivityBody";

/**
 * /w/[slug]/activity — workspace-level activity inbox. NF-3.
 *
 * Renders a per-user notifications feed scoped to the current workspace.
 * Companion to (but DISTINCT from) the existing per-pipeline `activity_events`
 * feed that powers the dashboard's Activity card + the pipeline-page Activity
 * tab — those are pipeline-feed events ("Sarah moved Apex Roofing to Stage 3"
 * etc.), shared by every pipeline viewer. This page reads the per-user
 * `notifications` table from NF-1, scoped to events directed at the caller.
 *
 * Auth posture (mirrors the dashboard at /w/[slug]/page.tsx, PI-5a widen):
 *   1. Anonymous → /auth/signin?next=/w/[slug]/activity
 *   2. workspace_memberships row OR pipeline_memberships row (admin/member)
 *      on a pipeline in this workspace → render
 *   3. Otherwise → bounce back to /w/[slug] (which has the full fallback
 *      chain to client portal / workspace selector / etc.)
 *
 * Data layout:
 *   * notifications.recipient_id = current user, workspace_id = current ws,
 *     order by created_at desc, limit 50 (pagination deferred to NF-3.X)
 *   * Per-notification: actor profile (display_name, avatar_url, email)
 *   * Per-notification: source channel_message (text, mentions[], channel_id)
 *   * Per-source channel: name + is_client (drives the "client" badge)
 *   * Per-source pipeline: name (for breadcrumb context)
 *   * Per mentioned user_id across ALL surfaced messages: profile lookup so
 *     the NF-2 cyan render helper can match @-tokens at display time
 *
 * The chat-page deep link (?channel=...&message=...) is wired here but
 * the chat page does NOT yet read those query params to auto-scroll /
 * focus. That's flagged for a follow-up slice (NF-3.X — chat page deep-
 * link consumption); for now the link still navigates the user to the
 * correct channel, they just have to find the message themselves.
 */

export const dynamic = "force-dynamic";

type WorkspaceRow = { id: string; slug: string; name: string };

export default async function ActivityPage({
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
    redirect(`/auth/signin?next=/w/${encodeURIComponent(slug)}/activity`);
  }

  // ── Workspace + membership resolution (mirrors dashboard PI-5a) ────────
  const [wsMembershipResult, pipMembershipResult] = await Promise.all([
    supabase
      .from("workspace_memberships")
      .select(`role, workspace:workspaces!inner(id, slug, name)`)
      .eq("user_id", user.id)
      .eq("workspace.slug", slug)
      .maybeSingle(),
    supabase
      .from("pipeline_memberships")
      .select(
        `role, pipeline:pipelines!inner(workspace:workspaces!inner(id, slug, name))`,
      )
      .eq("user_id", user.id)
      .in("role", ["admin", "member"])
      .eq("pipeline.workspace.slug", slug)
      .limit(1)
      .maybeSingle(),
  ]);

  let workspace: WorkspaceRow | null = null;
  if (wsMembershipResult.data) {
    const wsEmbed = wsMembershipResult.data.workspace as unknown;
    const wsObj = (Array.isArray(wsEmbed) ? wsEmbed[0] : wsEmbed) as
      | WorkspaceRow
      | undefined;
    workspace = wsObj ?? null;
  } else if (pipMembershipResult.data) {
    const pipEmbed = pipMembershipResult.data.pipeline as unknown;
    const pipObj = (Array.isArray(pipEmbed) ? pipEmbed[0] : pipEmbed) as
      | { workspace: WorkspaceRow | WorkspaceRow[] }
      | undefined;
    if (pipObj) {
      const wsEmbed = pipObj.workspace as unknown;
      workspace = (Array.isArray(wsEmbed) ? wsEmbed[0] : wsEmbed) as
        | WorkspaceRow
        | null;
    }
  }

  if (!workspace) {
    // No membership → defer to the dashboard's broader fallback chain.
    redirect(`/w/${encodeURIComponent(slug)}`);
  }

  // ── Notifications feed (50 most recent for this user × workspace) ──────
  // NF-3.1: every relation is fetched in its own batched query — no
  // PostgREST embeds. The earlier draft tried embedding `actor:profiles
  // !actor_id` and `pipeline:pipelines!pipeline_id`. The actor embed was
  // the breakage: notifications.actor_id has an FK to auth.users(id),
  // not profiles(id); PostgREST's "chained-via-shared-key" detection
  // doesn't reliably bridge that gap, and even when it does, profiles_-
  // select RLS layers atop are non-trivial. Result was the whole
  // notifications query erroring (PostgrestError 'PGRST200' /
  // 'PGRST201' — relationship ambiguity). One ambiguous embed nukes
  // the whole select, which is why the surface went empty + errored.
  //
  // Five queries, all batched: notifications, pipelines IN(...),
  // profiles IN(actor_ids ∪ mention_ids), channel_messages IN(...)
  // (embedding channels — that FK is explicit + RLS-safe). Costs one
  // extra round-trip vs the embed approach; readable + bulletproof.
  const notifsRes = await supabase
    .from("notifications")
    .select(
      `id, kind, source_kind, source_id, read_at, created_at,
       actor_id, pipeline_id`,
    )
    .eq("recipient_id", user.id)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (notifsRes.error) {
    // Log PostgrestError fields explicitly — `console.error(err)` alone
    // serializes to `{}` because the relevant fields aren't enumerable
    // own-props (same lesson called out in ChatBody.tsx after the
    // agency-admin chat bug, 2026-06-15).
    console.error(
      "[activity] notifications fetch failed:",
      notifsRes.error.message,
      "code:",
      notifsRes.error.code,
      "details:",
      notifsRes.error.details,
      "hint:",
      notifsRes.error.hint,
    );
    return (
      <ActivityBody
        workspace={workspace}
        events={[]}
        loadError="Couldn't load activity. Refresh and try again."
        initialUnreadCount={0}
      />
    );
  }

  const notifs = notifsRes.data ?? [];

  // ── Batched lookups: pipelines, channel_messages (+ channels embed) ────
  const pipelineIds = Array.from(
    new Set(notifs.map((n) => n.pipeline_id as string).filter(Boolean)),
  );
  const sourceIds = notifs
    .filter((n) => n.source_kind === "channel_message")
    .map((n) => n.source_id as string);

  const pipelinesPromise = pipelineIds.length
    ? supabase.from("pipelines").select("id, name").in("id", pipelineIds)
    : Promise.resolve({ data: [], error: null } as const);

  type ChannelMessageRow = {
    id: string;
    text: string;
    mentions: string[] | null;
    channel:
      | { id: string; name: string; is_client: boolean }
      | Array<{ id: string; name: string; is_client: boolean }>;
  };

  const messagesPromise = sourceIds.length
    ? supabase
        .from("channel_messages")
        .select(
          // channels embed is safe — channel_messages.channel_id has an
          // explicit FK to channels(id), and channels_select RLS lets the
          // caller see channels they're a member of (which they must be,
          // since they received a notification sourced from this message).
          `id, text, mentions,
           channel:channels!channel_id(id, name, is_client)`,
        )
        .in("id", sourceIds)
    : Promise.resolve({ data: [], error: null } as const);

  const [pipelinesRes, messagesRes] = await Promise.all([
    pipelinesPromise,
    messagesPromise,
  ]);

  if (pipelinesRes.error) {
    console.error(
      "[activity] pipelines fetch failed:",
      pipelinesRes.error.message,
      "code:",
      pipelinesRes.error.code,
    );
  }
  if (messagesRes.error) {
    console.error(
      "[activity] channel_messages fetch failed:",
      messagesRes.error.message,
      "code:",
      messagesRes.error.code,
      "details:",
      messagesRes.error.details,
    );
  }

  const pipelinesById = new Map<string, { id: string; name: string }>();
  for (const p of pipelinesRes.data ?? []) {
    pipelinesById.set(p.id as string, {
      id: p.id as string,
      name: p.name as string,
    });
  }

  const messagesById = new Map<
    string,
    {
      id: string;
      text: string;
      mentions: string[];
      channelId: string;
      channelName: string;
      channelIsClient: boolean;
    }
  >();
  for (const m of (messagesRes.data ?? []) as ChannelMessageRow[]) {
    const chEmbed = m.channel as unknown;
    const chObj = (Array.isArray(chEmbed) ? chEmbed[0] : chEmbed) as
      | { id: string; name: string; is_client: boolean }
      | undefined;
    if (!chObj) continue;
    messagesById.set(m.id, {
      id: m.id,
      text: m.text,
      mentions: m.mentions ?? [],
      channelId: chObj.id,
      channelName: chObj.name,
      channelIsClient: chObj.is_client,
    });
  }

  // ── Profile batch (actors + mention user_ids in one query) ─────────────
  // NF-3.1: actor profile fetch moved out of the notifications embed. The
  // earlier `actor:profiles!actor_id` embed broke because
  // notifications.actor_id FKs to auth.users(id), not profiles(id).
  // PostgREST's chained-relation detection isn't reliable here, and
  // profiles_select RLS on top means a misdetected ambiguity surfaces
  // as a PGRST20x error that nukes the whole notifications select.
  const profileIds = new Set<string>();
  for (const n of notifs) {
    if (n.actor_id) profileIds.add(n.actor_id as string);
  }
  for (const msg of messagesById.values()) {
    for (const uid of msg.mentions) profileIds.add(uid);
  }

  const profilesById = new Map<
    string,
    {
      id: string;
      display_name: string | null;
      email: string | null;
      avatar_url: string | null;
    }
  >();
  if (profileIds.size > 0) {
    const profsRes = await supabase
      .from("profiles")
      .select("id, display_name, email, avatar_url")
      .in("id", Array.from(profileIds));
    if (profsRes.error) {
      console.error(
        "[activity] profiles fetch failed:",
        profsRes.error.message,
        "code:",
        profsRes.error.code,
      );
    } else {
      for (const p of profsRes.data ?? []) {
        profilesById.set(p.id as string, {
          id: p.id as string,
          display_name: (p.display_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
          avatar_url: (p.avatar_url as string | null) ?? null,
        });
      }
    }
  }

  // mentionedProfilesById is the trimmed shape NF-2's helper consumes
  // (no avatar_url). Built from the same batched fetch.
  const mentionedProfilesById: Record<
    string,
    { id: string; display_name: string | null; email: string | null }
  > = {};
  for (const msg of messagesById.values()) {
    for (const uid of msg.mentions) {
      const p = profilesById.get(uid);
      if (p) {
        mentionedProfilesById[uid] = {
          id: p.id,
          display_name: p.display_name,
          email: p.email,
        };
      }
    }
  }

  // ── Assemble view models ──────────────────────────────────────────────
  const events: ActivityEventVM[] = [];
  let initialUnreadCount = 0;

  for (const n of notifs) {
    const pipeline = pipelinesById.get(n.pipeline_id as string);
    const message = messagesById.get(n.source_id as string);
    const actor = n.actor_id
      ? profilesById.get(n.actor_id as string) ?? null
      : null;

    // Skip events whose source message was deleted (cascade) or whose
    // pipeline was deleted (FK cascade) — defensive. Notifications
    // table FK-cascades on pipeline_id, so pipeline being null shouldn't
    // happen in practice, but we don't want a partial render to crash.
    if (!pipeline || !message) continue;

    if (!n.read_at) initialUnreadCount += 1;

    events.push({
      id: n.id as string,
      kind: n.kind as "mention" | "client_message",
      read: Boolean(n.read_at),
      createdAt: n.created_at as string,
      actor: actor
        ? {
            id: actor.id,
            displayName: actor.display_name,
            avatarUrl: actor.avatar_url,
            email: actor.email,
          }
        : null,
      pipeline: { id: pipeline.id, name: pipeline.name },
      channel: {
        id: message.channelId,
        name: message.channelName,
        isClient: message.channelIsClient,
      },
      message: {
        id: message.id,
        text: message.text,
        mentions: message.mentions,
      },
    });
  }

  return (
    <ActivityBody
      workspace={workspace}
      events={events}
      mentionedProfilesById={mentionedProfilesById}
      initialUnreadCount={initialUnreadCount}
    />
  );
}
