import type { Change, ChangeReport, QuarterComparison } from "@/lib/scoring/changes";
import { SEVERITY_LABEL } from "@/lib/scoring/change-thresholds";
import { guideForChange } from "@/lib/learn/metric-guide";
import { calendarDate } from "@/lib/format";
import { Card, CardHeader, Explain } from "@/components/ui";
import { MetricGuideBody } from "@/components/metric-guide-body";
import { cn } from "@/lib/utils";

/**
 * What moved between reported periods.
 *
 * The page above this describes where the company stands. This says what
 * changed to get it there, which is usually the more interesting half: a 12%
 * margin is a fact, and a 12% margin that was 19% last year is a story.
 *
 * Laid out as a row per measure — the earlier figure, the latest, the move —
 * because the comparison is the content, and a grid of single figures would
 * make a reader do the subtraction that is the entire point of the panel.
 * The latest year leads; the latest quarter follows when the company files
 * quarters and one has been reported since the annual report.
 */
export function WhatChanged({ report }: { report: ChangeReport }) {
  const { changes, steady, fromYear, toYear } = report;
  const filed = calendarDate(report.filedAt);
  const hasQuarters = report.quarterly.length > 0;

  return (
    <Card>
      <CardHeader
        title={`What changed in FY${toYear}`}
        subtitle={`Measured against FY${fromYear}${report.form ? `, from the ${report.form}` : ""}${filed ? ` filed ${filed}` : ""}`}
      />

      {hasQuarters && (
        <h3 className="px-5 pt-4 text-sm font-semibold">Latest fiscal year, against the one before</h3>
      )}

      {changes.length === 0 ? (
        /*
          A real answer, not an empty state.

          "Nothing moved much" is a finding about a company — a steady year is
          genuinely different from a volatile one — so it says that rather than
          rendering a blank panel that reads as a page that failed to load.
        */
        <p className="px-5 py-4 text-sm leading-relaxed text-muted">
          Nothing moved far enough to be worth calling out. All{" "}
          {steady} measure{steady === 1 ? "" : "s"} compared landed close to
          where they were in FY{fromYear}.
        </p>
      ) : (
        <ul className="list-none divide-y divide-border">
          {changes.map((change) => (
            <ChangeRow key={change.key} change={change} />
          ))}
        </ul>
      )}

      {report.quarterly.map((comparison) => (
        <QuarterBlock key={comparison.kind} comparison={comparison} />
      ))}

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        {changes.length > 0 && steady > 0 && (
          <>
            {steady} other measure{steady === 1 ? "" : "s"} barely moved.{" "}
          </>
        )}
        Figures compare the two most recent annual filings
        {report.sourceFilingUrl && (
          <>
            {" — "}
            <a
              href={report.sourceFilingUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent hover:underline"
            >
              read the latest one
            </a>
          </>
        )}
        . Moves are graded on fixed lines — 5%, 15% and 40% for amounts, and 1, 3
        and 8 points for margins — as notable, significant or critical. Nothing
        here reads the management commentary, which is where a company explains
        its own numbers.
      </p>
    </Card>
  );
}

/**
 * One quarterly comparison.
 *
 * Its own labelled block rather than more rows in the list above, because a
 * quarter against a quarter and a year against a year are different
 * comparisons, and a reader scanning the rows must never mistake one for the
 * other.
 */
function QuarterBlock({ comparison }: { comparison: QuarterComparison }) {
  const filed = calendarDate(comparison.filedAt);
  const yearOverYear = comparison.kind === "year-over-year";

  return (
    <section className="border-t border-border" aria-label={`${comparison.toLabel} against ${comparison.fromLabel}`}>
      <div className="px-5 pt-4 pb-1">
        <h3 className="text-sm font-semibold">
          {yearOverYear
            ? "Latest quarter, against the same quarter a year earlier"
            : "Latest quarter, against the quarter before"}
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {comparison.toLabel} against {comparison.fromLabel}
          {comparison.form ? `, from the ${comparison.form}` : ""}
          {filed ? ` filed ${filed}` : ""}
          {comparison.sourceFilingUrl && (
            <>
              {" — "}
              <a
                href={comparison.sourceFilingUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                read it
              </a>
            </>
          )}
          .
          {/* The one thing a sequential comparison gets wrong by nature. */}
          {!yearOverYear &&
            " Quarter-to-quarter moves include seasonal swings — a retailer's holiday quarter — which the year-earlier comparison removes."}
        </p>
      </div>

      {comparison.changes.length === 0 ? (
        <p className="px-5 pb-4 pt-1 text-sm leading-relaxed text-muted">
          Nothing moved far enough to be worth calling out between these quarters.
        </p>
      ) : (
        <ul className="list-none divide-y divide-border">
          {comparison.changes.map((change) => (
            <ChangeRow key={change.key} change={change} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ChangeRow({ change }: { change: Change }) {
  const tone = {
    better: { rail: "bg-good", delta: "text-good", label: "Improved" },
    worse: { rail: "bg-poor", delta: "text-poor", label: "Deteriorated" },
    neutral: { rail: "bg-unknown", delta: "text-muted", label: "Changed" },
  }[change.direction];

  const guide = guideForChange(change.key);

  return (
    <li className="flex">
      {/* The same colour rail the question cards use, so a direction reads the
          same way in both places. */}
      <span aria-hidden className={cn("w-1 shrink-0", tone.rail)} />

      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-5 py-3.5">
        {/* A div rather than a p, and that is load-bearing: <details> is flow
            content and a paragraph accepts only phrasing, so the browser closes
            the <p> early and the DOM stops matching what the server rendered —
            a hydration failure rather than a styling quibble. */}
        <div className="text-[0.9375rem] font-semibold tracking-tight">
          {change.label}
          {guide && (
            <Explain term={change.label}>
              <MetricGuideBody id={guide} />
            </Explain>
          )}
        </div>

        <p className={cn("tnum text-sm font-semibold", tone.delta)}>
          <span className="sr-only">{tone.label}: </span>
          {change.delta}
        </p>

        {/*
          The two figures the move was computed from, so the delta above is
          checkable rather than asserted, and its grade in words — never in
          colour alone.
        */}
        <p className="tnum col-span-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[0.8125rem] text-muted">
          <span>
            {change.from}
            <span aria-hidden className="mx-1.5 text-faint">→</span>
            <span className="sr-only"> to </span>
            <span className="font-medium text-foreground">{change.to}</span>
          </span>
          <span
            className={cn(
              "rounded border border-border px-1.5 text-[0.6875rem] tracking-wide",
              change.severity === "critical" && "font-semibold text-foreground",
            )}
          >
            {SEVERITY_LABEL[change.severity]}
          </span>
        </p>

        <p className="col-span-2 text-[0.8125rem] leading-relaxed text-muted">
          <span className="font-medium text-muted-strong">Why it matters: </span>
          {change.meaning}
        </p>
      </div>
    </li>
  );
}
