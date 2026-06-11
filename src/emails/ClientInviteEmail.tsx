import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ClientInviteRole } from "@/lib/email";

/**
 * Client invite email template.
 *
 * Sent by /api/client-invites/send + /api/client-invites/resend. Three
 * role variants share the same structure (header / body / CTA / footer)
 * with only the copy strings differing:
 *
 *   * 'client' — preserves the pre-PI-4 copy bit-for-bit. Pipeline-
 *                centric framing; CTA "Open your project".
 *   * 'member' — workspace-centric framing for internal team members.
 *                CTA "Join the team".
 *   * 'admin'  — same shape as member with admin-specific copy.
 *                CTA "Join the team".
 *
 * `role` defaults to 'client' for resilience against any pre-PI-4
 * caller that wires the template without supplying the new prop. New
 * callers (the helper + send/resend routes post-PI-4) always pass it
 * explicitly.
 *
 * The `acceptUrl` prop is the Supabase magic-link URL returned by
 * auth.admin.generateLink — clicking it signs the recipient in AND
 * redirects to /portal/accept/[token] in one round trip. If the email
 * client strips buttons, the plain-text URL fallback still works for
 * copy-paste. accept_client_invite RPC branches the post-accept
 * routing on inv.role internally; the email template doesn't need to
 * know about that.
 *
 * Visual approach mirrors WorkspaceInviteEmail: light card, Stages text
 * wordmark, blue CTA, plain fallback, plain footer. Cross-client safe
 * (Outlook, Apple Mail, Gmail).
 */

type Props = {
  /** PI-4: role variant the recipient is being invited as. Drives
   *  preview/heading/body/CTA copy. Defaults to 'client' so any pre-PI-4
   *  caller still produces a valid client-side email. */
  role?: ClientInviteRole;
  pipelineName: string;
  /** Workspace name (workspaces.name). Used in member/admin variants for
   *  the "join {workspace}" copy. The client variant doesn't render it
   *  but it's required on the prop type so the helper's payload stays
   *  uniform across roles. */
  workspaceName: string;
  inviterName: string;
  /** Workspace owner's company name (profiles.company_name). Optional —
   *  client variant uses it for "from {company}" inline; member/admin
   *  variants use workspaceName for the same slot and ignore this field. */
  companyName: string | null;
  acceptUrl: string;
  /** Absolute URL to the PNG logo (built from request origin in the send
   *  route). PNG, not SVG — Gmail/Outlook strip SVG <img>. */
  logoUrl: string;
};

export function ClientInviteEmail({
  role = "client",
  pipelineName,
  workspaceName,
  inviterName,
  companyName,
  acceptUrl,
  logoUrl,
}: Props) {
  // PI-4: per-variant copy strings. Locked in strategy chat — see commit
  // message for the lookup table. Client variant must remain byte-for-byte
  // identical to the pre-PI-4 template so existing clients see the same
  // email they always have.
  const isClient = role === "client";
  const isAdmin = role === "admin";

  const previewText = isClient
    ? `${inviterName} invited you to view ${pipelineName} on Stages`
    : isAdmin
      ? `${inviterName} invited you to join ${workspaceName} as an admin on Stages`
      : `${inviterName} invited you to join ${workspaceName} on Stages`;

  const headingText = isClient
    ? "You're invited"
    : isAdmin
      ? "You're invited as an admin"
      : "You're invited to join the team";

  const ctaText = isClient ? "Open your project" : "Join the team";

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            {/* PNG (not SVG — email clients strip SVG <img>). alt="Stages"
                keeps the brand name visible in image-blocking clients. */}
            <Img
              src={logoUrl}
              alt="Stages"
              width={110}
              height={34}
              style={{ display: "block" }}
            />
          </Section>

          <Section style={content}>
            <Text style={heading}>{headingText}</Text>

            {isClient ? (
              <>
                {/* Client variant: existing copy bit-for-bit. "{inviter}
                    from {company} invited you to your project on
                    Stages:" with the pipeline name on a separate line
                    below. */}
                <Text style={para}>
                  <strong>{inviterName}</strong>
                  {companyName ? (
                    <>
                      {" "}
                      from <strong>{companyName}</strong>
                    </>
                  ) : null}{" "}
                  invited you to your project on Stages:
                </Text>
                <Text style={pipelineLine}>
                  <strong>{pipelineName}</strong>
                </Text>
              </>
            ) : (
              /* Member / admin variants: workspace-centric framing,
                 single paragraph, no pipeline line. */
              <Text style={para}>
                <strong>{inviterName}</strong> from{" "}
                <strong>{workspaceName}</strong> invited you to join{" "}
                {isAdmin ? "as an admin" : "their team"} on Stages. Click
                the button below to accept and get started.
              </Text>
            )}

            <Section style={buttonWrapper}>
              <Button href={acceptUrl} style={button}>
                {ctaText}
              </Button>
            </Section>

            <Text style={fallback}>
              Or paste this link into your browser:
            </Text>
            <Text style={fallbackUrlBlock}>
              <Link href={acceptUrl} style={fallbackLink}>
                {acceptUrl}
              </Link>
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            {/* PI-4 locked decision: footer + branding identical across
                all three role variants. The pipeline-name mention is
                still accurate for member/admin since they ARE being
                added to a specific pipeline, just via a different
                product framing in the header. */}
            <Text style={footerText}>
              You received this email because {inviterName} gave you access
              to{" "}
              {pipelineName} on Stages. Stages is the shared workspace where
              your project lives — you&apos;ll be able to follow progress, see
              deliverables, and message the team directly.
            </Text>
            <Text style={footerText}>
              If you weren&apos;t expecting this, you can safely ignore the
              email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Inline styles (mirror WorkspaceInviteEmail) ────────────────────────────

const body: React.CSSProperties = {
  backgroundColor: "#f5f5f7",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 16px",
};

const container: React.CSSProperties = {
  maxWidth: "520px",
  margin: "0 auto",
  backgroundColor: "#ffffff",
  borderRadius: "10px",
  overflow: "hidden",
  border: "1px solid #e4e4e7",
};

const header: React.CSSProperties = {
  padding: "20px 32px",
  borderBottom: "1px solid #e4e4e7",
};

const content: React.CSSProperties = {
  padding: "32px",
};

const heading: React.CSSProperties = {
  fontSize: "20px",
  fontWeight: 600,
  color: "#212124",
  margin: "0 0 16px 0",
};

const para: React.CSSProperties = {
  fontSize: "15px",
  lineHeight: "22px",
  color: "#3f3f46",
  margin: "0 0 12px 0",
};

const pipelineLine: React.CSSProperties = {
  fontSize: "17px",
  lineHeight: "24px",
  color: "#212124",
  margin: "0 0 24px 0",
};

const buttonWrapper: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#108CE9",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 500,
  padding: "12px 28px",
  borderRadius: "8px",
  textDecoration: "none",
  display: "inline-block",
};

const fallback: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#71717a",
  margin: "16px 0 4px 0",
};

const fallbackUrlBlock: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  margin: 0,
  wordBreak: "break-all",
};

const fallbackLink: React.CSSProperties = {
  color: "#108CE9",
  textDecoration: "underline",
};

const hr: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: 0,
};

const footer: React.CSSProperties = {
  padding: "20px 32px",
  backgroundColor: "#fafafa",
};

const footerText: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: "18px",
  color: "#71717a",
  margin: "0 0 8px 0",
};
