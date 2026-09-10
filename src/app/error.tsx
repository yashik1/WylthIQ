"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Card } from "@/components/ui";

/**
 * Catches an unhandled failure anywhere in the page tree.
 *
 * Every figure here is fetched live from SEC EDGAR and the price providers, so
 * an upstream outage or rate limit is a normal thing to hit rather than an
 * exotic one. Without this boundary that surfaces as a blank screen with no way
 * forward; with it, the reader gets an explanation and a retry that does not
 * lose their place.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server logs carry the full stack; the digest is what ties this render to
    // that entry when someone reports a problem.
    console.error("Page error:", error);
  }, [error]);

  const rateLimited = /rate limit|quota|credits|429/i.test(error.message);
  const redact = (message: string) =>
    message.replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]").slice(0, 300);

  return (
    <div className="mx-auto max-w-2xl py-14">
      <p className="eyebrow">Something broke</p>
      <h1 className="font-display mt-3 text-4xl sm:text-5xl">
        {rateLimited ? "We've hit a data limit" : "That didn't load"}
      </h1>

      <p className="mt-3 text-base leading-relaxed text-muted">
        {rateLimited
          ? "The free data plans allow a limited number of requests per minute, and we've reached it. Waiting a moment and trying again usually clears it."
          : "Something went wrong fetching this page. The data comes from SEC EDGAR and outside price providers, so this is often a temporary upstream problem rather than anything you did."}
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

      <Card className="mt-8 p-5">
        <h2 className="text-sm font-semibold">If it keeps happening</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Open{" "}
          <Link href="/api/health" className="text-accent hover:underline">
            /api/health
          </Link>{" "}
          — it reports exactly what this deployment can reach: the database, its tables,
          and whether each price provider is responding.
        </p>
        {/*
          Without this the page said only "that didn't load", which is useless
          to report and useless to debug — a screenshot of it carried no
          information at all. A server failure is identified by its digest,
          which ties the render to a line in the host's logs; a failure in the
          browser has no digest but does keep its message, so show whichever
          exists. Connection strings are stripped because a driver error
          helpfully embeds the database password in its message.
        */}
        {(error.digest || error.message) && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs text-faint">
              {error.digest
                ? "Quote this reference — it matches an entry in the server log:"
                : "This happened in the browser. The message was:"}
            </p>
            <p className="tnum mt-1 font-mono text-xs break-words text-muted">
              {error.digest ?? redact(error.message)}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
