import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendInviteEmail } from "@/lib/email";
import { assertSubscriptionWritable } from "@/lib/billing-guard";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * POST /api/invites/send
 *
 * Sends the invite email for an already-inserted workspace_invites row.
 * The row insert happens client-side via supabase-js (RLS enforces that
 * the caller is workspace owner or admin); this route handler does the
 * email side only, since RESEND_API_KEY is server-only and shouldn't ship
 * to the browser.
 *
 * Why split insert (client) + email (server): keeps the server route
 * narrow and stateless. The client already has the user's JWT in
 * localStorage; doing the insert there is one round trip, RLS-protected.
 * The route handler doesn't need its own user-scoped Supabase client for
 * the insert — it just verifies the caller is authenticated and sends.
 *
 * Auth: requires a valid Supabase JWT in the Authorization header. The
 * RLS guard upstream is the real authorization barrier (only owners +
 * admins could have inserted the invite); this auth check stops anonymous
 * callers from hitting the email endpoint directly to spam through our
 * sender domain.
 *
 * Accept URL is composed server-side from the request origin — not taken
 * from the request body — so a compromised client can't redirect the link
 * to a phishing target.
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

  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Verify the caller is signed in. Anonymous callers (no Authorization
  // header, or an invalid/expired JWT) are rejected here before we ever
  // call Resend.
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
  // Fresh per-request client; we don't reuse a singleton because this
  // server-side context has no persistent session.
  const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: userResult, error: authError } = await supa.auth.getUser(jwt);
  if (authError || !userResult?.user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  // ── Billing gate ─────────────────────────────────────────────────────
  // Look up the invite row to resolve workspace_id (the request body
  // carries only the token; the client-side INSERT into workspace_invites
  // already happened before this email-only route was called). RLS on
  // workspace_invites_select restricts visibility to workspace owner /
  // admin, so the same RLS that controls who can invite gates who can
  // resolve workspace_id here. A 404 below masks both "not found" and
  // "not permitted" identically.
  const inviteRes = await supa
    .from("workspace_invites")
    .select("workspace_id")
    .eq("token", parsed.token)
    .maybeSingle();
  if (inviteRes.error) {
    console.error(
      "[invites/send] workspace_invites lookup failed:",
      inviteRes.error?.message,
      "code:", inviteRes.error?.code,
    );
    return NextResponse.json(
      { error: "Invite lookup failed" },
      { status: 500 },
    );
  }
  if (!inviteRes.data) {
    return NextResponse.json(
      { error: "Invite not found or no permission" },
      { status: 404 },
    );
  }
  const block = await assertSubscriptionWritable(
    inviteRes.data.workspace_id,
    supa,
  );
  if (block) return block;

  // Compose the accept URL server-side from the request's origin. A
  // malicious client passing a fake URL in the body would be ignored.
  const origin = new URL(request.url).origin;
  const acceptUrl = `${origin}/accept-invite/${parsed.token}`;

  const sendResult = await sendInviteEmail({
    to: parsed.to,
    role: parsed.role,
    workspaceName: parsed.workspaceName,
    inviterName: parsed.inviterName,
    acceptUrl,
    logoUrl: `${origin}/stages-logo.png`,
  });

  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, acceptUrl });
}

// ─── Body validation ────────────────────────────────────────────────────────

type ParsedBody = {
  to: string;
  role: "admin" | "member";
  workspaceName: string;
  inviterName: string;
  token: string;
};

function parseBody(body: unknown): ParsedBody | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.to !== "string" || !b.to.includes("@") || b.to.length > 254) {
    return { error: "Invalid email" };
  }
  if (b.role !== "admin" && b.role !== "member") {
    return { error: "Role must be 'admin' or 'member'" };
  }
  if (typeof b.token !== "string" || b.token.length === 0) {
    return { error: "Invalid token" };
  }
  if (
    typeof b.workspaceName !== "string" ||
    b.workspaceName.length === 0 ||
    b.workspaceName.length > 200
  ) {
    return { error: "Invalid workspace name" };
  }
  if (
    typeof b.inviterName !== "string" ||
    b.inviterName.length === 0 ||
    b.inviterName.length > 200
  ) {
    return { error: "Invalid inviter name" };
  }

  return {
    to: b.to,
    role: b.role,
    token: b.token,
    workspaceName: b.workspaceName,
    inviterName: b.inviterName,
  };
}
