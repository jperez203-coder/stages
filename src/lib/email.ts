import { createElement } from "react";
import { Resend } from "resend";
import { ClientInviteEmail } from "@/emails/ClientInviteEmail";
import { FoundingDay28Email } from "@/emails/FoundingDay28Email";
import { TrackBDay12Email } from "@/emails/TrackBDay12Email";
import { WorkspaceInviteEmail } from "@/emails/WorkspaceInviteEmail";

/**
 * Email delivery helpers — server-side only. Imported by route handlers,
 * never by client components (RESEND_API_KEY is not a public env var).
 *
 * In step 6e: real Resend wiring lives behind the RESEND_API_KEY-present
 * branch. The console-log fallback for when the key is missing stays in
 * place so local dev / pre-launch testing can still walk through the
 * accept flow by reading the URL from the server console.
 *
 * The function signature is unchanged from step 6c-ii, so /api/invites/send
 * and /api/invites/resend keep working without modification.
 */

const FROM_ADDRESS = "Stages <invites@trystages.com>";
// First-pipeline welcome email comes from the founder personally, not the
// transactional invites@ address — it's a "hit reply and talk to me" email,
// so the from-address must be a real, monitored inbox.
const FIRST_PIPELINE_FROM_ADDRESS = "Jordan <jordan@trystages.com>";

export type InviteEmailPayload = {
  to: string;
  workspaceName: string;
  /** Display name preferred; falls back to email; "Someone" as last resort. */
  inviterName: string;
  role: "admin" | "member";
  /** Fully-qualified URL the recipient clicks to land on /accept-invite/[token]. */
  acceptUrl: string;
  /** Absolute URL to the PNG logo (origin-built in the route). */
  logoUrl: string;
};

export type EmailResult = { ok: true } | { ok: false; error: string };

export async function sendInviteEmail(
  payload: InviteEmailPayload,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    // Pre-Resend-setup fallback — loudly log what WOULD have been sent so
    // the dev / tester can copy the accept URL out of the server console
    // to walk through the accept flow without real email delivery.
    console.warn(
      [
        "[email] RESEND_API_KEY missing — invite email NOT sent.",
        `  To:        ${payload.to}`,
        `  Workspace: ${payload.workspaceName}`,
        `  Inviter:   ${payload.inviterName}`,
        `  Role:      ${payload.role}`,
        `  Accept URL: ${payload.acceptUrl}`,
      ].join("\n"),
    );
    return { ok: true };
  }

  const subject = `${payload.inviterName} invited you to ${payload.workspaceName} on Stages`;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: payload.to,
      subject,
      // createElement instead of JSX so this file can stay .ts. The template
      // itself is .tsx (uses JSX for readability); the call site doesn't
      // need to be.
      react: createElement(WorkspaceInviteEmail, {
        workspaceName: payload.workspaceName,
        inviterName: payload.inviterName,
        role: payload.role,
        acceptUrl: payload.acceptUrl,
        logoUrl: payload.logoUrl,
      }),
    });

    if (result.error) {
      // Resend's structured error — e.g., domain not verified, rate limit,
      // bad recipient address. Log the full object for diagnosability;
      // return the message string to the caller for surface display.
      console.error("[email] Resend send failed:", result.error);
      return { ok: false, error: result.error.message };
    }

    console.log(
      `[email] Sent invite to ${payload.to} via Resend ` +
        `(id: ${result.data?.id ?? "unknown"})`,
    );
    return { ok: true };
  } catch (err) {
    // Network errors, SDK exceptions, anything else that throws before
    // Resend returns a structured response.
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Resend SDK threw:", message);
    return { ok: false, error: message };
  }
}


// ─── Client invites ──────────────────────────────────────────────────────────

export type ClientInviteEmailPayload = {
  to: string;
  pipelineName: string;
  /** Display name preferred; falls back to email; "Someone" as last resort. */
  inviterName: string;
  /** Workspace owner's company name from profiles.company_name. The
   *  send/resend routes fetch this via user-scoped supabase; the
   *  template prefixes the header with "from {companyName}" when
   *  present, falling back to today's "{inviter} invited you …" when
   *  null. workspaceName was previously here but the template stopped
   *  rendering it on 2026-05-28; dropped 2026-05-29 as part of the
   *  company_name slice for coherence. */
  companyName: string | null;
  /**
   * Magic-link URL from `auth.admin.generateLink` — clicking it signs the
   * recipient in AND lands them on /portal/accept/[token] in one click.
   * The /api/client-invites/send route handler is responsible for minting
   * this; this function just embeds it in the email body.
   */
  acceptUrl: string;
  /** Absolute URL to the PNG logo (origin-built in the route). */
  logoUrl: string;
};

