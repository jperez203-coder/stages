import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { assertSubscriptionWritable } from "@/lib/billing-guard";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pipeline-memberships/add
 *
 * Adds an existing workspace_memberships member to a specific pipeline
 * as an agency-side member (role='member' or 'admin'). Body:
 *
 *   { pipeline_id: uuid, user_id: uuid, role?: 'member' | 'admin' }
 *
 * Default role is 'member'. The UI picker (MembersBody) always sends
 * 'member'; 'admin' is accepted on the wire for future picker expansion
 * and SQL-side parity.
 *
 * BILLING-POLICY RATIONALE (PI-followup-1)
 * ─────────────────────────────────────────
 * The PI-3 email-invite-by-role architecture would have let agency
 * owners bypass per-seat Team-plan pricing by inviting "members" to
 * pipelines via email without ever writing workspace_memberships rows
 * (which are what the seat-sync cron counts). That's a revenue
 * exploit.
 *
 * Fix: members can only be added to a pipeline via this endpoint, and
 * this endpoint requires the target user to ALREADY have a
 * workspace_memberships row for the parent workspace. The email-invite
 * route (/api/client-invites/send) now hard-rejects role='member' /
 * 'admin' (PI-followup-1).
 *
 * In effect:
 *   1. Workspace Settings → Team → invite by email → workspace_memberships
 *      row → seat-sync cron bills.
 *   2. Per pipeline → People → Members sub-tab → picker → click →
 *      pipeline_memberships row (this endpoint).
 *
 * Pipeline_memberships is now strictly a NARROWING layer (which pipelines
 * this billable seat can work on), never an ADDITIVE substitute for being
 * a seat.
 *
 * AUTHZ
 * ─────
 *   1. Bearer JWT (anonymous → 401).
 *   2. The actual INSERT runs inside the add_pipeline_member RPC
 *      (PI-followup-2), a SECURITY DEFINER function. The RPC re-checks
 *      auth, workspace type, and authz inline. This route still does
 *      a pre-flight read to produce clean HTTP error envelopes ahead
 *      of the RPC, but the RPC is the authoritative floor.
 *
 * RPC RATIONALE (PI-followup-2)
 * ─────────────────────────────
 * The first cut of this endpoint did a direct PostgREST INSERT into
 * pipeline_memberships. That triggered postgres 42P17 ("infinite
 * recursion detected in policy for relation 'pipeline_memberships'")
 * via the pipeline_memberships_seed_channels AFTER INSERT trigger
 * (which inserts into channel_memberships whose INSERT policy reads
 * pipeline_memberships) and via the RETURNING SELECT (which re-evaluates
 * is_pipeline_agency_member, also reading pipeline_memberships).
 *
 * The fix is the same pattern as create_workspace_with_owner and
 * accept_client_invite: a SECURITY DEFINER RPC that bypasses every
 * RLS policy on every table it touches.
 *
 * VALIDATIONS
 * ───────────
 *   * pipeline + parent workspace must exist (RLS-gated read).
 *   * Workspace.type != 'personal' (WT-4 gate — personal workspaces
 *     are solo by definition, no team members).
 *   * Billing gate (assertSubscriptionWritable) — canceled / past-due
 *     workspaces can't add members.
 *   * Target user MUST already be in workspace_memberships for the
 *     parent workspace. Forecloses any back-door member-by-pipeline
 *     trick that could bypass seat counting.
 *   * Target user MUST NOT already be in pipeline_memberships for this
 *     pipeline (409 conflict with the existing role).
 */
export async function POST(request: Request) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return NextResponse.json(
      { error: "Server misconfigured: Supabase env vars missing" },
      { status: 500 },
    );
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { pipelineId, userId, role } = parseBody(body);
  if (!pipelineId || !UUID_REGEX.test(pipelineId)) {
    return NextResponse.json(
      { error: "pipeline_id must be a UUID" },
      { status: 400 },
    );
  }
  if (!userId || !UUID_REGEX.test(userId)) {
    return NextResponse.json(
      { error: "user_id must be a UUID" },
      { status: 400 },
    );
  }
  if (role === null) {
    return NextResponse.json(
      { error: "role must be 'member' or 'admin'" },
      { status: 400 },
    );
  }

  // ── Auth ────────────────────────────────────────────────────────────────
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

  const { data: userResult, error: authError } =
    await supaAsUser.auth.getUser(jwt);
  if (authError || !userResult?.user) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 },
    );
  }

  // ── Resolve pipeline + parent workspace ────────────────────────────────
  // RLS lets the caller read pipelines they have agency-side access to;
  // a 404 here covers both "doesn't exist" and "no permission" identically
  // (same posture as /api/client-invites/send).
  const pipelineRes = await supaAsUser
    .from("pipelines")
    .select("workspace_id, workspace:workspaces!inner(type)")
    .eq("id", pipelineId)
    .maybeSingle();
  if (pipelineRes.error) {
    console.error(
      "[pipeline-memberships/add] pipeline lookup failed:",
      pipelineRes.error.message,
    );
    return NextResponse.json(
      { error: "Pipeline lookup failed" },
      { status: 500 },
    );
  }
  if (!pipelineRes.data) {
    return NextResponse.json(
      { error: "Pipeline not found or no permission" },
      { status: 404 },
    );
  }

  const workspaceId = pipelineRes.data.workspace_id as string;
  // PostgREST nested-select normalization (same pattern as elsewhere).
  const wsEmbed = pipelineRes.data.workspace as unknown;
  const wsObj = (Array.isArray(wsEmbed) ? wsEmbed[0] : wsEmbed) as
    | { type?: string }
    | undefined;
  if (wsObj?.type === "personal") {
    return NextResponse.json(
      {
        error: "members_not_available_on_personal",
        message:
          "Personal workspaces do not support team members. Convert to an Agency workspace first.",
      },
      { status: 403 },
    );
  }

  // ── Billing gate ───────────────────────────────────────────────────────
  const block = await assertSubscriptionWritable(workspaceId, supaAsUser);
  if (block) return block;

  // ── Critical seat-flow gate: target MUST have workspace_memberships ───
  // The billing exploit this endpoint forecloses: an agency owner adding
  // pipeline members without going through the seat counter. If the target
  // user_id doesn't already hold a workspace_memberships row for this
  // workspace, refuse — they're not a billable seat yet.
  const targetWsMembership = await supaAsUser
    .from("workspace_memberships")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (targetWsMembership.error) {
    console.error(
      "[pipeline-memberships/add] target workspace_membership lookup failed:",
      targetWsMembership.error.message,
    );
    return NextResponse.json(
      { error: "Membership lookup failed" },
      { status: 500 },
    );
  }
  if (!targetWsMembership.data) {
    return NextResponse.json(
      {
        error: "target_user_not_workspace_member",
        message:
          "This user is not a workspace member yet. Invite them via Workspace Settings → Team first.",
      },
      { status: 400 },
    );
  }

  // ── Already-on-pipeline check ─────────────────────────────────────────
  const existingMembership = await supaAsUser
    .from("pipeline_memberships")
    .select("role")
    .eq("pipeline_id", pipelineId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existingMembership.error) {
    console.error(
      "[pipeline-memberships/add] existing membership check failed:",
      existingMembership.error.message,
    );
    return NextResponse.json(
      { error: "Membership lookup failed" },
      { status: 500 },
    );
  }
  if (existingMembership.data) {
    return NextResponse.json(
      {
        error: "already_member",
        existing_role: existingMembership.data.role,
        message: "This user already has access to this pipeline.",
      },
      { status: 409 },
    );
  }

  // ── INSERT via SECURITY DEFINER RPC (PI-followup-2) ────────────────────
  // The RPC does its own auth + workspace-type + authz + seat-membership
  // checks inline. Pre-flight checks above already produced cleaner HTTP
  // envelopes, but the RPC is the floor — and it bypasses the RLS
  // recursion that surfaced with a direct PostgREST INSERT.
  const rpcRes = await supaAsUser.rpc("add_pipeline_member", {
    pipeline_id: pipelineId,
    target_user_id: userId,
    target_role: role,
  });
  if (rpcRes.error) {
    // PostgREST surfaces postgres SQLSTATEs via `code`. Map to HTTP.
    const sqlstate = rpcRes.error.code;
    const msg = rpcRes.error.message || "";

    if (sqlstate === "42501") {
      // 42501 = insufficient_privilege. Three sub-cases by message:
      //   "Not authenticated"        → 401
      //   "Personal workspaces..."   → 403 (members_not_available_on_personal)
      //   "Target user is not..."    → 400 (target_user_not_workspace_member)
      //   "Not authorized..."        → 403 (not_authorized)
      if (msg.startsWith("Not authenticated")) {
        return NextResponse.json(
          { error: "Not authenticated" },
          { status: 401 },
        );
      }
      if (msg.startsWith("Personal workspaces")) {
        return NextResponse.json(
          {
            error: "members_not_available_on_personal",
            message: msg,
          },
          { status: 403 },
        );
      }
      if (msg.startsWith("Target user is not a workspace member")) {
        return NextResponse.json(
          {
            error: "target_user_not_workspace_member",
            message: msg,
          },
          { status: 400 },
        );
      }
      // Default 42501 → not_authorized.
      return NextResponse.json(
        {
          error: "not_authorized",
          message: msg || "You don't have permission to add members to this pipeline.",
        },
        { status: 403 },
      );
    }

    if (sqlstate === "22023") {
      // Invalid argument: pipeline not found OR invalid role.
      if (msg.startsWith("Pipeline not found")) {
        return NextResponse.json(
          { error: "Pipeline not found or no permission" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: msg || "Invalid argument" },
        { status: 400 },
      );
    }

    if (sqlstate === "23505") {
      // Already a pipeline member.
      return NextResponse.json(
        {
          error: "already_member",
          message: msg,
        },
        { status: 409 },
      );
    }

    console.error(
      "[pipeline-memberships/add] rpc failed:",
      msg,
      "code:",
      sqlstate,
    );
    return NextResponse.json(
      { error: msg || "Add failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    membership: {
      user_id: userId,
      role,
    },
  });
}

function parseBody(body: unknown): {
  pipelineId: string | null;
  userId: string | null;
  role: "member" | "admin" | null;
} {
  if (typeof body !== "object" || body === null) {
    return { pipelineId: null, userId: null, role: "member" };
  }
  const r = body as Record<string, unknown>;
  const pipelineId =
    typeof r.pipeline_id === "string" ? r.pipeline_id : null;
  const userId = typeof r.user_id === "string" ? r.user_id : null;
  // role: optional, defaults to 'member'. UI picker always sends 'member';
  // 'admin' is reserved for future UI expansion + SQL-side parity.
  let role: "member" | "admin" | null;
  if (r.role === undefined || r.role === null) {
    role = "member";
  } else if (r.role === "member" || r.role === "admin") {
    role = r.role;
  } else {
    role = null;
  }
  return { pipelineId, userId, role };
}
