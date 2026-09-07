import type { HealthReport } from "@/lib/scoring/health";
import type { AltmanResult, Rating, Signal } from "@/lib/scoring/types";
import { ALTMAN_ZONES } from "@/lib/scoring/altman";
import { MANIPULATION_THRESHOLD } from "@/lib/scoring/beneish";
import { Card, CardHeader, Explain, NotReported, RatingBadge } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * How the headline score was reached.
 *
 * The three academic models were already computed on every page load and shown
 * as three bare figures — "7/9", "3.42", "−2.61" — with a one-line hint. The
 * nine Piotroski components, each of which arrives with a plain-English
 * sentence describing exactly what it tests, were computed on every request and
 * read by nothing: `PiotroskiResult.signals` had no consumer outside its own
 * unit test. This is the same shape of waste `key-figures.ts` describes for
 * `capex` — a value carried the whole way through the pipeline and dropped at
 * the last step.
 *
 * Showing them is the difference between "trust this number" and "here is the
 * number and here is every check behind it". A reader who disagrees with one
 * component can see which one it is, and every figure traces back to the single
 * filing named at the foot of the card.
 *
 * Nothing here computes anything new. It renders what the scoring engine
 * already returns.
 */
export function Scorecard({ report }: { report: HealthReport }) {
  const { piotroski, altman, beneish } = report;

  // Nothing to be transparent about if no model produced a figure. An empty
  // card would imply the models were run and returned nothing meaningful,
  // which is a different claim from their inputs never being reported.
  const anything =
    piotroski.maxScore > 0 || altman.value != null || beneish.value != null;
  if (!anything) return null;

  // How many of the nine had no figures to work with. Worth naming, because a
  // company scored out of 8 has not failed a ninth check — it never published
  // what that check needs — and a reader comparing two companies deserves to
  // know which of the two situations they are looking at.
  const unevaluated = piotroski.signals.length - piotroski.maxScore;

  return (
    <Card>
      <CardHeader
        title="How this score was reached"
        subtitle="Every check behind the three models, and what each one tests"
      />

      {piotroski.maxScore > 0 && (
        <section className="border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-[0.9375rem] font-semibold tracking-tight">
              Piotroski F-Score
            </h3>
            <p className="tnum text-sm text-muted">
              <span className="font-semibold text-foreground">
                {piotroski.score}
              </span>{" "}
              of {piotroski.maxScore} checks passed
            </p>
          </div>

          <p className="mt-1 text-xs leading-relaxed text-muted">
            Nine yes-or-no tests of whether this year&apos;s finances improved on
            last year&apos;s.
            {unevaluated > 0 &&
              (unevaluated === 1
                ? " One could not be evaluated and is excluded from the total rather than counted as a failure."
                : ` ${unevaluated} could not be evaluated and are excluded from the total rather than counted as failures.`)}
          </p>

          <ul className="mt-3.5 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,270px),1fr))] gap-x-6 gap-y-2">
            {piotroski.signals.map((signal) => (
              <SignalRow key={signal.key} signal={signal} />
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] divide-border max-sm:divide-y sm:divide-x">
        <ModelBlock
          title={altman.value?.variant === "manufacturing-book" ? "Altman Z′" : "Altman Z"}
          figure={altman.value ? altman.value.z.toFixed(2) : null}
          rating={altman.value?.rating}
          reason={altman.reason}
          scale={altman.value ? altmanScale(altman.value) : null}
          explanation={
            "Distance from bankruptcy, from a model fitted on companies that did and did not go " +
            "bust. It describes a balance sheet's shape today; it does not forecast a failure."
          }
        />
        <ModelBlock
          title="Beneish M"
          figure={beneish.value ? beneish.value.m.toFixed(2) : null}
          rating={beneish.value?.rating}
          reason={beneish.reason}
          scale={
            beneish.value
              ? {
                  verdict: beneish.value.flagged
                    ? "Above the threshold — worth a closer look"
                    : "Below the threshold — nothing unusual flagged",
                  detail: `Scores above ${MANIPULATION_THRESHOLD} are the ones the model associates with earnings manipulation.`,
                }
              : null
          }
          explanation={
            "Screens eight accounting ratios for the pattern earnings manipulators tend to leave. " +
            "A flag is a reason to read the filing closely, never evidence of wrongdoing."
          }
        />
      </div>

      {report.sourceFilingUrl && (
        <p className="border-t border-border px-5 py-3 text-xs text-muted">
          Every figure above comes from{" "}
          <a
            href={report.sourceFilingUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            {report.fiscalYear ? `the FY${report.fiscalYear} filing` : "the latest filing"}
          </a>
          {" "}as filed with the SEC.
        </p>
      )}
    </Card>
  );
}

/**
 * One of the nine checks.
 *
 * Three states, not two. A check that could not be evaluated is drawn in the
 * muted "not reported" treatment rather than as a failure, because the
 * difference between "this company did badly" and "this company did not
 * publish the figure" is the whole reason the scoring engine tracks them
 * separately.
 */
function SignalRow({ signal }: { signal: Signal }) {
  const state = signal.passed === null ? "unknown" : signal.passed ? "pass" : "fail";

  const marks = {
    pass: { glyph: "✓", className: "text-good", label: "Passed" },
    fail: { glyph: "✗", className: "text-poor", label: "Not passed" },
    unknown: { glyph: "–", className: "text-faint", label: "Not reported" },
  } as const;
  const mark = marks[state];

  return (
    <li className="flex items-start gap-2 text-[0.8125rem] leading-snug">
      <span
        aria-hidden
        className={cn("mt-px w-3 shrink-0 text-center font-semibold", mark.className)}
      >
        {mark.glyph}
      </span>
      <span className="sr-only">{mark.label}: </span>
      <span className={cn("min-w-0", state === "unknown" && "text-faint")}>
        {signal.label}
        {state === "unknown" ? (
          <span className="ml-1 text-xs text-faint">(not reported)</span>
        ) : null}
        <Explain term={signal.label}>{signal.detail}</Explain>
      </span>
    </li>
  );
}

/** Where a Z-score sits against the thresholds of the model that produced it. */
function altmanScale(value: AltmanResult): { verdict: string; detail: string } {
  const { safeAbove, distressBelow } = ALTMAN_ZONES[value.variant];
  const verdicts = {
    safe: "In the safe zone",
    grey: "In the grey zone",
    distress: "In the distress zone",
  } as const;

  return {
    verdict: verdicts[value.zone],
    detail:
      `For this model, above ${safeAbove} is safe and below ${distressBelow} is distress.` +
      (value.variant === "manufacturing-book"
        ? " No share price was available, so this is Altman's book-value revision — companies that have bought back a lot of stock score lower on it."
        : ""),
  };
}

/** One academic model: its figure, where that figure sits, and what it means. */
function ModelBlock({
  title,
  figure,
  rating,
  reason,
  scale,
  explanation,
}: {
  title: string;
  figure: string | null;
  rating?: Rating;
  reason?: string;
  scale: { verdict: string; detail: string } | null;
  explanation: string;
}) {
  return (
    <section className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-[0.9375rem] font-semibold tracking-tight">{title}</h3>
        {rating && <RatingBadge rating={rating} />}
      </div>

      <p className="tnum font-display mt-1.5 text-[1.625rem] leading-none">
        {figure ?? <NotReported reason={reason} />}
      </p>

      {scale ? (
        <>
          <p className="mt-2 text-[0.8125rem] font-medium">{scale.verdict}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{scale.detail}</p>
        </>
      ) : (
        reason && <p className="mt-2 text-xs leading-relaxed text-muted">{reason}</p>
      )}

      <p className="mt-2 text-xs leading-relaxed text-faint">{explanation}</p>
    </section>
  );
}
