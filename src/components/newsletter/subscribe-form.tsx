"use client";

import { useActionState } from "react";
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
export function NewsletterSubscribeForm() {
  const [result, action] = useActionState<NewsletterResult | null, FormData>(
    subscribeToNewsletter,
    null,
  );

  return (
    <form action={action} className="mt-2.5">
      <div className="flex flex-wrap gap-2">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="newsletter-email"
          type="email"
          name="email"
          required
          autoComplete="email"
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
