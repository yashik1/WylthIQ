import type { Change, ChangeReport } from "@/lib/scoring/changes";
import { Card, CardHeader, Explain } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * What moved between the last two annual filings.
 *
 * The page above this describes where the company stands. This says what
 * changed to get it there, which is usually the more interesting half: a 12%
 * margin is a fact, and a 12% margin that was 19% last year is a story.
 *
 * Laid out as a row per measure — last year, this year, the move — because the
 * comparison is the content, and a grid of single figures would make a reader
 * do the subtraction that is the entire point of the panel.
 */
export function WhatChanged({ report }: { report: ChangeReport }) {
  const { changes, steady, fromYear, toYear } = report;

  return (
    <Card>
      <CardHeader
        title={`What changed in FY${toYear}`}
        subtitle={`Measured against FY${fromYear}${report.form ? `, from the ${report.form}` : ""}`}
      />

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
        . Nothing here reads the management commentary, which is where a company
        explains its own numbers.
      </p>
    </Card>
  );
}

function ChangeRow({ change }: { change: Change }) {
  const tone = {
    better: { rail: "bg-good", delta: "text-good", label: "Improved" },
    worse: { rail: "bg-poor", delta: "text-poor", label: "Deteriorated" },
    neutral: { rail: "bg-unknown", delta: "text-muted", label: "Changed" },
  }[change.direction];

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
          <Explain term={change.label}>{change.meaning}</Explain>
        </div>

        <p className={cn("tnum text-sm font-semibold", tone.delta)}>
          <span className="sr-only">{tone.label}: </span>
          {change.delta}
        </p>

        {/*
          The two figures the move was computed from, so the delta above is
          checkable rather than asserted.
        */}
        <p className="tnum col-span-2 text-[0.8125rem] text-muted">
          {change.from}
          <span aria-hidden className="mx-1.5 text-faint">→</span>
          <span className="sr-only"> to </span>
          <span className="font-medium text-foreground">{change.to}</span>
        </p>
      </div>
    </li>
  );
}
