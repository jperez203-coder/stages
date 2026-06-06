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
 * Day-12 nudge email for Track B (non-founder) free-trial users.
 *
 * Slice 6 Part F. Sent ~2 days before the no-card 14-day trial expires.
 * CTA routes back to the dashboard with ?addcard=true so the
 * StartTrialBanner there can auto-open the plan-picker modal — same
 * pattern Slice 5 used for ?founding=upgrade on FoundingTrialEndingBanner.
 *
 * `remainingPhrase` is computed at SEND time (not at enqueue time) so a
 * day-12 row that sits in pending_emails for ~5 minutes still renders
 * accurate "in 2 days" / "tomorrow" / "today" / "in X hours" copy. Same
 * helper (formatTrialRemaining from src/lib/email.ts) feeds the subject
 * line.
 *
 * COPY POSTURE (locked, Slice 6 Part F):
 *   * Honest + low-pressure, NOT pressuring.
 *   * No founding-tier mention, no 50% off framing, no strikethrough
 *     pricing math — Track B users have a regular trial, not a special
 *     discount path.
 *   * Explicit consequence paragraph: workspace becomes read-only;
 *     writes (creating pipelines, sending messages, uploading files)
 *     pause until card added. Honest framing reduces surprise + churn
 *     anger when read-only kicks in.
 *   * Signature "— Jordan from Stages" matches sendFirstPipelineEmail
 *     personal-from-address pattern.
 *
 * Visual treatment mirrors FoundingDay28Email (light-mode card, Stages
 * wordmark, single primary CTA, plain-link fallback). Stages-blue
 * (#108CE9) used for the button — matches the dashboard's primary action
 * treatment.
 */

type Props = {
  /** First word of the recipient's display_name, or "there" when null. */
  firstName: string;
  /** "in 3 days" / "in 2 days" / "tomorrow" / "in 6 hours" / "shortly". */
  remainingPhrase: string;
  /** Pretty workspace name, e.g. "Acme Marketing". */
  workspaceName: string;
  /** Full add-card URL ending in ?addcard=true. */
  addcardUrl: string;
  /** Absolute logo URL (PNG). */
  logoUrl: string;
};

export function TrackBDay12Email({
  firstName,
  remainingPhrase,
  workspaceName,
  addcardUrl,
  logoUrl,
}: Props) {
  const previewText = `Your Stages trial ends ${remainingPhrase}`;

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
              Your Stages trial ends {remainingPhrase}
            </Text>
            <Text style={para}>Hey {firstName},</Text>
            <Text style={para}>This is Jordan from Stages.</Text>
            <Text style={para}>
              Your free trial ends {remainingPhrase}. Add a card today to
              keep your <strong>{workspaceName}</strong> workspace active
              — same plan, same pricing, just continue working.
            </Text>

            <Section style={buttonWrapper}>
              <Button href={addcardUrl} style={button}>
                Add card to continue →
              </Button>
            </Section>

            <Text style={fallback}>Or paste this link into your browser:</Text>
            <Text style={fallbackUrlBlock}>
              <Link href={addcardUrl} style={fallbackLink}>
                {addcardUrl}
              </Link>
            </Text>

            <Text style={paraSmall}>
              If you skip this, your workspace becomes read-only after the
              trial ends. You can still come back later to add a card
              anytime, but writes (creating pipelines, sending messages,
              uploading files) will pause until you do.
            </Text>

            <Text style={signature}>— Jordan from Stages</Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              Questions? Email{" "}
              <Link href="mailto:support@trystages.com" style={footerLink}>
                support@trystages.com
              </Link>
              .
            </Text>
            <Text style={footerSmall}>
              You're getting this because you started a Stages free trial.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// ─── Inline styles ──────────────────────────────────────────────────────────
// Mirror FoundingDay28Email.tsx exactly — single source of truth would be
// nice but extracting these into a shared `email-styles.ts` is premature
// abstraction for two consumers. Extract when a 3rd template lands.

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

const signature: React.CSSProperties = {
  fontSize: "14px",
  color: "#3f3f46",
  margin: "32px 0 0 0",
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
  margin: "0 0 6px 0",
};

const footerLink: React.CSSProperties = {
  color: "#108CE9",
};

const footerSmall: React.CSSProperties = {
  fontSize: "11px",
  lineHeight: "16px",
  color: "#a1a1aa",
  margin: 0,
};
