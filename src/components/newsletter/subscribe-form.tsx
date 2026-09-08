"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { subscribeToNewsletter, type NewsletterResult } from "@/lib/newsletter/actions";

/**
 * The public newsletter signup.
 *
 * An address and nothing else — no account, no password, no name. Every field
 * added to a form like this costs subscribers, and none of them would change
 * what gets sent.
 *
 * The reply is rendered verbatim from the action rather than being decided
 * here, because which message is correct depends on whether the deployment
 * can send mail at all, and that is the action's business. It also means this
 * component cannot accidentally claim an email was sent.
 */
export function NewsletterSubscribeForm({
  defaultEmail,
  className = "mt-2.5",
}: {
  /**
   * Pre-fills the address, for the one caller that already knows it.
   *
   * The sign-up prompt has just watched somebody type their email; asking
   * for it a second time is the kind of small friction that loses the
   * subscription. Still an editable field rather than a fixed value — a
   * reader may well want their newsletter somewhere other than their login.
   */
  defaultEmail?: string;
  className?: string;
} = {}) {
  const [result, action] = useActionState<NewsletterResult | null, FormData>(
    subscribeToNewsletter,
    null,
  );

  /*
    The id is generated rather than written, because this form is no longer
    rendered once per page. The footer carries one on every route, and the
    sign-up prompt renders a second — two elements sharing `newsletter-email`
    would point both labels at whichever came first, so clicking the label in
    the dialog would focus the input behind it and a screen reader would
    announce the wrong field.
  */
  const id = useId();

  return (
    <form action={action} className={className}>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={id} className="sr-only">
          Email address
        </label>
        <input
          id={id}
          type="email"
          name="email"
          required
          autoComplete="email"
          defaultValue={defaultEmail}
          placeholder="you@example.com"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-[0.8125rem] outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/10"
        />
        <SubmitButton />
      </div>

      {result && (
        <p
          // Announced rather than only shown: somebody using a screen reader
          // submits this and would otherwise get no indication it did anything.
          role="status"
          className={`mt-2 text-[0.75rem] leading-relaxed ${
            result.ok ? "text-good-fg" : "text-poor-fg"
          }`}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="font-display h-9 shrink-0 rounded-lg bg-accent px-4 text-[0.8125rem] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-60"
    >
      {pending ? "Signing up…" : "Subscribe"}
    </button>
  );
}
