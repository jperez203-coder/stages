import type { ReactNode } from "react";
import { StagesLogo } from "@/components/icons/StagesLogo";

type Props = {
  /** Heading shown above the form, e.g. "Sign in" or "Create your account". */
  title: string;
  /** Single-line subtitle shown beneath the heading. */
  subtitle: string;
  children: ReactNode;
};

/**
 * Shared chrome for /auth/signin, /auth/signup, and (later) /auth/callback
 * landing screens. Matches the existing LoginScreen design — same dotted-grid
 * backdrop, same panel-card frame, same logo placement.
 */
export function AuthShell({ title, subtitle, children }: Props) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 dotted-grid">
      <div className="panel-card p-8 w-full max-w-md fade-in">
        <div className="flex items-center gap-3 mb-6">
          <StagesLogo size={36} />
          <div className="text-base font-semibold">Stages</div>
        </div>
        <h2 className="text-xl font-semibold mb-1">{title}</h2>
        <p className="text-[13px] text-zinc-500 mb-5">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
