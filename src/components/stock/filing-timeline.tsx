import { ExternalLink } from "lucide-react";
import { Badge, Card, CardHeader } from "@/components/ui";
import { calendarDate } from "@/lib/format";
import type { TimelineEvent, TimelineYear } from "@/lib/filings/timeline";
import { cn } from "@/lib/utils";

const TONE: Record<TimelineEvent["severity"], "neutral" | "fair" | "poor"> = {
  routine: "neutral",
  notable: "fair",
  "red-flag": "poor",
};

const DOT: Record<TimelineEvent["severity"], string> = {
  routine: "bg-border-strong",
  notable: "bg-fair",
  "red-flag": "bg-poor",
};

/**
 * What the company has filed, in order.
 *
 * Beside the filings table rather than instead of it: the table answers
 * "which documents exist", this answers "what happened, and when". Every
 * event links to its filing, and its label comes only from the form and the
 * 8-K item numbers — see lib/filings/timeline.ts for what is deliberately
 * never inferred.
 */
export function FilingTimeline({ years }: { years: TimelineYear[] }) {
  const count = years.reduce((n, year) => n + year.events.length, 0);

  return (
    <Card>
      <CardHeader
        title="Filing timeline"
        subtitle={`${count} recent ${count === 1 ? "filing" : "filings"}, newest first. Each is labelled from its form and item numbers, not from its wording.`}
      />
      <div className="space-y-6 px-5 py-4">
        {years.map((year) => (
          <section key={year.year} aria-labelledby={`timeline-${year.year}`}>
            <h3 id={`timeline-${year.year}`} className="eyebrow text-[0.6875rem]">
              {year.year}
            </h3>
            <ol className="mt-2 border-l border-border">
              {year.events.map((event, i) => (
                <li key={`${event.form}-${event.date}-${i}`} className="relative pb-4 pl-5 last:pb-0">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-2 ring-surface",
                      DOT[event.severity],
                    )}
                  />
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <time dateTime={event.date} className="tnum text-xs text-muted">
                      {calendarDate(event.date) ?? event.date}
                    </time>
                    <Badge tone={TONE[event.severity]}>{event.label}</Badge>
                    <span className="text-xs text-faint">{event.form}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium leading-snug">{event.title}</p>
                  {event.highlights.length > 0 && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-strong">
                      {event.highlights.join(" · ")}
                      {event.comparedWith && (
                        <span className="text-faint"> — against {event.comparedWith}</span>
                      )}
                    </p>
                  )}
                  <a
                    href={event.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    Read the filing
                    <ExternalLink aria-hidden className="size-3" />
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </Card>
  );
}
