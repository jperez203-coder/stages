import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Stages",
  description:
    "How Stages collects, uses, and protects your data. Includes our AI-features commitments and processor list.",
};

// ─────────────────────────────────────────────────────────────────────────
// Source-of-truth: docs/DATA-COLLECTION.md (synced 2026-06-08).
//
// Legal-review edits should land HERE, not back in the audit doc. The
// audit doc is internal engineering source-of-truth; this page is the
// external commercial source-of-truth. The two will drift by design.
//
// Section mapping into docs/DATA-COLLECTION.md:
//   § 3 (Data we collect)     → § 1.1–§ 1.13 (paraphrased)
//   § 5 (Who we share with)   → § 3.1–§ 3.6 (6 processors)
//   § 7 (Data retention)      → § 1.14 cascade + § 1.11 + § 1.15
//   § 9 (AI features)         → § 4.2.A–§ 4.2.I (verbatim per Slice S7 lock)
//   § 10 (Cookies)            → § 2.1 + § 2.2
// ─────────────────────────────────────────────────────────────────────────

const TOC = [
  { id: "effective", label: "1. Effective dates" },
  { id: "who", label: "2. Who we are" },
  { id: "data", label: "3. Data we collect" },
  { id: "use", label: "4. How we use data" },
  { id: "share", label: "5. Who we share with" },
  { id: "transfers", label: "6. International transfers" },
  { id: "retention", label: "7. Data retention" },
  { id: "rights", label: "8. Your rights" },
  { id: "ai", label: "9. AI features" },
  { id: "cookies", label: "10. Cookies" },
  { id: "children", label: "11. Children" },
  { id: "changes", label: "12. Changes to this policy" },
  { id: "contact", label: "13. Contact" },
];

