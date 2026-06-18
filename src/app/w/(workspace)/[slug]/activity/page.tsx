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
  // Embeds:
  //   actor — auth.users-linked profile for the avatar + name
  //   pipeline — for breadcrumb context
  // channel_messages can't embed because source_id is a typed-uuid not an
  // FK; fetch separately by source_id list.
  const notifsRes = await supabase
    .from("notifications")
    .select(
      `id, kind, source_kind, source_id, read_at, created_at, actor_id, pipeline_id,
       actor:profiles!actor_id(id, display_name, avatar_url, email),
       pipeline:pipelines!pipeline_id(id, name)`,
    )
    .eq("recipient_id", user.id)
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (notifsRes.error) {
    console.error("[activity] notifications fetch failed:", notifsRes.error.message);
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

  // ── Resolve source channel_messages in one batch ───────────────────────
  const sourceIds = notifs
    .filter((n) => n.source_kind === "channel_message")
    .map((n) => n.source_id as string);

  type ChannelMessageRow = {
    id: string;
    text: string;
    mentions: string[] | null;
    channel:
      | { id: string; name: string; is_client: boolean }
      | Array<{ id: string; name: string; is_client: boolean }>;
  };

  let messagesById = new Map<
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

  if (sourceIds.length > 0) {
    const msgsRes = await supabase
      .from("channel_messages")
      .select(
        `id, text, mentions,
         channel:channels!channel_id(id, name, is_client)`,
      )
      .in("id", sourceIds);

    if (msgsRes.error) {
      console.error("[activity] messages fetch failed:", msgsRes.error.message);
    } else {
      for (const m of (msgsRes.data ?? []) as ChannelMessageRow[]) {
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
    }
  }

  // ── Resolve mentioned-profile lookup so NF-2's cyan helper can match ───
  const mentionUserIds = new Set<string>();
  for (const msg of messagesById.values()) {
    for (const uid of msg.mentions) mentionUserIds.add(uid);
  }

  let mentionedProfilesById: Record<
    string,
    { id: string; display_name: string | null; email: string | null }
  > = {};

  if (mentionUserIds.size > 0) {
    const profsRes = await supabase
      .from("profiles")
      .select("id, display_name, email")
      .in("id", Array.from(mentionUserIds));

    if (!profsRes.error) {
      for (const p of profsRes.data ?? []) {
        mentionedProfilesById[p.id as string] = {
          id: p.id as string,
          display_name: (p.display_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
        };
      }
    }
  }

  // ── Assemble view models ──────────────────────────────────────────────
  const events: ActivityEventVM[] = [];
  let initialUnreadCount = 0;

  for (const n of notifs) {
    const actorEmbed = n.actor as unknown;
    const actor = (Array.isArray(actorEmbed) ? actorEmbed[0] : actorEmbed) as
      | {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          email: string | null;
        }
      | null;

    const pipEmbed = n.pipeline as unknown;
    const pipeline = (Array.isArray(pipEmbed) ? pipEmbed[0] : pipEmbed) as
      | { id: string; name: string }
      | null;

    const message = messagesById.get(n.source_id as string);

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
