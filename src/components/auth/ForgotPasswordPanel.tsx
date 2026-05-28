"use client";

import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

/**
 * Client wrapper for /auth/forgot-password. Mirrors SignInPanel's shape but
 * has no authenticated branch — a user requesting a reset link is, by
 * definition, signed out. Public route (no auth gate; src/app/auth has no
 * layout by design).
 */
export function ForgotPasswordPanel() {
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
