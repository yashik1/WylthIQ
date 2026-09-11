"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { BookOpen, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Result {
  symbol: string;
  name: string;
  exchange?: string | null;
  country?: string | null;
  /** False for listings outside SEC coverage — findable, but not scoreable. */
  supported?: boolean;
}

/** A guide or metric explanation that matched the query. */
interface Topic {
  title: string;
  /** "Guide" for a long-form page, "Learn" for a metric explanation. */
  kind: string;
  href: string;
}

type Item = { type: "symbol"; result: Result } | { type: "topic"; topic: Topic };

/**
 * Search for a company, ticker, fund, commodity, coin — or a topic.
 *
 * Requests are debounced and each one aborts the previous, so fast typing
 * cannot land an older response after a newer one. Companies and instruments
 * lead; a few matching guides follow under their own heading, so searching
 * "free cash flow" finds the explanation rather than a company called Free.
 *
 * `hero` is the 44px variant with a submit beside it; `chrome` is the 34px
 * header one. The submit is deliberately wired to the same `submit` the
 * keyboard uses rather than being a separate code path — a button that
 * navigated differently from Enter would be a bug waiting to happen.
 *
 * The header box answers "/" and Ctrl or Cmd+K, like most research tools. The
 * slash is ignored while somebody is typing in another field, so it never
 * swallows a character meant for a form.
 */
export function SearchBox({
  className,
  autoFocus,
  variant = "chrome",
  submitLabel,
  shortcut = variant === "chrome",
}: {
  className?: string;
  autoFocus?: boolean;
  variant?: "chrome" | "hero";
  submitLabel?: string;
  /** Focus this box on "/" and Ctrl/Cmd+K. Only one box on a page should. */
  shortcut?: boolean;
}) {
  const router = useRouter();
  const listId = useId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const items: Item[] = [
    ...results.map((result) => ({ type: "symbol" as const, result })),
    ...topics.map((topic) => ({ type: "topic" as const, topic })),
  ];

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      // Cleared asynchronously so the update is not applied synchronously
      // within the effect body.
      const reset = setTimeout(() => {
        setResults([]);
        setTopics([]);
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
        setTopics(json.topics ?? []);
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

  useEffect(() => {
    if (!shortcut) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target != null &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const slash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
      const commandK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";

      if ((slash && !typing) || commandK) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcut]);

  function reset() {
    setOpen(false);
    setQuery("");
  }

  function go(symbol: string) {
    reset();
    router.push(`/stock/${encodeURIComponent(symbol)}`);
  }

  function choose(item: Item) {
    if (item.type === "symbol") {
      go(item.result.symbol);
    } else {
      reset();
      router.push(item.topic.href);
    }
  }

  /** What Enter does, so the button and the keyboard cannot drift apart. */
  function submit() {
    const pick = items[active];
    if (pick) choose(pick);
    else if (query.trim()) go(query.trim().toUpperCase());
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const hero = variant === "hero";
  const activeId = items[active] ? `${listId}-option-${active}` : undefined;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className={cn("relative", hero && submitLabel && "grid grid-cols-[minmax(0,1fr)_132px] gap-2.5")}>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
          />
          <input
            ref={inputRef}
            type="search"
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-activedescendant={open ? activeId : undefined}
            aria-autocomplete="list"
            aria-label="Search for a company, ticker or topic"
            aria-keyshortcuts={shortcut ? "/ Control+K Meta+K" : undefined}
            autoFocus={autoFocus}
            value={query}
            placeholder={hero ? "Search a company, ticker or topic…" : "Company, ticker or topic"}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className={cn(
              "peer w-full rounded-lg border border-border bg-surface pl-9 outline-none transition-colors placeholder:text-faint focus:border-accent focus:ring-4 focus:ring-accent/10",
              hero ? "h-12 pr-3 text-[0.90625rem] shadow-sm" : "h-[34px] text-[0.84375rem]",
              !hero && (shortcut ? "pr-9" : "pr-3"),
            )}
          />
          {shortcut && !query && (
            <kbd
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-surface-2 px-1.5 font-sans text-[10px] leading-4 text-faint peer-focus:hidden sm:block"
            >
              /
            </kbd>
          )}
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

      {open && query.trim().length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute z-50 mt-2 max-h-96 w-full overflow-auto rounded-xl border border-border bg-surface py-1 shadow-[var(--shadow-lg)]"
        >
          {items.length === 0 && loading && (
            <li className="px-3 py-2 text-sm text-muted">Searching…</li>
          )}

          {/* Distinguish an outage from a query that genuinely matches nothing. */}
          {!loading && problem && (
            <li className="px-3 py-2.5 text-sm">
              <span className="font-medium text-poor">Company search is unavailable</span>
              <span className="mt-0.5 block text-xs text-muted">{problem}</span>
            </li>
          )}

          {!loading && !problem && items.length === 0 && (
            <li className="px-3 py-2.5 text-sm">
              <span className="font-medium">Nothing matched</span>
              <span className="mt-0.5 block text-xs text-muted">
                Try the company name instead of the ticker, or a term such as &ldquo;free cash
                flow&rdquo;.
              </span>
            </li>
          )}

          {results.map((r, i) => (
            <li
              key={`${r.symbol}-${i}`}
              id={`${listId}-option-${i}`}
              role="option"
              aria-selected={i === active}
            >
              <button
                type="button"
                tabIndex={-1}
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

          {topics.length > 0 && (
            <li role="presentation" className="border-t border-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint first:border-t-0">
              Learn
            </li>
          )}
          {topics.map((t, j) => {
            const i = results.length + j;
            return (
              <li key={t.href} id={`${listId}-option-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose({ type: "topic", topic: t })}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                    i === active ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  <BookOpen aria-hidden className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    {t.kind}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
