import type { ReactNode } from "react";

type Props = {
  /** Heading shown above the form, e.g. "Sign in" or "Create your account". */
  title: string;
  /** Single-line subtitle shown beneath the heading. */
  subtitle: string;
  children: ReactNode;
};

/**
 * Shared chrome for the auth + invite surfaces (/auth/*, /select-workspace,
 * /onboarding/*, /accept-invite/[token], /portal/accept/[token]).
 *
 * Visual identity: dotted-grid backdrop + centered panel-card frame +
 * full Stages wordmark at the top. AppShell (in-workspace chrome) keeps
 * the compact cascading-bars mark; this surface is the marketing-adjacent
 * one where the recognisable wordmark builds trust before sign-in.
 *
 * The wordmark SVG (public/stages-logo.svg) is rendered via plain <img>
 * rather than next/image because SVGs don't benefit from Next.js's
 * raster-optimisation pipeline, and the file is above-the-fold so lazy
 * loading is undesirable. Background <rect> stripped from the source SVG
 * so it integrates with the panel-card surface without a visible darker
 * tile around the wordmark.
 */
export function AuthShell({ title, subtitle, children }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 w-full max-w-md fade-in">
        <div className="flex items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/stages-logo.svg"
            alt="Stages"
            style={{ height: 32, width: "auto", display: "block" }}
          />
        </div>
        <h2 className="text-xl font-semibold mb-1">{title}</h2>
        <p className="text-[13px] text-zinc-500 mb-5">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