export default function PrivacyPolicyPage() {
  return (
    <article className="lg:flex lg:gap-12">
      {/* Sticky TOC — desktop */}
      <aside className="hidden lg:block lg:w-56 lg:flex-shrink-0">
        <nav className="sticky top-8">
          <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
            Contents
          </div>
          <ul className="space-y-2">
            {TOC.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="text-[12.5px] text-zinc-400 hover:text-zinc-200 transition-colors leading-snug block"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex-1 max-w-[720px]">
        {/* Mobile TOC — accordion */}
        <details className="lg:hidden mb-8 panel-card p-4">
          <summary className="text-[13px] font-semibold text-zinc-100 cursor-pointer">
            Contents
          </summary>
          <ul className="mt-3 space-y-1.5 pl-1">
            {TOC.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="text-[13px] text-zinc-400 hover:text-zinc-200 block"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </details>

        {/* Page title + meta */}
        <header className="mb-10">
          <h1 className="text-[32px] sm:text-[36px] font-bold text-zinc-100 mb-3 leading-tight">
            Privacy Policy
          </h1>
          <div className="text-[13px] text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>Effective: June 8, 2026</span>
            <span>Last updated: June 8, 2026</span>
            <span>~15 min read</span>
          </div>
        </header>

        {/* ─── 1. Effective dates ──────────────────────────────────── */}
        <Section id="effective" title="1. Effective dates">
          <P>
            This Privacy Policy is effective as of <strong>June 8, 2026</strong>{" "}
            and was last updated on the same date. It applies to all use of
            the Stages service operated by SalesEdge LLC d/b/a Stages.
          </P>
        </Section>

        {/* ─── 2. Who we are ───────────────────────────────────────── */}
        <Section id="who" title="2. Who we are">
          <P>
            Stages is a workspace product for client services businesses:
            agencies, consultants, and freelancers. Stages is operated by{" "}
            <strong>
              SalesEdge LLC, a New Jersey limited liability company doing
              business as &ldquo;Stages&rdquo;
            </strong>{" "}
            (referred to in this Policy as &ldquo;Stages,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;).
          </P>
          <P>
            Privacy-specific questions, data-access requests, and complaints
            should be sent to{" "}
            <a
              href="mailto:privacy@trystages.com"
              className="text-stages-blue hover:underline"
            >
              privacy@trystages.com
            </a>
            . For all other matters, see § 13 (Contact).
          </P>
        </Section>

        {/* ─── 3. Data we collect ──────────────────────────────────── */}
        <Section id="data" title="3. Data we collect">
          <P>
            Stages collects three kinds of data: what you explicitly type into
            the product, what attaches to your activity automatically, and what
            our payment processor passes to us.
          </P>

          <SubHeading>You provide directly</SubHeading>
          <List>
            <li>
              <strong>Account information.</strong> Your email address, a name
              you choose (typically your full name), and a password. For agency
              users, optionally your company name. For users who sign in with
              Google, the name and profile picture URL Google passes us.
            </li>
            <li>
              <strong>Workspace content.</strong> Workspace and pipeline names,
              client company labels, stages, tasks, notes, chat messages, files
              you upload, and external URLs you paste in.
            </li>
            <li>
              <strong>Invitations.</strong> Email addresses of teammates and
              clients you invite into your workspace or to a specific pipeline.
            </li>
            <li>
              <strong>Payment-context information.</strong> Your billing email.
              Stripe (our payment processor) collects card details directly in
              its own hosted checkout flow; we never see your card number, CVC,
              or expiry.
            </li>
          </List>

          <SubHeading>Automatically attached to your activity</SubHeading>
          <List>
            <li>
              <strong>Authentication session.</strong> An encrypted session
              token stored in HTTP-only cookies, used to keep you signed in.
            </li>
            <li>
              <strong>Interface state.</strong> A small number of preference
              flags stored in your browser&apos;s local storage (e.g.,
              dismissed-banner state, recently picked emojis).
            </li>
            <li>
              <strong>Server logs.</strong> Standard request logs (URL paths,
              timestamps, error messages) captured by our hosting provider
              (Vercel) for operational debugging. We do not extract IP
              addresses, User-Agent strings, or referrer headers ourselves.
              Those are captured at the hosting-platform layer per our
              provider&apos;s defaults.
            </li>
            <li>
              <strong>Subscription state.</strong> If you upgrade to a paid
              plan, we mirror your subscription status (trialing, active,
              past-due, etc.) and the timing of the current billing period from
              Stripe.
            </li>
          </List>

          <SubHeading>What we do not collect</SubHeading>
          <List>
            <li>
              We do not use analytics, session-replay, or third-party tracking
              scripts. There are no Google Analytics, Mixpanel, PostHog,
              Sentry, or similar SDKs in our application.
            </li>
            <li>
              We do not collect device fingerprints, geolocation, or browser
              permissions (camera, microphone, etc.).
            </li>
            <li>
              We do not see or store your payment card details. Those go
              directly to Stripe.
            </li>
            <li>
              As of the date of this Policy, we do not process your content
              with AI or machine-learning models. See § 9 for our forward-looking
              commitments on AI features.
            </li>
          </List>
        </Section>

        {/* ─── 4. How we use data ──────────────────────────────────── */}
        <Section id="use" title="4. How we use data">
          <P>
            We use the data we collect to provide and improve the Stages
            service. Specifically:
          </P>
          <List>
            <li>
              To authenticate you, route you to the correct workspace, and
              enforce who can see and edit what.
            </li>
            <li>
              To store the workspace content you create and make it available
              to your teammates and clients per the access rules each
              workspace owner configures.
            </li>
            <li>
              To send you transactional emails about your account and
              workspace activity (invitations, trial reminders, billing
              changes, and similar). We do not send marketing email from the
              product.
            </li>
            <li>
              To process payments via Stripe and keep our records of your
              subscription state accurate.
            </li>
            <li>
              To investigate and respond to support requests, security
              incidents, and abuse.
            </li>
            <li>
              To improve the product based on aggregate, non-personal usage
              patterns (e.g., which features are used at what rate). When AI
              features ship, this category extends. See § 9.
            </li>
          </List>
        </Section>

        {/* ─── 5. Who we share with ────────────────────────────────── */}
        <Section id="share" title="5. Who we share with">
          <P>
            We share data only with the service providers we need to operate
            the product. Each is listed below with a one-sentence purpose. None
            of these providers receives more than what they need; none has
            permission to use your data for their own purposes beyond providing
            their service to us.
          </P>

          <List>
            <li>
              <strong>Supabase.</strong> Our primary backend (database, auth,
              file storage). All workspace content is stored on Supabase&apos;s
              infrastructure.{" "}
              <a
                href="https://supabase.com/legal/dpa"
                className="text-stages-blue hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Supabase DPA
              </a>
              .
            </li>
            <li>
              <strong>Stripe.</strong> Payment processing. Stripe holds your
              card details under PCI-DSS Level 1 attestation; we hold only
              Stripe identifiers and subscription state.{" "}
              <a
                href="https://stripe.com/legal/dpa"
                className="text-stages-blue hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Stripe DPA
              </a>
              .
            </li>
            <li>
              <strong>Resend.</strong> Transactional email delivery (invites,
              trial reminders). Resend receives recipient emails and the
              rendered email body.{" "}
              <a
                href="https://resend.com/legal/dpa"
                className="text-stages-blue hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Resend DPA
              </a>
              .
            </li>
            <li>
              <strong>Vercel.</strong> Hosting and serverless functions.
              Vercel handles edge requests and captures standard request logs.{" "}
              <a
                href="https://vercel.com/legal/dpa"
                className="text-stages-blue hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Vercel DPA
              </a>
              .
            </li>
            <li>
              <strong>cron-job.org.</strong> External cron scheduler used to
              trigger our background-task endpoints. Receives a bearer-token
              header; receives no user data in request or response bodies.
            </li>
            <li>
              <strong>Google.</strong> Identity provider for &ldquo;Sign in
              with Google.&rdquo; Google operates as an independent controller
              for the authentication transaction; Stages is the relying party
              and receives only the email, name, profile picture URL, and a
              stable user identifier from Google.
            </li>
          </List>

          <P>
            We will list any future processors (including AI service providers;
            see § 9) at the same level of detail. We give at least 30 days
            notice in-app before adding a new sub-processor.
          </P>
        </Section>

        {/* ─── 6. International transfers ──────────────────────────── */}
        <Section id="transfers" title="6. International transfers">
          <P>
            Our primary processing happens in the United States. Supabase
            hosts our database in a region we have selected; the other
            processors above (Stripe, Resend, Vercel, Google) primarily
            process in the United States.
          </P>
          <P>
            For users in the European Economic Area, the United Kingdom, or
            Switzerland: data transferred to the United States relies on the
            European Union–United States Data Privacy Framework (including the
            UK Extension and Swiss-U.S. Framework where applicable) and
            Standard Contractual Clauses, where required by our processor
            agreements.
          </P>
        </Section>

        {/* ─── 7. Data retention ───────────────────────────────────── */}
        <Section id="retention" title="7. Data retention">
          <P>
            We retain your data for as long as your account is active and as
            needed to operate the service. When you or your workspace owner
            delete content, here is what happens:
          </P>
          <List>
            <li>
              <strong>Workspace deletion</strong> cascades to delete every
              pipeline, stage, task, note, chat message, file, and audit
              record in that workspace.
            </li>
            <li>
              <strong>Pipeline deletion</strong> cascades to delete every
              stage, task, note, attachment, link, channel, and message in
              that pipeline.
            </li>
            <li>
              <strong>User account deletion</strong> deletes your profile,
              memberships, and stored authentication metadata. Some
              attribution metadata may remain in workspace audit logs
              (see § 9 for AI-specific retention).
            </li>
            <li>
              <strong>Email delivery records</strong> are retained for up to{" "}
              <strong>90 days</strong> for support and debugging purposes,
              then deleted.
            </li>
            <li>
              <strong>File binaries</strong> may persist briefly after a
              deletion request, pending a storage cleanup pass.
            </li>
            <li>
              <strong>Stripe transaction history</strong> is retained by
              Stripe per its own policies (typically multiple years) to
              satisfy financial-records regulations. We do not control this
              retention window.
            </li>
          </List>
        </Section>

        {/* ─── 8. Your rights ──────────────────────────────────────── */}
        <Section id="rights" title="8. Your rights">
          <P>
            Depending on where you live, you may have legal rights to access,
            correct, delete, or export your personal data, and to object to
            certain processing. We honor these rights regardless of
            jurisdiction.
          </P>
          <List>
            <li>
              <strong>Access.</strong> Email{" "}
              <a
                href="mailto:privacy@trystages.com"
                className="text-stages-blue hover:underline"
              >
                privacy@trystages.com
              </a>{" "}
              to request a copy of the personal data we hold about you.
            </li>
            <li>
              <strong>Correction.</strong> Most personal data (your name,
              company name) is editable directly in your account settings.
              For anything else, email us.
            </li>
            <li>
              <strong>Deletion.</strong> You can delete content yourself in
              the app. For full account deletion, email us. Note: a small
              amount of denormalized data may remain in workspace audit
              logs for integrity purposes (e.g., &ldquo;Sarah completed
              stage X&rdquo; in activity history); see § 9 for AI-specific
              retention.
            </li>
            <li>
              <strong>Data portability.</strong> Email us to request an
              export of your workspace data in a structured format.
            </li>
            <li>
              <strong>Opt-out of AI-improvement signals.</strong> Always
              available, even after the first AI feature ships. See § 9.
            </li>
          </List>
        </Section>

        {/* ─── 9. AI features ──────────────────────────────────────── */}
        {/* Source: docs/DATA-COLLECTION.md § 4.2.A-§ 4.2.I, verbatim per
            Slice S7 lock. Em-dashes replaced with commas/periods/parens per
            founder UX direction 2026-06-07. Substantive content unchanged.
            The agent-platform framing here is contractually binding once
            published. */}
        <Section id="ai" title="9. AI features">
          <P>
            <strong>AI and machine learning.</strong> Stages is a workspace
            where you and your AI assistant collaborate to manage client
            work. Our AI acts on your behalf within tools you&apos;ve
            connected, like a smart assistant who can take actions you
            delegate. Here&apos;s how that works and how you stay in
            control.
          </P>

          <P>
            <strong>How you stay in control.</strong> Stages AI is gated by
            four layers of consent that you control.
          </P>
          <ol className="list-decimal pl-6 space-y-3 my-4">
            <li>
              <strong>Workspace AI enablement.</strong> A workspace owner
              must explicitly turn on AI agent features for the workspace.
              Default off.
            </li>
            <li>
              <strong>Per-integration consent.</strong> When you connect an
              external service (Google Docs, Slack, Instantly, etc.) to
              Stages, you grant Stages AI permission to read or write that
              service on your behalf when you invoke AI actions.
            </li>
            <li>
              <strong>Per-action consent.</strong> Routine, low-risk actions
              are pre-authorized once you&apos;ve connected an integration.
              Actions that are high-risk (e.g., sending an email) require a
              confirmation. Actions that are high-value or irreversible
              (e.g., moving money) require an explicit re-authentication.
            </li>
            <li>
              <strong>Improvement signals.</strong> Optionally, you can let
              us learn from anonymized usage patterns (which features you
              use, which suggestions you accept) to make AI features better
              for everyone. Default off; turn it on at{" "}
              <strong>Settings → Privacy</strong> if you wish.
            </li>
          </ol>

          <P>
            <strong>We do not train AI models on your data.</strong> When
            you use AI features, your data is processed by zero-retention AI
            providers (currently Anthropic and/or OpenAI API tiers that
            contractually prohibit training on inputs) to generate the
            specific output you requested. Your data is not stored, learned
            from, or used for any other purpose by those providers.
          </P>

          <P>
            <strong>Improvement signals (opt-in).</strong> With your
            explicit consent (off by default), we may use anonymized
            signals about how AI features get used (e.g., which suggestions
            get accepted, which actions you redo) to make AI features better
            for everyone. We never use the content of your work, your
            messages, or your connected-service data for this; we only use
            aggregated, anonymized behavioral signals. You can turn this on
            or off any time at <strong>Settings → Privacy</strong>.
          </P>

          <P>
            <strong>What data flows where during an AI action.</strong> When
            you invoke an AI feature, Stages may need to send relevant
            context to an AI provider to generate the output you asked for.
            For example, if you ask the AI to draft a reply to a client
            based on the project history, Stages may send the conversation
            history from that pipeline to our AI provider. If you ask the
            AI to perform an action in a connected integration (e.g.,
            &ldquo;draft a thank-you email in Instantly&rdquo;), Stages
            sends the necessary context to the AI provider and the
            resulting draft to the integration on your behalf. The data
            flow is scoped to the action you invoked; AI providers never
            receive your full workspace, only the slice relevant to the
            request. The AI provider&apos;s no-training commitment applies
            to the entire flow.
          </P>

          <P>
            <strong>Sub-processor notice.</strong> We publish our AI
            sub-processor list at the link in § 5 (Who we share with).
            Before we add a new AI provider, we will give you at least
            30 days&apos; notice via an in-app banner so you can pause
            your use of AI features if you object to the new provider.
          </P>

          <P>
            <strong>Security-incident carveout.</strong> We may swap one
            AI provider for another without 30 days&apos; advance notice
            if we need to do so to address an active security incident.
            For example, if a current provider experiences a breach or
            sustained outage that puts your data at risk. In that case,
            we will inform you promptly after the swap and explain why.
          </P>

          <P>
            <strong>Human review for safety and quality.</strong> A small
            percentage of AI agent inputs and outputs may be sampled for
            review by Stages employees, under confidentiality agreements,
            solely to evaluate quality and detect safety issues (for
            example, prompt-injection attempts or misuse of an
            integration). Reviewed material is never used to train AI
            models. This is consistent with our broader commitment that
            no AI provider trains on your data.
          </P>

          <P>
            <strong>Questions or concerns.</strong> For any AI-related
            question (including requests to clarify what an action did,
            to revoke an integration&apos;s permission, or to opt out of
            improvement signals), email{" "}
            <a
              href="mailto:privacy@trystages.com"
              className="text-stages-blue hover:underline"
            >
              privacy@trystages.com
            </a>
            .
          </P>
        </Section>

        {/* ─── 10. Cookies ─────────────────────────────────────────── */}
        <Section id="cookies" title="10. Cookies">
          <P>
            Stages uses cookies only for authentication. Specifically:
          </P>
          <List>
            <li>
              <strong>Supabase Auth session cookie.</strong> An HTTP-only,
              same-origin cookie that keeps you signed in. JavaScript on
              the page cannot read it (the <code>HttpOnly</code> flag
              prevents this). The cookie expires after 30 days of
              inactivity for client users and after our standard session
              window for agency users.
            </li>
            <li>
              <strong>Supabase Auth PKCE-flow cookie (transient).</strong>{" "}
              Used briefly during OAuth-style signin to coordinate the
              redirect handshake; expires within the same session.
            </li>
          </List>
          <P>
            We do not use marketing, advertising, or analytics cookies. We
            do not embed third-party tracking pixels, share you with ad
            networks, or set tag-manager cookies.
          </P>
        </Section>

        {/* ─── 11. Children ────────────────────────────────────────── */}
        <Section id="children" title="11. Children">
          <P>
            Stages is a business product intended for users 16 years of
            age or older. We do not knowingly collect personal data from
            children under 16. If you believe a child has provided us with
            personal data, please contact{" "}
            <a
              href="mailto:privacy@trystages.com"
              className="text-stages-blue hover:underline"
            >
              privacy@trystages.com
            </a>{" "}
            and we will delete it.
          </P>
        </Section>

        {/* ─── 12. Changes ─────────────────────────────────────────── */}
        <Section id="changes" title="12. Changes to this policy">
          <P>
            We will update this Privacy Policy from time to time. For
            material changes (including the addition of new processors
            or AI providers), we will give at least 30 days&apos; notice
            via an in-app banner before the changes take effect, so you
            can review them and (if applicable) pause your use of
            affected features.
          </P>
          <P>
            The &ldquo;Last updated&rdquo; date at the top of this page
            reflects the most recent change.
          </P>
        </Section>

        {/* ─── 13. Contact ─────────────────────────────────────────── */}
        <Section id="contact" title="13. Contact">
          <P>
            For all privacy-related inquiries (access requests, deletion
            requests, data portability, complaints, or general questions),
            please email{" "}
            <a
              href="mailto:privacy@trystages.com"
              className="text-stages-blue hover:underline"
            >
              privacy@trystages.com
            </a>
            .
          </P>
          <P>
            For Terms-of-Service and other legal correspondence, see § 16
            of our{" "}
            <a href="/terms" className="text-stages-blue hover:underline">
              Terms of Service
            </a>
            .
          </P>
          <P className="text-zinc-500 text-[13px] mt-6 italic">
            Operated by SalesEdge LLC, a New Jersey limited liability
            company doing business as Stages. Mailing address to be added
            on the next legal-review iteration.
          </P>
        </Section>
      </div>
    </article>
  );
}

// ── Section primitives (inline; shared via copy in /terms) ────────────

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 mb-12">
      <h2
        className="text-[20px] sm:text-[22px] font-semibold mb-4"
        style={{ color: "#9586EE" }}
      >
        {title}
      </h2>
      <div className="space-y-4 text-[15px] text-zinc-300 leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[14px] font-semibold text-zinc-100 mt-5 mb-2">
      {children}
    </h3>
  );
}

function P({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={className}>{children}</p>;
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc pl-6 space-y-2.5">{children}</ul>;
}
