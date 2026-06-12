import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pipeline-memberships/remove (PI-followup-3)
 *
 * Removes an existing pipeline_memberships row. Body:
 *
 *   { pipeline_id: uuid, target_user_id: uuid }
 *
 * Backed by the SECURITY DEFINER RPC `remove_pipeline_member`. Same
 * pattern as the add endpoint (PI-followup-2) — direct PostgREST DELETE
 * would re-enter pipeline_memberships RLS via the helpers; routing
 * through the RPC bypasses RLS on every table it touches.
 *
 * DEFENSES (enforced authoritatively in the RPC; UI mirrors for nice UX)
 *   * actor must be workspace owner/admin OR pipeline owner/admin
 *   * actor cannot remove themselves
 *   * pipeline-owner rows cannot be removed via this affordance
 *   * personal-workspace pipelines have no team-member concept
 *
 * SQLSTATE → HTTP mapping
 *   42501 → 401 (auth) or 403 (authz / personal / self / owner-protect),
 *           branched on message
 *   22023 → 404 (pipeline not found) or 400 (not a member)
 *   other → 500
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

  const { pipelineId, userId } = parseBody(body);
  if (!pipelineId || !UUID_REGEX.test(pipelineId)) {
    return NextResponse.json(
      { error: "pipeline_id must be a UUID" },
      { status: 400 },
    );
  }
  if (!userId || !UUID_REGEX.test(userId)) {
    return NextResponse.json(
      { error: "target_user_id must be a UUID" },
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

  // ── RPC ────────────────────────────────────────────────────────────────
  const rpcRes = await supaAsUser.rpc("remove_pipeline_member", {
    pipeline_id: pipelineId,
    target_user_id: userId,
  });

  if (rpcRes.error) {
    const sqlstate = rpcRes.error.code;
    const msg = rpcRes.error.message || "";

    if (sqlstate === "42501") {
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
      if (msg.startsWith("You can't remove yourself") || msg.startsWith("You can’t remove yourself")) {
        return NextResponse.json(
          {
            error: "cannot_remove_self",
            message: msg,
          },
          { status: 403 },
        );
      }
      if (msg.startsWith("Pipeline owner cannot be removed")) {
        return NextResponse.json(
          {
            error: "cannot_remove_owner",
            message: msg,
          },
          { status: 403 },
        );
      }
      return NextResponse.json(
        {
          error: "not_authorized",
          message: msg || "You don't have permission to remove members from this pipeline.",
        },
        { status: 403 },
      );
    }

    if (sqlstate === "22023") {
      if (msg.startsWith("Pipeline not found")) {
        return NextResponse.json(
          { error: "Pipeline not found or no permission" },
          { status: 404 },
        );
      }
      if (msg.startsWith("Not a member")) {
        return NextResponse.json(
          {
            error: "not_a_member",
            message: msg,
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: msg || "Invalid argument" },
        { status: 400 },
      );
    }

    console.error(
      "[pipeline-memberships/remove] rpc failed:",
      msg,
      "code:",
      sqlstate,
    );
    return NextResponse.json(
      { error: msg || "Remove failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    pipeline_id: pipelineId,
    user_id: userId,
  });
}

function parseBody(body: unknown): {
  pipelineId: string | null;
  userId: string | null;
} {
  if (typeof body !== "object" || body === null) {
    return { pipelineId: null, userId: null };
  }
  const r = body as Record<string, unknown>;
  const pipelineId =
    typeof r.pipeline_id === "string" ? r.pipeline_id : null;
  const userId =
    typeof r.target_user_id === "string" ? r.target_user_id : null;
  return { pipelineId, userId };
}
