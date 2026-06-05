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

/**
 * Day-28 nudge email for Track A founding members.
 *
 * Sent ~2-3 days before the no-card founding trial expires. CTA routes
 * back to the dashboard with ?founding=upgrade so the banner there can
 * auto-open the upgrade modal (Step 6 banner work).
 *
 * `remainingPhrase` is computed at SEND time (not at enqueue time) so a
 * day-28 row that sits in pending_emails for ~5 minutes still renders
 * accurate "in 3 days" / "in 2 days" / "tomorrow" / "today" / "in X
 * hours" copy. Same logic feeds the subject line.
 *
 * Visual treatment mirrors WorkspaceInviteEmail (light-mode card, Stages
 * wordmark, single primary CTA, plain-link fallback). Stages-blue
 * (#108CE9) used for the button — matches the dashboard's primary
 * action treatment.
 */

type Props = {
  /** First word of the recipient's display_name, or "there" when null. */
  firstName: string;
  /** "in 3 days" / "in 2 days" / "tomorrow" / "in 6 hours" / "shortly". */
  remainingPhrase: string;
  /** Pretty workspace name, e.g. "Acme Marketing". */
  workspaceName: string;
  /** Full upgrade URL ending in ?founding=upgrade. */
  upgradeUrl: string;
  /** Absolute logo URL (PNG). */
  logoUrl: string;
};

export function FoundingDay28Email({
  firstName,
  remainingPhrase,
  workspaceName,
  upgradeUrl,
  logoUrl,
}: Props) {
  const previewText = `Your Stages founding trial ends ${remainingPhrase}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Img
              src={logoUrl}
              alt="Stages"
              width={110}
              height={34}
              style={{ display: "block" }}
            />
          </Section>

          <Section style={content}>
            <Text style={heading}>
              Your founding trial ends {remainingPhrase}
            </Text>
            <Text style={para}>Hey {firstName},</Text>
            <Text style={para}>
              Your 30-day no-card trial for{" "}
              <strong>{workspaceName}</strong> ends {remainingPhrase}. Lock in{" "}
              <strong>50% off Stages forever</strong> by adding your card today
              — you keep founding pricing for life, even after we raise base
              prices.
            </Text>

            <Section style={buttonWrapper}>
              <Button href={upgradeUrl} style={button}>
                Claim 50% off lifetime →
              </Button>
            </Section>

            <Text style={fallback}>Or paste this link into your browser:</Text>
            <Text style={fallbackUrlBlock}>
              <Link href={upgradeUrl} style={fallbackLink}>
                {upgradeUrl}
              </Link>
            </Text>

            <Text style={paraSmall}>
              If you skip this, your workspace becomes read-only after day 30.
              You can come back later — founding member status is permanent —
              but the offer terms may have changed by then.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              You received this email because you're a Stages founding member
              and your no-card trial is ending soon. Reply with any questions —
              this address is monitored.
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
  margin: "0 0 16px 0",
};

const paraSmall: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "19px",
  color: "#71717a",
  margin: "24px 0 0 0",
};

const buttonWrapper: React.CSSProperties = {
  margin: "24px 0",
  textAlign: "center",
};

const button: React.CSSProperties = {
  backgroundColor: "#108CE9",
  color: "#ffffff",
  fontSize: "15px",
  fontWeight: 600,
  textDecoration: "none",
  padding: "12px 24px",
  borderRadius: "8px",
  display: "inline-block",
};

const fallback: React.CSSProperties = {
  fontSize: "13px",
  color: "#71717a",
  margin: "16px 0 8px 0",
};

const fallbackUrlBlock: React.CSSProperties = {
  fontSize: "12px",
  wordBreak: "break-all",
  margin: 0,
};

const fallbackLink: React.CSSProperties = {
  color: "#108CE9",
  textDecoration: "underline",
};

const hr: React.CSSProperties = {
  borderColor: "#e4e4e7",
  margin: "0",
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
