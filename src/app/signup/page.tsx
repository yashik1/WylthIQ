import type { Metadata } from "next";
import { AuthShell, AuthFooterLink } from "@/components/auth/auth-form";
import { SignUpForm } from "@/components/auth/signup-form";
import { isEmailConfigured } from "@/lib/email";

export const metadata: Metadata = { title: "Create an account" };

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
