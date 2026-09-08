"use client";

import { useCallback, useState } from "react";
import { ActionForm, Field } from "./auth-form";
import { NewsletterJoinPrompt } from "@/components/newsletter/join-prompt";
import { signUp } from "@/lib/auth/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

/**
 * The sign-up form, plus the one thing that happens after it succeeds.
 *
 * A client component only because the newsletter prompt has to know that the
 * account was created and which address created it. `ActionForm` owns both
 * facts already — it holds the action's result and the snapshot it re-fills
 * refused submissions from — so this reads them through `onSuccess` rather
 * than running a second copy of that machinery, which would mean two places
 * deciding how an account form reports itself.
 */
export function SignUpForm({ canOfferNewsletter }: { canOfferNewsletter: boolean }) {
  const [prompt, setPrompt] = useState<string | null>(null);

  const offer = useCallback(
    (values: Record<string, string>) => {
      /*
        Nothing to offer when the deployment cannot send.

        The newsletter is double opt-in: subscribing sends a confirmation
        link and the address counts for nothing until it is clicked. Without
        a mail provider that link never arrives, so the dialog would be
        asking for a decision it cannot act on — the same reason
        /forgot-password says so before its form rather than after it.
      */
      if (!canOfferNewsletter) return;
      const email = values.email;
      if (email) setPrompt(email);
    },
    [canOfferNewsletter],
  );

  const dismiss = useCallback(() => setPrompt(null), []);

  return (
    <>
      <ActionForm action={signUp} submitLabel="Create account" onSuccess={offer}>
        {/* Still optional, and still the `name` field — but presented as a
            username, because that is what a uniqueness rule makes it. Two
            people called John Smith both have a claim on that display name;
            neither has a claim on the same identifier. */}
        <Field
          label="Username (optional)"
          name="name"
          autoComplete="username"
          hint="Shown in the header and on your account. Letters, numbers, dots, dashes and underscores — no spaces."
        />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`}
        />
      </ActionForm>

      {/*
        Mounting is what opens it, so it cannot flash empty on the way in, and
        unmounting on dismissal is what closes it — one source of truth for
        whether the offer is on screen.
      */}
      {prompt !== null && <NewsletterJoinPrompt email={prompt} onDismiss={dismiss} />}
    </>
  );
}
