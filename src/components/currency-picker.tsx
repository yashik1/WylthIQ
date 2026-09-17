"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  CURRENCY_CHOICES,
  CURRENCY_COOKIE,
  CURRENCY_COOKIE_MAX_AGE,
} from "@/lib/currency-choice";

/**
 * Which currency a reader wants the figures in.
 *
 * The choice is stored in a cookie rather than in local storage because the
 * page that uses it is rendered on the server: the figures are converted
 * before the HTML exists, so the server has to know before it renders, and
 * local storage is only readable after. A cookie also carries the choice to
 * every other company page without asking again.
 *
 * A plain select, deliberately. It is a short list of one-word answers, every
 * browser already knows how to present one on a phone, and it costs no
 * JavaScript beyond the line that writes the cookie.
 */
export function CurrencyPicker({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(code: string) {
    // Not HttpOnly: this is a display preference the page itself sets, and
    // nothing is authorised by it. SameSite=Lax keeps it off cross-site
    // requests all the same.
    document.cookie =
      `${CURRENCY_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=` +
      `${code ? CURRENCY_COOKIE_MAX_AGE : 0}; SameSite=Lax`;

    // The server re-renders with the new cookie; nothing here recalculates a
    // figure, because converting in the browser would mean two places that
    // both decide what a number means.
    startTransition(() => router.refresh());
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <span>Shown in</span>
      <select
        aria-label="Currency to show figures in"
        className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-foreground"
        value={current}
        disabled={pending}
        onChange={(event) => choose(event.target.value)}
      >
        {CURRENCY_CHOICES.map((choice) => (
          <option key={choice.code || "as-traded"} value={choice.code}>
            {choice.code ? `${choice.code} — ${choice.label}` : choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}
