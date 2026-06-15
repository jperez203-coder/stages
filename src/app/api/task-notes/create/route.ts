import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_CONTENT_LENGTH = 5000;

/**
 * POST /api/task-notes/create
 *
 * Posts a task note as the calling user. Both agency-side users
 * (workspace + pipeline memberships) and clients (via portal) may post
 * — the create_task_note SECURITY DEFINER RPC enforces the visibility
 * gate inline, matching the SELECT policy on task_notes.
 *
 * Body:  { task_id: uuid, content: string (1–5000 chars after trim) }
 * 200:   { ok: true, note: task_notes row }
 * 400:   bad input / "Note content cannot be empty" / "Task not found"
 * 401:   no bearer / invalid JWT
 * 403:   "Not authorized to post notes on this task"
 * 500:   server misconfigured / unhandled RPC error
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

  const { taskId, content } = parseBody(body);
  if (!taskId || !UUID_REGEX.test(taskId)) {
    return NextResponse.json(
      { error: "task_id must be a UUID" },
      { status: 400 },
    );
  }
  if (content === null) {
    return NextResponse.json(
      { error: "content must be a string" },
      { status: 400 },
    );
  }
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return NextResponse.json(
      { error: "content cannot be empty" },
      { status: 400 },
    );
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `content exceeds ${MAX_CONTENT_LENGTH} characters` },
      { status: 400 },
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const supaAsUser = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userResult, error: authError } =
    await supaAsUser.auth.getUser(jwt);
  if (authError || !userResult?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rpcRes = await supaAsUser.rpc("create_task_note", {
    p_task_id: taskId,
    p_content: trimmed,
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
      return NextResponse.json(
        { error: "not_authorized", message: msg },
        { status: 403 },
      );
    }

    if (sqlstate === "22023") {
      if (msg.startsWith("Task not found")) {
        return NextResponse.json(
          { error: "Task not found or no permission" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: msg || "Invalid argument" },
        { status: 400 },
      );
    }

    console.error(
      "[task-notes/create] rpc failed:",
      msg,
      "code:",
      sqlstate,
    );
    return NextResponse.json(
      { error: msg || "Create failed" },
      { status: 500 },
    );
  }

  // RPC returns the inserted task_notes row.
  return NextResponse.json({ ok: true, note: rpcRes.data });
}

function parseBody(body: unknown): {
  taskId: string | null;
  content: string | null;
} {
  if (typeof body !== "object" || body === null) {
    return { taskId: null, content: null };
  }
  const r = body as Record<string, unknown>;
  const taskId = typeof r.task_id === "string" ? r.task_id : null;
  const content = typeof r.content === "string" ? r.content : null;
  return { taskId, content };
}
