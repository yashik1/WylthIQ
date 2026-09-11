"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { LocalTime } from "@/components/local-time";
import { getRecent, getServerSnapshot, subscribe } from "@/lib/watchlist";

/**
 * The companies most recently opened in this browser.
 *
 * Local, like the dashboard's recently viewed list: it is a trail through this
 * device rather than a list anybody curated, so it starts empty on a new
 * browser and is never sent to the account.
 */
export function ContinueResearching({ limit = 8 }: { limit?: number }) {
  const recent = useSyncExternalStore(subscribe, getRecent, getServerSnapshot);

  if (recent.length === 0) {
    return (
      <p className="px-5 py-4 text-sm text-muted">
        Companies you open in this browser appear here, most recent first.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {recent.slice(0, limit).map((entry) => (
        <li key={entry.symbol}>
          <Link
            href={`/stock/${encodeURIComponent(entry.symbol)}`}
            className="flex items-baseline justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="text-sm font-bold tracking-tight">{entry.symbol}</span>
              {entry.name && <span className="truncate text-xs text-muted">{entry.name}</span>}
            </span>
            <LocalTime
              value={entry.addedAt}
              mode="relative"
              className="shrink-0 text-xs text-faint"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