/**
 * Sends a client invite email. Same shape as `sendInviteEmail` (agency):
 * console-log fallback when RESEND_API_KEY is missing, real Resend send
 * otherwise, structured error returns.
 */
export async function sendClientInviteEmail(
  payload: ClientInviteEmailPayload,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.warn(
      [
        "[email] RESEND_API_KEY missing — client invite email NOT sent.",
        `  To:        ${payload.to}`,
        `  Pipeline:  ${payload.pipelineName}`,
        `  Company:   ${payload.companyName ?? "(null)"}`,
        `  Inviter:   ${payload.inviterName}`,
        `  Accept URL: ${payload.acceptUrl}`,
      ].join("\n"),
    );
    return { ok: true };
  }

  const subject = `${payload.inviterName} invited you to view ${payload.pipelineName} on Stages`;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: payload.to,
      subject,
      react: createElement(ClientInviteEmail, {
        pipelineName: payload.pipelineName,
        inviterName: payload.inviterName,
        companyName: payload.companyName,
        acceptUrl: payload.acceptUrl,
        logoUrl: payload.logoUrl,
      }),
    });

    if (result.error) {
      console.error("[email] Resend client invite send failed:", result.error);
      return { ok: false, error: result.error.message };
    }

    console.log(
      `[email] Sent client invite to ${payload.to} via Resend ` +
        `(id: ${result.data?.id ?? "unknown"})`,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Resend SDK threw (client invite):", message);
    return { ok: false, error: message };
  }
}

// ─── First-pipeline welcome (founder outreach) ────────────────────────────────

export type FirstPipelineEmailPayload = {
  to: string;
  /** display_name snapshot from the queue row. First word is used as the
   *  greeting name; null/empty falls back to "there". */
  name: string | null;
};

/**
 * Sends the personal "you created your first pipeline" founder email. Sent by
 * the Vercel-Cron-driven /api/cron/send-pending-emails route, ~30 min after
 * the queue row was enqueued by the on_first_owner_pipeline DB trigger.
 *
 * Differs from the invite emails: plain `text:` body (no React template),
 * from the founder's monitored address, conversational tone. Same graceful
 * no-key fallback + structured result so the caller can decide whether to
 * mark the queue row sent.
 */
export async function sendFirstPipelineEmail(
  payload: FirstPipelineEmailPayload,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const firstName = firstNameOrThere(payload.name);

  if (!apiKey) {
    console.warn(
      [
        "[email] RESEND_API_KEY missing — first-pipeline email NOT sent.",
        `  To:   ${payload.to}`,
        `  Name: ${payload.name ?? "(none)"}`,
      ].join("\n"),
    );
    return { ok: true };
  }

  const subject = "Hey from Stages, how'd it go?";
  const text = [
    `Hey ${firstName},`,
    "",
    "This is Jordan from the founding team at Stages.",
    "",
    "Just saw you created your first pipeline! how'd it go? Anything feel clunky or confusing?",
    "",
    "I read every reply personally, so hit me back with anything anytime.",
    "",
    "— Jordan Perez",
  ].join("\n");

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: FIRST_PIPELINE_FROM_ADDRESS,
      to: payload.to,
      subject,
      text,
    });

    if (result.error) {
      console.error("[email] Resend first-pipeline send failed:", result.error);
      return { ok: false, error: result.error.message };
    }

    console.log(
      `[email] Sent first-pipeline email to ${payload.to} via Resend ` +
        `(id: ${result.data?.id ?? "unknown"})`,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Resend SDK threw (first-pipeline):", message);
    return { ok: false, error: message };
  }
}

/** First word of a display name, or "there" when null/blank. */
function firstNameOrThere(name: string | null): string {
  if (!name) return "there";
  const first = name.trim().split(/\s+/)[0];
  return first.length > 0 ? first : "there";
}

