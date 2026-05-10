"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/SignUpForm";
import { WorkspaceSelector } from "@/components/auth/WorkspaceSelector";
import { useSession } from "@/hooks/useSession";

/**
 * Client wrapper for /auth/signup. Three states:
 *   1. anonymous + no pending confirmation → render the form
 *   2. anonymous + sign-up succeeded but email not yet confirmed → "check
 *      your email" message
 *   3. authenticated (email already confirmed, or instant if email
 *      confirmation is OFF in this project) → AuthSuccessState
 */
export function SignUpPanel() {
  const session = useSession();
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);

  if (session.status === "loading") {
    return (
      <AuthShell title="Create your account" subtitle="Setting things up.">
        <div className="h-32" />
      </AuthShell>
    );
  }

  if (session.status === "authenticated") {
    return <WorkspaceSelector />;
  }

  if (pendingConfirmEmail) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="One more step to finish creating your account."
      >
        <div className="text-center">
          <div className="inline-flex w-12 h-12 rounded-full items-center justify-center mb-4 bg-stages-blue/10">
            <Mail size={22} className="text-stages-blue" />
          </div>
          <p className="text-[14px] text-zinc-200 mb-1">Confirmation link sent</p>
          <p className="text-[13px] text-zinc-400 mb-5 break-all">
            {pendingConfirmEmail}
          </p>
          <p className="text-[12px] text-zinc-500 mb-5 leading-relaxed">
            Click the link in your email to verify your account. You can close
            this tab — once you click the link, you&apos;ll be signed in
            automatically.
          </p>
          <button
            onClick={() => setPendingConfirmEmail(null)}
            className="btn-ghost w-full justify-center"
          >
            Use a different email
          </button>
          {/* Defense-in-depth safety link. The SignUpForm catches the
              "already-registered" obfuscated response and shows an inline
              error with this same link, so this state should normally only
              appear for genuinely new signups. But if Supabase changes the
              obfuscation behaviour and the inline detection breaks, this
              link still gets the user where they need to go. */}
          <p className="mt-4 text-[12px] text-zinc-600">
            Already have an account?{" "}
            <Link
              href="/auth/signin"
              className="text-stages-blue hover:underline font-medium"
            >
              Sign in instead
            </Link>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up a workspace to start tracking client engagements."
    >
      <SignUpForm onSignedUp={setPendingConfirmEmail} />
    </AuthShell>
  );
}
