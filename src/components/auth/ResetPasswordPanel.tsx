"use client";

import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

/**
 * Client wrapper for /auth/reset-password. The recovery link from
 * resetPasswordForEmail lands here with a PKCE ?code=; the global Supabase
 * browser client auto-exchanges it at module load (detectSessionInUrl) —
 * the same mechanism /auth/callback relies on. ResetPasswordForm then waits
 * on useSession and renders the new-password form once the recovery session
 * is established. Public route (no auth gate by design).
 */
export function ResetPasswordPanel() {
  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a new password for your account."
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