// ─── Founding day-28 reminder ────────────────────────────────────────────────

/**
 * The prod app origin used to build the upgrade CTA URL. Cron-driven
 * emails have no incoming request to derive an origin from, so this
 * stays hardcoded. Local dev emails would link to the prod app, which
 * is fine — cron isn't normally exercised against localhost.
 */
const STAGES_APP_BASE_URL = "https://app.trystages.com";

/**
 * Same `Jordan <jordan@trystages.com>` address used by sendFirstPipelineEmail.
 * Founding-day-28 is a billing-adjacent transactional, but the founding offer
 * is a personal program (FB-DM converts, manual SQL grants), so coming from
 * the founder reads more like the personal nudge it actually is than a
 * `billing@` would.
 */
const FOUNDING_FROM_ADDRESS = FIRST_PIPELINE_FROM_ADDRESS;

export type FoundingDay28PayloadJson = {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  /** ISO 8601 string. Used at send time to compute the remaining-time copy. */
  trial_ends_at: string;
};

export type FoundingDay28EmailPayload = {
  to: string;
  /** display_name snapshot from the queue row. */
  name: string | null;
  payload: FoundingDay28PayloadJson;
  /** Absolute URL to the PNG logo. Cron passes the prod URL. */
  logoUrl: string;
};

/**
 * Sends the Track A founding day-28 nudge email. Invoked by the
 * send-pending-emails cron when it drains a pending_emails row with
 * email_type='founding_day28'. The pending_emails row is enqueued by
 * /api/cron/enqueue-founding-day28.
 *
 * Remaining-time copy ("in 3 days" / "in 2 days" / "tomorrow" / "in 6
 * hours" / "shortly") is computed HERE at send time, not at enqueue
 * time. That way a row that sits in the queue for ~5 min still renders
 * accurate copy. The single template handles all phrases.
 *
 * Subject and CTA URL are also built here, both threaded through to the
 * React Email template. CTA points to the workspace dashboard with
 * `?founding=upgrade` so the banner there can auto-open the upgrade
 * modal (Step 6 banner work; the email link is safe to ship before that
 * banner handling lands — until then, the user simply lands on the
 * dashboard, sees the standing founding-expiry banner, and clicks
 * through manually).
 */
