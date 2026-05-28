import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendInviteEmail } from "@/lib/email";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * POST /api/invites/resend
 *
 * Re-sends the email for an existing workspace_invites row WITHOUT creating
 * a new row or extending the expiry. Same token, same expires_at — the user
 * just receives another copy of the email with the same link.
 *
 * Failure modes (each with a distinct HTTP status the client can branch on):
 *   * 401 — caller is anonymous OR JWT invalid
 *   * 400 — token missing/malformed in request body
 *   * 404 — invite not found, revoked since last load, OR caller lost permission
 *     (RLS denial collapses into not-found — same UX outcome)
 *   * 410 — invite already accepted (single-use) or expired (locked decision:
 *     resending an expired invite is misleading; revoke + create new is the
 *     intended path)
 *   * 500 — email send failed or server misconfigured
 *
 * Auth: same model as /api/invites/send. Bearer JWT in Authorization
 * header. The route uses the caller's JWT for every DB read, so RLS gates
 * the lookup — only the workspace's owners + admins can resend invites
 * for it.
 *
 * Accept URL is composed server-side from request origin (phishing-
 * resistant — same pattern as /send).
 */
export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
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

  // User-scoped client: every PostgREST request includes the caller's JWT,
  // so RLS evaluates as that user. Used for ALL the DB reads below — the
  // workspace_invites read in particular relies on this to filter to
  // workspaces the caller owns or admins. If the caller has no permission,
  // the invite query returns null (no row → no error) and we collapse to
  // a 404, indistinguishable from "doesn't exist."
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Explicit auth check separate from the RLS-gated query so we can return
  // a clean 401 for bad-JWT cases vs. 404 for permission-denied-on-existing-
  // invite cases. Without this, an invalid JWT would just yield a 404 from
  // the invite query, which is misleading.
  const { data: userResult, error: authError } = await supa.auth.getUser(jwt);
  if (authError || !userResult?.user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  // Fetch the invite. RLS filters to workspace_invites rows where the caller
  // is owner or admin (workspace_invites_select policy from 6a).
  const inviteResult = await supa
    .from("workspace_invites")
    .select(
      "token, email, role, accepted_at, expires_at, workspace_id, invited_by",
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
    // Could be: never existed, hard-deleted (revoked), or RLS hid it from
    // a caller who shouldn't see it. All three are 404 from the API's view.
    return NextResponse.json(
      { error: "Invite not found or no permission" },
      { status: 404 },
    );
  }

  const invite = inviteResult.data as {
    token: string;
    email: string;
    role: "admin" | "member";
    accepted_at: string | null;
    expires_at: string;
    workspace_id: string;
    invited_by: string | null;
  };

  if (invite.accepted_at !== null) {
    return NextResponse.json(
      { error: "This invite has already been accepted" },
      { status: 410 },
    );
  }

  // Locked decision: resending an expired invite is blocked. To "extend"
  // the clock the user revokes and creates a new one — that's a clearer
  // mental model than silently bumping the expiry.
  if (new Date(invite.expires_at) <= new Date()) {
    return NextResponse.json(
      {
        error:
          "This invite has expired. Revoke it and create a new one to send a fresh link.",
      },
      { status: 410 },
    );
  }

  // Workspace name + inviter info for the email body. Both gated by RLS;
  // worst case the inviter profile is null (auth.users row deleted →
  // ON DELETE SET NULL on invited_by → no profile lookup) and we use the
  // "Someone" fallback.
  const [wsResult, profResult] = await Promise.all([
    supa
      .from("workspaces")
      .select("name")
      .eq("id", invite.workspace_id)
      .maybeSingle(),
    invite.invited_by
      ? supa
          .from("profiles")
          .select("display_name, email")
          .eq("id", invite.invited_by)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (wsResult.error || !wsResult.data) {
    return NextResponse.json(
      { error: "Workspace no longer accessible" },
      { status: 404 },
    );
  }

  const profile = profResult.data as
    | { display_name: string | null; email: string }
    | null;
  const inviterName =
    profile?.display_name || profile?.email || "Someone";

  const origin = new URL(request.url).origin;
  const acceptUrl = `${origin}/accept-invite/${invite.token}`;

  const sendResult = await sendInviteEmail({
    to: invite.email,
    role: invite.role,
    workspaceName: (wsResult.data as { name: string }).name,
    inviterName,
    acceptUrl,
    logoUrl: `${origin}/stages-logo.png`,
  });

  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, acceptUrl });
}

function parseToken(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const t = (body as Record<string, unknown>).token;
  if (typeof t !== "string" || t.length === 0) return null;
  return t;
}
