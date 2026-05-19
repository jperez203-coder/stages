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
 * Workspace invite email template.
 *
 * Rendered server-side by Resend when /api/invites/send or /api/invites/resend
 * fire. Uses inline styles throughout (React Email convention) because most
 * email clients ignore <style> tags and external CSS.
 *
 * Visual approach: clean light-mode card with the Stages wordmark, the
 * inviter line, a single primary CTA button, and a plain-text URL fallback
 * for clients that don't render buttons. Light mode chosen over the app's
 * dark aesthetic for predictable cross-client rendering (Outlook + Apple
 * Mail handle light mode more consistently than dark, and many users have
 * light-mode email clients regardless of OS theme). The branding polish
 * item in PHASE_3_4_PLAN.md can revisit this with a designed full-wordmark
 * SVG and dark-mode media query later.
 */

type Props = {
  workspaceName: string;
  inviterName: string;
  role: "admin" | "member";
  acceptUrl: string;
};

export function WorkspaceInviteEmail({
  workspaceName,
  inviterName,
  role,
  acceptUrl,
}: Props) {
  const roleLabel = role === "admin" ? "an admin" : "a member";
  const previewText = `${inviterName} invited you to ${workspaceName} on Stages`;

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
              <strong>{inviterName}</strong> invited you to{" "}
              <strong>{workspaceName}</strong> on Stages as {roleLabel}.
            </Text>

            <Section style={buttonWrapper}>
              <Button href={acceptUrl} style={button}>
                Accept invitation
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
              You received this email because {inviterName} added your email
              address to {workspaceName} on Stages. If you weren&apos;t
              expecting this, you can safely ignore it.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Inline styles ──────────────────────────────────────────────────────────

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
  margin: 0,
};
