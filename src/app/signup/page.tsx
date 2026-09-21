import type { Metadata } from "next";
import { AuthShell, AuthFooterLink } from "@/components/auth/auth-form";
import { SignUpForm } from "@/components/auth/signup-form";
import { isEmailConfigured } from "@/lib/email";

/*
  Deliberately not indexed.

  A sign-in form has nothing to answer a search with, and an audit reads
  it as a thin page with no structured data — which it is, correctly. The
  links out of it are still followed, so the pages behind it are reachable.
*/
export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: true },
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create an account"
      subtitle="For backtesting and the trade journal. The screener, company pages and charts stay free."
      footer={<AuthFooterLink href="/signin">Already have an account? Sign in</AuthFooterLink>}
    >
      {/*
        Whether mail can be sent is a fact about the deployment, read here on
        the server and handed down — the fields and the newsletter offer that
        follows them are one client component, and it has no business reading
        environment variables.
      */}
      <SignUpForm canOfferNewsletter={isEmailConfigured()} />
    </AuthShell>
  );
}
