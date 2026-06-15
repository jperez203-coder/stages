import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/task-notes/delete
 *
 * Deletes a task note. Authz lives inside the delete_task_note RPC:
 * the caller must be the note's author OR a workspace owner/admin on
 * the parent workspace (pipeline-scoped admins explicitly cannot
 * delete other peoples notes — only their own).
 *
 * Body:  { note_id: uuid }
 * 200:   { ok: true }
 * 400:   bad input
 * 401:   no bearer / invalid JWT
 * 403:   "Not authorized to delete this note"
 * 404:   note not found
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

  const noteId = parseNoteId(body);
  if (!noteId || !UUID_REGEX.test(noteId)) {
    return NextResponse.json(
      { error: "note_id must be a UUID" },
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

  const rpcRes = await supaAsUser.rpc("delete_task_note", {
    p_note_id: noteId,
  });

  if (rpcRes.error) {
    const sqlstate = rpcRes.error.code;
    const msg = rpcRes.error.message || "";

    if (sqlstate === "P0002") {
      return NextResponse.json(
        { error: "Note not found" },
        { status: 404 },
      );
    }

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

    console.error(
      "[task-notes/delete] rpc failed:",
      msg,
      "code:",
      sqlstate,
    );
    return NextResponse.json(
      { error: msg || "Delete failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

function parseNoteId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, unknown>;
  return typeof r.note_id === "string" ? r.note_id : null;
}
