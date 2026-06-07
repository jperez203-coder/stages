import { SignInPanel } from "@/components/auth/SignInPanel";
import { LegalFooterLinks } from "@/components/legal/LegalFooterLinks";

export const metadata = {
  title: "Sign in — Stages",
};

export default function SignInPage() {
  return (
    <>
      <SignInPanel />
      <LegalFooterLinks />
    </>
  );
}
