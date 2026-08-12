import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST /api/track-pageview
 *
 * Public, unauthenticated — fired from an anonymous visitor's browser
 * before they've signed up. Backs the "visited signup page" funnel step
 * on /admin/metrics. Deliberately narrow: only paths we actually track
 * are accepted, so this can't become an open write endpoint for arbitrary
 * event data.
 *
 * Body: { path: string }
 */
const TRACKED_PATHS = new Set<string>(["/auth/signup"]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const path =
    typeof body === "object" && body !== null && "path" in body
      ? (body as { path: unknown }).path
      : null;

  if (typeof path !== "string" || !TRACKED_PATHS.has(path)) {
    return NextResponse.json({ error: "Untracked path" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("page_views").insert({
    path,
    referrer: request.headers.get("referer"),
    user_agent: request.headers.get("user-agent"),
  });

  if (error) {
    // Never let tracking failures surface to the visitor — this is a
    // fire-and-forget beacon, not a critical path.
    console.error("[track-pageview] insert failed:", error.message);
  }

  return NextResponse.json({ ok: true });
}
