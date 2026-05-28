import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendClientInviteEmail } from "@/lib/email";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

/**
 * POST /api/client-invites/resend
 *
 * Re-sends the email for an existing client_invites row WITHOUT creating
 * a new row or extending the expiry. Same token, same expires_at — but a
 * FRESH magic link (Supabase magic links have their own short TTL,
 * typically 1 hour by default, much shorter than the invite's 30-day TTL,
 * so a stale magic link is essentially guaranteed by the time the user
 * clicks Resend).
 *
 * Body: { token: uuid }
 *
 * Failure modes:
 *   * 401 — anonymous / bad JWT
 *   * 400 — token missing/malformed
 *   * 404 — invite gone (revoked / never existed / RLS-denied)
 *   * 410 — already accepted OR expired (locked decision: revoke +
 *     create new to "extend" the clock)
 *   * 500 — server misconfig, magic-link generation failed, or email
 *     send failed
 *
 * Same auth model as agency /api/invites/resend. RLS-gated read; user-
 * scoped supabase client throughout EXCEPT for the admin.generateLink
 * call which needs the secret key.
 */
export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: Supabase env vars missing" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = parseToken(body);
  if (!token) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  const supaAsUser = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userResult, error: authError } = await supaAsUser.auth.getUser(jwt);
  if (authError || !userResult?.user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  // Fetch invite (RLS gates owner/admin via the client_invites_select policy).
  const inviteResult = await supaAsUser
    .from("client_invites")
    .select(
      "token, email, accepted_at, expires_at, pipeline_id, invited_by",
    )
    .eq("token", token)
    .maybeSingle();

  if (inviteResult.error) {
    return NextResponse.json(
      { error: inviteResult.error.message },
      { status: 500 },
    );
  }
  if (!inviteResult.data) {
    return NextResponse.json(
      { error: "Invite not found or no permission" },
      { status: 404 },
    );
  }

  const invite = inviteResult.data as {
    token: string;
    email: string;
    accepted_at: string | null;
    expires_at: string;
    pipeline_id: string;
    invited_by: string | null;
  };

  if (invite.accepted_at !== null) {
    return NextResponse.json(
      { error: "This invite has already been accepted" },
      { status: 410 },
    );
  }

  if (new Date(invite.expires_at) <= new Date()) {
    return NextResponse.json(
      {
        error:
          "This invite has expired. Revoke it and create a new one to send a fresh link.",
      },
      { status: 410 },
    );
  }

  // Pipeline + workspace + inviter for the email body.
  const [pipelineResult, profileResult] = await Promise.all([
    supaAsUser
      .from("pipelines")
      .select("name, workspace:workspaces(name)")
      .eq("id", invite.pipeline_id)
      .maybeSingle(),
    invite.invited_by
      ? supaAsUser
          .from("profiles")
          .select("display_name, email")
          .eq("id", invite.invited_by)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (pipelineResult.error || !pipelineResult.data) {
    return NextResponse.json(
      { error: "Pipeline no longer accessible" },
      { status: 404 },
    );
  }

  const pipelineName = pipelineResult.data.name as string;
  // Same array-vs-object PostgREST nested-select quirk as the send route.
  const workspaceRel = pipelineResult.data.workspace as unknown as
    | { name: string }
    | { name: string }[]
    | null;
  const workspaceName = Array.isArray(workspaceRel)
    ? workspaceRel[0]?.name ?? "your workspace"
    : workspaceRel?.name ?? "your workspace";
  const profile = profileResult.data as
    | { display_name: string | null; email: string }
    | null;
  const inviterName = profile?.display_name || profile?.email || "Someone";

  // Generate a fresh magic link. The redirect target is the SAME
  // /portal/accept/[token] URL since the invite token is unchanged.
  const origin = new URL(request.url).origin;
  const portalAcceptUrl = `${origin}/portal/accept/${invite.token}`;

  const supaAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: linkData, error: linkError } =
    await supaAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: invite.email,
      options: { redirectTo: portalAcceptUrl },
    });

  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      {
        error:
          linkError?.message ||
          "Failed to generate magic link for resend",
      },
      { status: 500 },
    );
  }

  const magicLinkUrl = linkData.properties.action_link;

  const sendResult = await sendClientInviteEmail({
    to: invite.email,
    pipelineName,
    workspaceName,
    inviterName,
    acceptUrl: magicLinkUrl,
    logoUrl: `${origin}/stages-logo.png`,
  });

  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, accept_url: portalAcceptUrl });
}

function parseToken(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const t = (body as Record<string, unknown>).token;
  if (typeof t !== "string" || t.length === 0) return null;
  return t;
}
