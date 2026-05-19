import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/**
 * Client invite email template.
 *
 * Sent by /api/client-invites/send (step 7b). Different framing from the
 * agency WorkspaceInviteEmail — the recipient is being given access to a
 * specific pipeline, not joining a workspace as a teammate.
 *
 * The `acceptUrl` prop is the Supabase magic-link URL returned by
 * auth.admin.generateLink — clicking it signs the recipient in AND
 * redirects to /portal/accept/[token] in one round trip. If the email
 * client strips buttons, the plain-text URL fallback still works for
 * copy-paste.
 *
 * Visual approach mirrors WorkspaceInviteEmail: light card, Stages text
 * wordmark, blue CTA, plain fallback, plain footer. Cross-client safe
 * (Outlook, Apple Mail, Gmail). Branding polish in PHASE_3_4_PLAN.md.
 */

type Props = {
  pipelineName: string;
  workspaceName: string;
  inviterName: string;
  acceptUrl: string;
};

export function ClientInviteEmail({
  pipelineName,
  workspaceName,
  inviterName,
  acceptUrl,
}: Props) {
  const previewText = `${inviterName} invited you to view ${pipelineName} on Stages`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Stages</Text>
          </Section>

          <Section style={content}>
            <Text style={heading}>You&apos;re invited</Text>
            <Text style={para}>
              <strong>{inviterName}</strong> from{" "}
              <strong>{workspaceName}</strong> invited you to view your
              project on Stages:
            </Text>
            <Text style={pipelineLine}>
              <strong>{pipelineName}</strong>
            </Text>

            <Section style={buttonWrapper}>
              <Button href={acceptUrl} style={button}>
                Open your project
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
            <Text style={footerText}>
              You received this email because {inviterName} at {workspaceName}{" "}
              gave you access to view {pipelineName} on Stages. Stages is the
              shared workspace where your project lives — you&apos;ll be able
              to follow progress, see deliverables, and message the team
              directly.
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

const wordmark: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 700,
  color: "#212124",
  letterSpacing: "-0.01em",
  margin: 0,
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
