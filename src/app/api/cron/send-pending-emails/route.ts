import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendFirstPipelineEmail } from "@/lib/email";

/**
 * GET /api/cron/send-pending-emails
 *
 * Vercel Cron target (see vercel.json). Drains the public.pending_emails
 * queue: finds rows whose send_after has passed and that haven't been sent,
 * sends each via the matching helper in src/lib/email.ts, and marks the row
 * sent on success.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. We reject
 * anything that doesn't match process.env.CRON_SECRET with a 401, so the
 * endpoint can't be triggered by the public internet.
 *
 * Supabase: uses the SERVICE-ROLE key (SUPABASE_SECRET_KEY) to bypass RLS —
 * pending_emails has RLS on with NO policies, so only this service-role path
 * can read/write it. Same client construction as the invite routes.
 *
 * Failure posture: this handler never throws a 500. A 500 makes Vercel
 * retry-storm; instead we log and return 200 with a summary. Un-sent rows are
 * simply picked up on the next scheduled run (the work is naturally
 * resumable — sent_at gates re-sends).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// New-style Supabase secret key (sb_secret_... format). Bypasses RLS; must
// stay server-side only. Same var the invite routes use.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const BATCH_LIMIT = 50;

export async function GET(request: Request) {
  // ─── Auth gate ───────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    // Misconfig — log + 200 (not 500) so cron doesn't retry-storm. There's
    // nothing a retry would fix until the env vars are set.
    console.error(
      "[cron] send-pending-emails: Supabase env vars missing; skipping run.",
    );
    return NextResponse.json({ error: "server_misconfigured" }, { status: 200 });
  }

  try {
    const supaAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Due = not yet sent AND send_after has passed. Partial index
    // pending_emails_due_idx covers the sent_at-null + send_after ordering.
    const { data: due, error: fetchErr } = await supaAdmin
      .from("pending_emails")
      .select("id, email_type, recipient, recipient_name")
      .is("sent_at", null)
      .lte("send_after", new Date().toISOString())
      .order("send_after", { ascending: true })
      .limit(BATCH_LIMIT);

    if (fetchErr) {
      console.error("[cron] Failed to fetch pending emails:", fetchErr.message);
      return NextResponse.json({ error: "fetch_failed" }, { status: 200 });
    }

    const rows = due ?? [];
    let sent = 0;

    for (const row of rows) {
      // Dispatch by email_type. Only first_pipeline is wired today; unknown
      // types are skipped (left un-sent) rather than silently consumed, so a
      // future email_type can't get dropped by this handler.
      let result: { ok: true } | { ok: false; error: string };
      if (row.email_type === "first_pipeline") {
        result = await sendFirstPipelineEmail({
          to: row.recipient,
          name: row.recipient_name,
        });
      } else {
        console.warn(
          `[cron] Unknown email_type '${row.email_type}' (id ${row.id}); leaving un-sent.`,
        );
        continue;
      }

      if (!result.ok) {
        // Leave sent_at null → retried next run.
        console.error(`[cron] Send failed for ${row.id}:`, result.error);
        continue;
      }

      // Send succeeded → mark sent so it isn't re-sent. The send-ok-but-
      // update-fails window is the only duplicate-email risk; it's rare and
      // we log it loudly. We count it as sent either way (it WAS sent).
      const { error: updErr } = await supaAdmin
        .from("pending_emails")
        .update({ sent_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updErr) {
        console.error(
          `[cron] Sent ${row.id} but failed to mark sent_at (dup risk next run):`,
          updErr.message,
        );
      }
      sent += 1;
    }

    return NextResponse.json({ processed: rows.length, sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron] send-pending-emails threw:", message);
    // 200 (not 500) on purpose — see header. Next run resumes the queue.
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
