import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Stages",
  description:
    "The agreement between SalesEdge LLC d/b/a Stages and customers of the Stages service.",
};

// ─────────────────────────────────────────────────────────────────────────
// B2B SaaS standard ToS structure. 16 sections.
//
// Locked at Slice S7 build time (2026-06-08):
//   - Contracting party: SalesEdge LLC, NJ LLC, d/b/a Stages
//   - Governing law: New Jersey (§ 13)
//   - Legal contact: support@trystages.com with routing note (§ 16)
//   - Liability cap: greater of (a) 12-month fees or (b) $100 (§ 11)
//   - Mailing address: deferred to next legal-review iteration
//
// Pre-legal-review status surfaced via the (legal) layout banner.
// ─────────────────────────────────────────────────────────────────────────

const TOC = [
  { id: "effective", label: "1. Effective dates" },
  { id: "acceptance", label: "2. Acceptance of terms" },
  { id: "service", label: "3. Service description" },
  { id: "account", label: "4. Account registration" },
  { id: "acceptable", label: "5. Acceptable use" },
  { id: "billing", label: "6. Subscription and billing" },
  { id: "content", label: "7. Your content" },
  { id: "ip", label: "8. Intellectual property" },
  { id: "termination", label: "9. Termination" },
  { id: "disclaimers", label: "10. Disclaimers" },
  { id: "liability", label: "11. Limitation of liability" },
  { id: "indemnification", label: "12. Indemnification" },
  { id: "law", label: "13. Governing law" },
  { id: "disputes", label: "14. Dispute resolution" },
  { id: "changes", label: "15. Changes to these terms" },
  { id: "contact", label: "16. Contact" },
];

