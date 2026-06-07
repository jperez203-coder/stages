import { SignUpPanel } from "@/components/auth/SignUpPanel";
import { LegalFooterLinks } from "@/components/legal/LegalFooterLinks";

export const metadata = {
  title: "Create account — Stages",
};

export default function SignUpPage() {
  return (
    <>
      <SignUpPanel />
      <LegalFooterLinks />
    </>
  );
}
