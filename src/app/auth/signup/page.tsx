import { SignUpPanel } from "@/components/auth/SignUpPanel";
import { LegalFooterLinks } from "@/components/legal/LegalFooterLinks";
import { SignupPageViewTracker } from "@/components/analytics/SignupPageViewTracker";

export const metadata = {
  title: "Create account — Stages",
};

export default function SignUpPage() {
  return (
    <>
      <SignupPageViewTracker />
      <SignUpPanel />
      <LegalFooterLinks />
    </>
  );
}