export default function TermsOfServicePage() {
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
            Terms of Service
          </h1>
          <div className="text-[13px] text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
            <span>Effective: June 8, 2026</span>
            <span>Last updated: June 8, 2026</span>
            <span>~12 min read</span>
          </div>
        </header>

        {/* ─── 1. Effective dates ──────────────────────────────────── */}
        <Section id="effective" title="1. Effective dates">
          <P>
            These Terms of Service are effective as of{" "}
            <strong>June 8, 2026</strong> and were last updated on the same
            date.
          </P>
        </Section>

        {/* ─── 2. Acceptance ───────────────────────────────────────── */}
        <Section id="acceptance" title="2. Acceptance of terms">
          <P>
            These Terms of Service (&ldquo;Terms&rdquo;) constitute a legally
            binding agreement between{" "}
            <strong>
              SalesEdge LLC, a New Jersey limited liability company doing
              business as &ldquo;Stages&rdquo;
            </strong>{" "}
            (&ldquo;Stages,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
            &ldquo;our&rdquo;), and the entity or person (&ldquo;Customer,&rdquo;{" "}
            &ldquo;you,&rdquo; or &ldquo;your&rdquo;) agreeing to these
            Terms. By creating an account, accessing, or using the Stages
            service, you accept and agree to be bound by these Terms.
          </P>
          <P>
            If you are accepting these Terms on behalf of an organization,
            you represent that you have authority to bind that organization,
            and &ldquo;you&rdquo; and &ldquo;your&rdquo; refer to that
            organization.
          </P>
          <P>
            If you do not agree to these Terms, do not create an account or
            use the service.
          </P>
        </Section>

        {/* ─── 3. Service description ──────────────────────────────── */}
        <Section id="service" title="3. Service description">
          <P>
            Stages is a workspace product for client services businesses:
            agencies, consultants, freelancers, and similar teams. Stages
            provides tools to organize client work, including pipelines,
            stages, tasks, notes, chat, and files. We also provide a
            client-portal surface that lets your customers see and interact
            with the parts of a project you choose to share.
          </P>
          <P>
            We may release new features, change existing features, or remove
            features at our discretion. We will give reasonable notice for
            material removals.
          </P>
        </Section>

        {/* ─── 4. Account registration ─────────────────────────────── */}
        <Section id="account" title="4. Account registration">
          <P>
            To use Stages, you must create an account. You agree to provide
            accurate, current, and complete information during registration,
            and to update it as needed to keep it accurate.
          </P>
          <P>
            You are responsible for maintaining the confidentiality of your
            account credentials and for all activity that occurs under your
            account. Notify us promptly at{" "}
            <a
              href="mailto:support@trystages.com"
              className="text-stages-blue hover:underline"
            >
              support@trystages.com
            </a>{" "}
            if you become aware of any unauthorized access to your account.
          </P>
          <P>
            You must be at least 16 years old to use Stages. The service is
            not directed at children under 16.
          </P>
        </Section>

        {/* ─── 5. Acceptable use ──────────────────────────────────── */}
        <Section id="acceptable" title="5. Acceptable use">
          <P>You agree not to:</P>
          <List>
            <li>
              Use the service in any way that violates applicable law, or to
              process content that you do not have the right to process.
            </li>
            <li>
              Resell, sublicense, or commercially redistribute access to the
              service without our prior written permission.
            </li>
            <li>
              Reverse engineer, decompile, or attempt to derive the source
              code of any part of the service.
            </li>
            <li>
              Scrape, crawl, or extract data from the service through
              automated means, except as expressly permitted by features we
              provide.
            </li>
            <li>
              Use the service to send spam, malware, or any communication
              intended to harm, defraud, or harass another person.
            </li>
            <li>
              Attempt to interfere with the security, availability, or
              integrity of the service, including by probing for
              vulnerabilities outside of any responsible-disclosure
              process we may publish.
            </li>
            <li>
              Use the service in a way that infringes the intellectual
              property, privacy, or other rights of any third party.
            </li>
          </List>
          <P>
            We may suspend or terminate access for material breach of these
            acceptable-use rules, with notice where reasonable under the
            circumstances.
          </P>
        </Section>

        {/* ─── 6. Billing ──────────────────────────────────────────── */}
        <Section id="billing" title="6. Subscription and billing">
          <P>
            Stages offers paid subscription plans, including a free trial
            period for new workspaces. Pricing and plan details are
            available in the application. Subscriptions automatically renew
            at the end of each billing period unless you cancel.
          </P>
          <P>
            We use Stripe to process payments. By providing payment
            information, you authorize Stripe to charge your designated
            payment method for the applicable fees. Stripe&apos;s terms also
            apply to your use of its services.
          </P>
          <P>
            <strong>Cancellation.</strong> You can cancel your subscription
            at any time through the Stripe Customer Portal accessible from
            your workspace billing settings. Cancellation takes effect at
            the end of your current billing period; you retain access until
            then. We do not provide refunds for partial periods except as
            required by law.
          </P>
          <P>
            <strong>Failed payments.</strong>{" "}If a payment fails, your
            subscription may move to a &ldquo;past due&rdquo; state and,
            after a reasonable retry period, be canceled.
          </P>
          <P>
            <strong>Founding members.</strong> Customers who purchase a
            founding-member plan during the founding window receive the
            pricing terms displayed at the time of purchase, which may
            include a discount that persists for the life of the
            subscription. The specific terms of the founding-member
            program are described in the application at the time of
            purchase.
          </P>
        </Section>

        {/* ─── 7. Your content ─────────────────────────────────────── */}
        <Section id="content" title="7. Your content">
          <P>
            <strong>You own your content.</strong> All workspace data you
            create or upload (pipelines, stages, tasks, notes, messages,
            files, and similar) remains your property. Stages does not
            claim ownership of your content.
          </P>
          <P>
            <strong>Limited license to operate the service.</strong> You
            grant Stages a worldwide, non-exclusive, royalty-free license
            to host, store, transmit, display, copy, and back up your
            content as reasonably necessary to provide and improve the
            service to you. This license terminates when you delete the
            content or terminate your account, except as required to
            comply with legal obligations or to preserve information
            already shared with other workspace members under your
            access controls.
          </P>
          <P>
            <strong>Your responsibility for content.</strong> You are
            responsible for the content you store in Stages and for
            ensuring you have the rights necessary to do so. You
            represent that your content does not infringe the rights of
            any third party.
          </P>
        </Section>

        {/* ─── 8. IP ───────────────────────────────────────────────── */}
        <Section id="ip" title="8. Intellectual property">
          <P>
            <strong>Our IP.</strong> The Stages platform (including the
            software, design, brand, trademarks, logos, and all related
            intellectual property) is and remains the exclusive property
            of SalesEdge LLC. These Terms grant you a limited,
            non-exclusive, non-transferable, revocable license to access
            and use the service in accordance with these Terms; no other
            rights are granted.
          </P>
          <P>
            <strong>Feedback.</strong> If you provide suggestions, ideas,
            or feedback about the service, you grant us a perpetual,
            irrevocable, royalty-free license to use that feedback for
            any purpose, without obligation to you.
          </P>
          <P>
            <strong>Trademarks.</strong>{" "}&ldquo;Stages&rdquo; and the
            Stages logo are trademarks of SalesEdge LLC. You may not use
            them without our prior written permission, except for
            permitted descriptive uses (e.g., &ldquo;we use Stages to
            manage our client work&rdquo;).
          </P>
        </Section>

        {/* ─── 9. Termination ──────────────────────────────────────── */}
        <Section id="termination" title="9. Termination">
          <P>
            <strong>By you.</strong> You may stop using the service at any
            time. To delete your account and request removal of your
            personal data, follow the process described in our{" "}
            <a href="/privacy" className="text-stages-blue hover:underline">
              Privacy Policy
            </a>{" "}
            § 8 (Your rights).
          </P>
          <P>
            <strong>By us.</strong> We may suspend or terminate your access
            to the service if you materially breach these Terms (including
            the acceptable-use rules in § 5), if required by law, or if
            continued provision of the service to you poses a risk to
            other customers or to the service itself. Where reasonable, we
            will provide notice and an opportunity to cure before
            termination.
          </P>
          <P>
            <strong>Effect of termination.</strong> Upon termination, your
            right to use the service ends. Provisions that by their nature
            should survive termination (including but not limited to §§ 7,
            8, 10, 11, 12, 13, 14) will survive.
          </P>
        </Section>

        {/* ─── 10. Disclaimers ────────────────────────────────────── */}
        <Section id="disclaimers" title="10. Disclaimers">
          <P>
            THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
            AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR
            IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
            NON-INFRINGEMENT, OR THAT THE SERVICE WILL BE UNINTERRUPTED OR
            ERROR-FREE.
          </P>
          <P>
            STAGES IS NOT A SUBSTITUTE FOR PROFESSIONAL ADVICE. The service
            is not designed to provide medical, legal, financial, tax,
            accounting, or other professional advice. You should consult
            qualified professionals for advice tailored to your
            circumstances.
          </P>
          <P>
            Some jurisdictions do not allow the exclusion of certain
            warranties. To the extent such exclusion is not permitted in
            your jurisdiction, the warranties in this section are
            disclaimed to the maximum extent permitted by law.
          </P>
        </Section>

        {/* ─── 11. Liability cap (LOCKED) ─────────────────────────── */}
        <Section id="liability" title="11. Limitation of liability">
          <P>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, STAGES SHALL
            NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
            CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
            REVENUE, GOODWILL, DATA, OR BUSINESS OPPORTUNITY, ARISING FROM
            OR RELATED TO THESE TERMS OR YOUR USE OF THE SERVICE, WHETHER
            BASED IN CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT
            LIABILITY, OR ANY OTHER LEGAL THEORY, EVEN IF STAGES HAS BEEN
            ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </P>
          <P>
            <strong>
              Stages&apos; total cumulative liability arising from or
              related to this Agreement shall not exceed the greater of:
              (a) the total fees paid by Customer to Stages in the twelve
              (12) months preceding the event giving rise to the claim, or
              (b) one hundred U.S. dollars ($100).
            </strong>
          </P>
          <P>
            Some jurisdictions do not allow the limitation of liability for
            certain damages. To the extent such limitation is not
            permitted in your jurisdiction, our liability is limited to
            the minimum extent permitted by law.
          </P>
        </Section>

        {/* ─── 12. Indemnification ────────────────────────────────── */}
        <Section id="indemnification" title="12. Indemnification">
          <P>
            You agree to indemnify, defend, and hold harmless SalesEdge LLC
            and its officers, directors, employees, and agents from and
            against any third-party claims, damages, liabilities, costs,
            and expenses (including reasonable attorneys&apos; fees) arising
            from or related to: (a) your content; (b) your use of the
            service in violation of these Terms or applicable law; (c)
            your violation of any rights of a third party; or (d) any
            unauthorized use of your account that results from your
            failure to keep your credentials confidential.
          </P>
        </Section>

        {/* ─── 13. Governing law (LOCKED — NJ) ────────────────────── */}
        <Section id="law" title="13. Governing law">
          <P>
            These Terms are governed by and construed in accordance with
            the laws of the <strong>State of New Jersey</strong>, United
            States, without regard to its conflict-of-laws principles. The
            United Nations Convention on Contracts for the International
            Sale of Goods does not apply.
          </P>
        </Section>

        {/* ─── 14. Disputes ───────────────────────────────────────── */}
        <Section id="disputes" title="14. Dispute resolution">
          <P>
            <strong>Informal resolution first.</strong> If you have a
            dispute with us, you agree to contact us at{" "}
            <a
              href="mailto:support@trystages.com"
              className="text-stages-blue hover:underline"
            >
              support@trystages.com
            </a>{" "}
            and try to resolve the dispute informally before initiating
            any formal proceeding. We will do the same for any dispute we
            have with you.
          </P>
          <P>
            <strong>Arbitration.</strong> If the parties cannot resolve a
            dispute informally within 60 days, any dispute arising out of
            or related to these Terms shall be resolved by binding
            arbitration administered in the State of New Jersey under the
            rules of a recognized arbitration body (e.g., the American
            Arbitration Association). Judgment on the award rendered by
            the arbitrator may be entered in any court of competent
            jurisdiction.
          </P>
          <P>
            <strong>Class action waiver.</strong> To the maximum extent
            permitted by law, the parties agree that any arbitration or
            other proceeding will be conducted only on an individual
            basis and not in a class, consolidated, or representative
            action. If a court determines that this class-action waiver
            is unenforceable in a particular matter, the arbitration
            agreement in this section will not apply to that matter.
          </P>
          <P>
            <strong>Injunctive relief carveout.</strong> Either party may
            seek injunctive or other equitable relief in a court of
            competent jurisdiction to protect its intellectual property
            or confidential information, notwithstanding the arbitration
            agreement above.
          </P>
        </Section>

        {/* ─── 15. Changes ────────────────────────────────────────── */}
        <Section id="changes" title="15. Changes to these terms">
          <P>
            We may update these Terms from time to time. For material
            changes, we will give at least 30 days&apos; notice via an
            in-app banner or email before the changes take effect. The
            &ldquo;Last updated&rdquo; date at the top of this page
            reflects the most recent change.
          </P>
          <P>
            If you do not agree to the updated Terms, you should stop
            using the service before the effective date. Continued use of
            the service after the effective date constitutes acceptance
            of the updated Terms.
          </P>
        </Section>

        {/* ─── 16. Contact (LOCKED routing) ──────────────────────── */}
        <Section id="contact" title="16. Contact">
          <P>
            Legal correspondence and notices should be directed to{" "}
            <a
              href="mailto:support@trystages.com"
              className="text-stages-blue hover:underline"
            >
              support@trystages.com
            </a>{" "}
            and will be routed to the appropriate party.
          </P>
          <P>
            For privacy-specific inquiries, please contact{" "}
            <a
              href="mailto:privacy@trystages.com"
              className="text-stages-blue hover:underline"
            >
              privacy@trystages.com
            </a>{" "}
            as described in our{" "}
            <a href="/privacy" className="text-stages-blue hover:underline">
              Privacy Policy
            </a>
            .
          </P>
          <P className="text-zinc-500 text-[13px] mt-6 italic">
            Operated by SalesEdge LLC, a New Jersey limited liability
            company doing business as Stages.
          </P>
          <P className="text-zinc-500 text-[13px] mt-3">
            Mailing address:
            <br />
            SalesEdge LLC d/b/a Stages
            <br />
            1070 State Route 34, Ste H PMB 1022
            <br />
            Matawan, NJ 07747
            <br />
            United States
          </P>
        </Section>
      </div>
    </article>
  );
}

// ── Section primitives (inline — mirrors /privacy page shape) ─────────

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
