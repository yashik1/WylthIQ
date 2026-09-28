"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Catches an unhandled failure anywhere in the page tree.
 *
 * Every figure here is fetched live from SEC EDGAR and the price providers, so
 * an upstream outage or rate limit is a normal thing to hit rather than an
 * exotic one. Without this boundary that surfaces as a blank screen with no way
 * forward; with it, the reader gets a plain explanation and a retry that does
 * not lose their place.
 *
 * Written for readers, not operators. It used to point at /api/health and
 * repeat the error's own message, which told a visitor nothing they could act
 * on and exposed how the site is put together. Operators have the server log,
 * which carries the full error; the short reference at the bottom is what
 * ties this screen to the entry there when somebody reports it.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  const rateLimited = /rate limit|quota|credits|429/i.test(error.message);

  return (
    <div className="mx-auto max-w-2xl py-14">
      <p className="eyebrow">Temporarily unavailable</p>
      <h1 className="font-display mt-3 text-4xl sm:text-5xl">
        {rateLimited ? "Too many requests right now" : "This isn't available right now"}
      </h1>

      <p className="mt-3 text-base leading-relaxed text-muted">
        {rateLimited
          ? "The market data behind this page allows a limited number of requests each minute, and that limit has been reached. Waiting a moment and trying again usually clears it."
          : "Something on our side didn't respond. It's usually temporary — please try again in a moment."}
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
        >
          Back to the dashboard
        </Link>
      </div>

      {error.digest && <p className="tnum mt-8 text-xs text-faint">Reference {error.digest}</p>}
    </div>
  );
}