export async function sendFoundingDay28Reminder(
  args: FoundingDay28EmailPayload,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const firstName = firstNameOrThere(args.name);
  const remainingPhrase = formatTrialRemaining(
    new Date(args.payload.trial_ends_at),
  );

  const upgradeUrl =
    `${STAGES_APP_BASE_URL}/w/${encodeURIComponent(args.payload.workspace_slug)}` +
    `?founding=upgrade`;

  if (!apiKey) {
    console.warn(
      [
        "[email] RESEND_API_KEY missing — founding-day28 email NOT sent.",
        `  To:          ${args.to}`,
        `  Workspace:   ${args.payload.workspace_name}`,
        `  Remaining:   ${remainingPhrase}`,
        `  Upgrade URL: ${upgradeUrl}`,
      ].join("\n"),
    );
    return { ok: true };
  }

  const subject = `Your Stages founding trial ends ${remainingPhrase}`;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: FOUNDING_FROM_ADDRESS,
      to: args.to,
      subject,
      react: createElement(FoundingDay28Email, {
        firstName,
        remainingPhrase,
        workspaceName: args.payload.workspace_name,
        upgradeUrl,
        logoUrl: args.logoUrl,
      }),
    });

    if (result.error) {
      console.error("[email] Resend founding-day28 send failed:", result.error);
      return { ok: false, error: result.error.message };
    }

    console.log(
      `[email] Sent founding-day28 to ${args.to} via Resend ` +
        `(id: ${result.data?.id ?? "unknown"}; remaining=${remainingPhrase})`,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Resend SDK threw (founding-day28):", message);
    return { ok: false, error: message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Slice 6 Part F — Track B day-12 nudge
//
// Track B (non-founder) parallel of the founding day-28 nudge. Same shape:
// SECURITY DEFINER candidate RPC enqueues into pending_emails; this helper
// gets invoked by send-pending-emails when it drains a `trackb_day12` row.
// Different copy (no founding/50% framing) + different CTA URL (?addcard=true
// vs ?founding=upgrade). Same from-address (Jordan, personal) and same
// formatTrialRemaining helper.

export type TrackBDay12PayloadJson = {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  /** ISO 8601 string. Used at send time to compute the remaining-time copy. */
  trial_ends_at: string;
};

export type TrackBDay12EmailPayload = {
  to: string;
  /** display_name snapshot from the queue row. */
  name: string | null;
  payload: TrackBDay12PayloadJson;
  /** Absolute URL to the PNG logo. Cron passes the prod URL. */
  logoUrl: string;
};

/**
 * Sends the Track B day-12 nudge email. Invoked by the send-pending-
 * emails cron when it drains a pending_emails row with
 * email_type='trackb_day12'. The pending_emails row is enqueued by
 * /api/cron/enqueue-trackb-day12.
 *
 * Remaining-time copy ("in 3 days" / "in 2 days" / "tomorrow" / "in 6
 * hours" / "shortly") is computed HERE at send time, not at enqueue
 * time. A row that sits in the queue for ~5 min still renders accurate
 * copy. Same formatTrialRemaining helper as founder day-28.
 *
 * Subject and CTA URL built here, both threaded through to the React
 * Email template. CTA points to the workspace dashboard with
 * `?addcard=true` so StartTrialBanner can auto-open the plan-picker
 * modal — mirrors Slice 5's `?founding=upgrade` pattern.
 */
export async function sendTrackBDay12Reminder(
  args: TrackBDay12EmailPayload,
): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const firstName = firstNameOrThere(args.name);
  const remainingPhrase = formatTrialRemaining(
    new Date(args.payload.trial_ends_at),
  );

  const addcardUrl =
    `${STAGES_APP_BASE_URL}/w/${encodeURIComponent(args.payload.workspace_slug)}` +
    `?addcard=true`;

  if (!apiKey) {
    console.warn(
      [
        "[email] RESEND_API_KEY missing — trackb-day12 email NOT sent.",
        `  To:          ${args.to}`,
        `  Workspace:   ${args.payload.workspace_name}`,
        `  Remaining:   ${remainingPhrase}`,
        `  Addcard URL: ${addcardUrl}`,
      ].join("\n"),
    );
    return { ok: true };
  }

  const subject = `Your Stages trial ends ${remainingPhrase}`;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      // Personal-from-address; same pattern as first-pipeline + founding
      // day-28. The email reads as a personal nudge from Jordan, not a
      // billing-system transactional.
      from: FIRST_PIPELINE_FROM_ADDRESS,
      to: args.to,
      subject,
      react: createElement(TrackBDay12Email, {
        firstName,
        remainingPhrase,
        workspaceName: args.payload.workspace_name,
        addcardUrl,
        logoUrl: args.logoUrl,
      }),
    });

    if (result.error) {
      console.error("[email] Resend trackb-day12 send failed:", result.error);
      return { ok: false, error: result.error.message };
    }

    console.log(
      `[email] Sent trackb-day12 to ${args.to} via Resend ` +
        `(id: ${result.data?.id ?? "unknown"}; remaining=${remainingPhrase})`,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Resend SDK threw (trackb-day12):", message);
    return { ok: false, error: message };
  }
}

/**
 * Renders the time-until-trial-ends phrase used in both the email
 * subject and body. Computed against now() at the moment of send.
 *
 *   ≥ 48 hours  → "in N days" (floor)
 *   24-48 hours → "tomorrow"
 *   1-24 hours  → "in X hours"
 *   < 1 hour    → "shortly"
 *   already past → "very soon" (defensive; the cron filter excludes
 *                  expired rows but a queue lag could land here)
 *
 * Exported for reuse by the privacy harness + future test scaffolding.
 */
export function formatTrialRemaining(trialEndsAt: Date): string {
  const diffMs = trialEndsAt.getTime() - Date.now();
  if (diffMs <= 0) return "very soon";
  const totalHours = Math.floor(diffMs / (60 * 60 * 1000));
  if (totalHours >= 48) {
    const days = Math.floor(totalHours / 24);
    return `in ${days} days`;
  }
  if (totalHours >= 24) return "tomorrow";
  if (totalHours >= 1) return `in ${totalHours} hour${totalHours === 1 ? "" : "s"}`;
  return "shortly";
}
