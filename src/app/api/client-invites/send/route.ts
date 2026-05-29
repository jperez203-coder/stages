import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendClientInviteEmail } from "@/lib/email";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
// New-style Supabase key system (sb_secret_... format), NOT the legacy
// SUPABASE_SERVICE_ROLE_KEY JWT. Functionally equivalent — bypasses RLS,
// must stay server-side only.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/client-invites/send
 *
 * Inserts a `client_invites` row AND generates a Supabase magic link AND
 * sends the recipient an email. The magic link is the primary CTA in the
 * email; clicking it auths the recipient and redirects to
 * /portal/accept/[token] in one click.
 *
 * Body: { pipeline_id: uuid, email: string }
 *
 * Auth: bearer JWT in Authorization header. Authz happens via RLS on the
 * `client_invites_insert` policy (gated by `can_edit_pipeline`) — if the
 * caller isn't owner/admin of the pipeline, the insert fails with 42501
 * which we surface as a 403.
 *
 * Two Supabase clients in use:
 *   * supaAsUser — initialised with the publishable key + caller's JWT in
 *     the Authorization header. Used for the insert (RLS-gated) AND for
 *     fetching pipeline / inviter details (also RLS-gated). If the caller
 *     can't see something, we shouldn't either.
 *   * supaAdmin — initialised with the secret key. ONLY used for
 *     auth.admin.generateLink (which requires bypass). Never used for
 *     anything else in this route.
 */
export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: Supabase env vars missing" },
      { status: 500 },
    );
  }

  // ─── Parse + validate body ───────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { pipelineId, email } = parseBody(body);
  if (!pipelineId || !UUID_REGEX.test(pipelineId)) {
    return NextResponse.json(
      { error: "pipeline_id must be a UUID" },
      { status: 400 },
    );
  }
  if (!email || !EMAIL_REGEX.test(email)) {
    return NextResponse.json(
      { error: "email is missing or invalid" },
      { status: 400 },
    );
  }
  const trimmedEmail = email.trim();

  // ─── Auth ────────────────────────────────────────────────────────────────
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
  const callerId = userResult.user.id;

  // ─── Insert invite (RLS gates owner/admin via can_edit_pipeline) ─────────
  const inserted = await supaAsUser
    .from("client_invites")
    .insert({
      pipeline_id: pipelineId,
      email: trimmedEmail,
      invited_by: callerId,
    })
    .select("token, expires_at")
    .single();

  if (inserted.error) {
    // 42501 = RLS denial (caller isn't owner/admin of this pipeline)
    if (inserted.error.code === "42501") {
      return NextResponse.json(
        { error: "You don't have permission to invite clients to this pipeline" },
        { status: 403 },
      );
    }
    // 23503 = FK violation (pipeline_id doesn't exist)
    if (inserted.error.code === "23503") {
      return NextResponse.json(
        { error: "Pipeline not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: inserted.error.message },
      { status: 500 },
    );
  }

  const token = inserted.data.token as string;

  // ─── Fetch pipeline + inviter for the email body ─────────────────────────
  // All RLS-gated. The caller passed insert authz; reads should succeed too.
  // The workspace name lookup was dropped 2026-05-29 (the template stopped
  // using it on 2026-05-28); the new `company_name` on profiles is what
  // surfaces in the email header now.
  const [pipelineResult, profileResult] = await Promise.all([
    supaAsUser
      .from("pipelines")
      .select("name")
      .eq("id", pipelineId)
      .maybeSingle(),
    supaAsUser
      .from("profiles")
      .select("display_name, email, company_name")
      .eq("id", callerId)
      .maybeSingle(),
  ]);

  if (pipelineResult.error || !pipelineResult.data) {
    return NextResponse.json(
      { error: "Pipeline not accessible" },
      { status: 404 },
    );
  }

  const pipelineName = pipelineResult.data.name as string;
  const profile = profileResult.data as
    | { display_name: string | null; email: string; company_name: string | null }
    | null;
  const inviterName =
    profile?.display_name ||
    profile?.email ||
    userResult.user.email ||
    "Someone";
  const companyName = profile?.company_name ?? null;

  // ─── Generate magic link (admin-only, secret key required) ───────────────
  const origin = new URL(request.url).origin;
  const portalAcceptUrl = `${origin}/portal/accept/${token}`;

  const supaAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: linkData, error: linkError } =
    await supaAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: trimmedEmail,
      options: { redirectTo: portalAcceptUrl },
    });

  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      {
        error:
          linkError?.message ||
          "Failed to generate magic link for invite",
      },
      { status: 500 },
    );
  }

  const magicLinkUrl = linkData.properties.action_link;

  // ─── Send email ──────────────────────────────────────────────────────────
  const sendResult = await sendClientInviteEmail({
    to: trimmedEmail,
    pipelineName,
    inviterName,
    companyName,
    acceptUrl: magicLinkUrl,
    logoUrl: `${origin}/stages-logo.png`,
  });

  if (!sendResult.ok) {
    // Invite is created; email failed. Return error so the UI surfaces
    // it. Operator can revoke + retry, or share the link manually from
    // the team page (copy affordance works on the row).
    return NextResponse.json(
      {
        error: `Invite created but email failed: ${sendResult.error}. Copy the link from the pending list and share it manually.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    token,
    // /portal/accept/[token] URL — what the team UI's "Copy link"
    // affordance should use, NOT the long magic-link URL.
    accept_url: portalAcceptUrl,
  });
}

function parseBody(body: unknown): {
  pipelineId: string | null;
  email: string | null;
} {
  if (typeof body !== "object" || body === null) {
    return { pipelineId: null, email: null };
  }
  const r = body as Record<string, unknown>;
  const pipelineId = typeof r.pipeline_id === "string" ? r.pipeline_id : null;
  const email = typeof r.email === "string" ? r.email : null;
  return { pipelineId, email };
}
