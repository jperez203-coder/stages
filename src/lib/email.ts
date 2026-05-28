import { createElement } from "react";
import { Resend } from "resend";
import { ClientInviteEmail } from "@/emails/ClientInviteEmail";
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
  workspaceName: string;
  /** Display name preferred; falls back to email; "Someone" as last resort. */
  inviterName: string;
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
        `  Workspace: ${payload.workspaceName}`,
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
        workspaceName: payload.workspaceName,
        inviterName: payload.inviterName,
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
