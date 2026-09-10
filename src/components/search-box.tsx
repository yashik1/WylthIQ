"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Result {
  symbol: string;
  name: string;
  exchange?: string | null;
  country?: string | null;
  /** False for listings outside SEC coverage — findable, but not scoreable. */
  supported?: boolean;
}

/**
 * Symbol search with keyboard navigation.
 *
 * Requests are debounced and each one aborts the previous, so fast typing
 * cannot land an older response after a newer one.
 */
/**
 * `hero` is the 44px variant with a submit beside it; `chrome` is the 34px
 * header one. The submit is deliberately wired to the same `go` the keyboard
 * uses rather than being a separate code path — a button that navigated
 * differently from Enter would be a bug waiting to happen.
 */
export function SearchBox({
  className,
  autoFocus,
  variant = "chrome",
  submitLabel,
}: {
  className?: string;
  autoFocus?: boolean;
  variant?: "chrome" | "hero";
  submitLabel?: string;
}) {
  const router = useRouter();
  const listId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      // Cleared asynchronously so the update is not applied synchronously
      // within the effect body.
      const reset = setTimeout(() => {
        setResults([]);
        setProblem(null);
        setLoading(false);
      }, 0);
      return () => clearTimeout(reset);
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        const json = await res.json();
        // A failed lookup and a genuine "no such company" previously looked
        // identical — both showed an empty box, which leaves nothing to act on.
        setProblem(json.error ? (json.message ?? "Search is unavailable.") : null);
        setResults(json.results ?? []);
        setActive(0);
      } catch {
        // Aborted or offline: leave the previous results in place.
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  // Close when focus or a click moves outside the component.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function go(symbol: string) {
    setOpen(false);
    setQuery("");
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = results[active];
      if (pick) go(pick.symbol);
      else if (query.trim()) go(query.trim().toUpperCase());
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  /** What Enter does, so the button and the keyboard cannot drift apart. */
  function submit() {
    const pick = results[active];
    if (pick) go(pick.symbol);
    else if (query.trim()) go(query.trim().toUpperCase());
  }

  const hero = variant === "hero";

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className={cn("relative", hero && submitLabel && "grid grid-cols-[minmax(0,1fr)_132px] gap-2.5")}>
        <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search for a company or ticker"
          autoFocus={autoFocus}
          value={query}
          placeholder={hero ? "Search a company or ticker…" : "Company or ticker"}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-lg border border-border bg-surface pl-9 pr-3 outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/10",
            hero ? "h-12 text-[0.90625rem] shadow-sm" : "h-[34px] text-[0.84375rem]",
          )}
        />
        </div>
        {hero && submitLabel && (
          <button
            type="button"
            onClick={submit}
            className="font-display h-12 rounded-lg bg-accent text-[0.90625rem] font-semibold text-accent-fg shadow-sm transition-[background-color,box-shadow,transform] hover:-translate-y-px hover:bg-accent-hover hover:shadow"
          >
            {submitLabel}
          </button>
        )}
      </div>

      {open && query.trim().length > 0 && (results.length > 0 || loading || problem || !loading) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-border bg-surface py-1 shadow-[var(--shadow-lg)]"
        >
          {results.length === 0 && loading && (
            <li className="px-3 py-2 text-sm text-muted">Searching…</li>
          )}

          {/* Distinguish an outage from a query that genuinely matches nothing. */}
          {!loading && problem && (
            <li className="px-3 py-2.5 text-sm">
              <span className="font-medium text-poor">Search is unavailable</span>
              <span className="mt-0.5 block text-xs text-muted">{problem}</span>
            </li>
          )}

          {!loading && !problem && results.length === 0 && (
            <li className="px-3 py-2.5 text-sm">
              <span className="font-medium">No company matched</span>
              <span className="mt-0.5 block text-xs text-muted">
                Try the company name instead of the ticker.
              </span>
            </li>
          )}
          {results.map((r, i) => (
            <li key={`${r.symbol}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r.symbol)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                  i === active ? "bg-surface-2" : "hover:bg-surface-2",
                )}
              >
                {/* Wide enough for a suffixed ticker such as XEQT.TO. */}
                <span className="w-20 shrink-0 font-semibold">{r.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{r.name}</span>
                {/* Naming the exchange up front explains why a foreign listing
                    will not carry scores, before the click rather than after. */}
                {r.exchange && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                      r.supported === false
                        ? "bg-surface-3 text-faint"
                        : "bg-surface-2 text-muted",
                    )}
                    title={
                      r.supported === false
                        ? `Listed on ${r.exchange} — outside SEC filings, so no financial scores`
                        : undefined
                    }
                  >
                    {r.exchange}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
