import type { HealthReport, Question } from "@/lib/scoring/health";
import type { Rating } from "@/lib/scoring/types";
import { Card, MeterBar, Metric, RatingBadge } from "@/components/ui";
import { MetricGuideBody } from "@/components/metric-guide-body";
import { cn } from "@/lib/utils";

/** Where a score sits on the rating scale. */
function scoreTone(score: number): Rating {
  if (score >= 7.5) return "good";
  if (score >= 5) return "fair";
  return "poor";
}

/**
 * The headline verdict.
 *
 * This is the one thing a non-expert came for, so it is given the largest type
 * on the page and sits above everything else. The number is financial health
 * only — valuation is scored separately, because an expensive share price says
 * nothing about whether the business underneath is sound.
 */
export function VerdictCard({
  report,
  companyName,
}: {
  report: HealthReport;
  companyName: string;
}) {
  /*
    Market value deliberately takes no reporting currency. It is the traded
    price multiplied by the share count, so it is denominated in whatever the
    shares change hands in — SK hynix files in won but its US listing trades in
    dollars, and labelling that figure ₩ would be a new error in place of the
    old one.
  */
  const score = report.score;
  const tone = score == null ? "unknown" : scoreTone(score);

  return (
    <Card>
      <div>
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center">
          {/* Hero score */}
          <div className="flex items-center gap-5">
            <ScoreDial score={score} tone={tone} />
            <div className="min-w-0">
              <p className="eyebrow">Financial health</p>
              <p className="font-display mt-1.5 text-2xl sm:text-[1.75rem]">
                {report.headline}
              </p>
              <p className="mt-1.5 text-xs text-muted">
                From {companyName}&apos;s
                {report.fiscalYear ? ` FY${report.fiscalYear} ` : " latest "}
                annual filing · share price scored separately
              </p>
            </div>
          </div>

          {/* Model scores */}
          <dl className="grid grid-cols-3 gap-4 border-t border-border pt-4 lg:w-auto lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <Metric
              label="Piotroski"
              value={
                report.piotroski.maxScore
                  ? `${report.piotroski.score}/${report.piotroski.maxScore}`
                  : "—"
              }
              hint={
                <MetricGuideBody
                  id="piotroski"
                  note="Nine yes-or-no checks of whether the finances improved this year. More is better."
                />
              }
            />
            <Metric
              label={
                report.altman.value?.variant === "manufacturing-book"
                  ? "Altman Z′"
                  : "Altman Z"
              }
              value={report.altman.value ? report.altman.value.z.toFixed(2) : "n/a"}
              hint={
                report.altman.value ? (
                  <MetricGuideBody id="altman" note={altmanHint(report.altman.value.variant)} />
                ) : (
                  report.altman.reason
                )
              }
            />
            <Metric
              label="Beneish M"
              value={report.beneish.value ? report.beneish.value.m.toFixed(2) : "n/a"}
              hint={
                report.beneish.value ? (
                  <MetricGuideBody id="beneish" note="Screens for unusual accounting. Below −1.78 is normal." />
                ) : (
                  report.beneish.reason
                )
              }
            />
          </dl>
        </div>
      </div>
    </Card>
  );
}

/**
 * Which Altman model produced the number, and why it matters.
 *
 * The book-value variant reads very differently for companies that have bought
 * back a lot of stock — buybacks shrink book equity, dragging the score down
 * without the business having changed. Naming the model stops that looking like
 * an error.
 */
function altmanHint(
  variant: "manufacturing" | "manufacturing-book" | "non-manufacturing",
): string {
  switch (variant) {
    case "manufacturing":
      return "Distance from bankruptcy risk, using market value. Above 2.99 is the safe zone.";
    case "manufacturing-book":
      return (
        "Distance from bankruptcy risk. No share price is available, so this uses Altman's " +
        "book-value model (Z′), where above 2.9 is the safe zone. Companies that have bought " +
        "back a lot of shares score lower on this variant."
      );
    case "non-manufacturing":
      return "Distance from bankruptcy risk, using the model for non-manufacturers. Above 2.6 is safe.";
  }
}

function ScoreDial({ score, tone }: { score: number | null; tone: Rating }) {
  const pct = score == null ? 0 : Math.max(0, Math.min(score, 10)) / 10;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  const strokes: Record<Rating, string> = {
    good: "var(--good)",
    fair: "var(--fair)",
    poor: "var(--poor)",
    unknown: "var(--unknown)",
  };

  return (
    <div className="relative size-24 shrink-0 sm:size-28">
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={strokes[tone]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="display text-3xl font-bold leading-none sm:text-4xl">
          {score == null ? "—" : score.toFixed(1)}
        </span>
        <span className="mt-0.5 text-[10px] font-medium text-faint">OUT OF 10</span>
      </div>
    </div>
  );
}

/**
 * One of the five plain-English questions.
 *
 * The answer leads and the figures sit beneath it, each with a meter so a
 * reader can judge the shape before reading a single number. A figure the
 * shared metric guide covers opens that guide, led by the question's own
 * plain-language hint.
 */
export function QuestionCard({ question }: { question: Question }) {
  const accentBar: Record<Rating, string> = {
    good: "bg-good",
    fair: "bg-fair",
    poor: "bg-poor",
    unknown: "bg-unknown",
  };

  return (
    <Card className="flex flex-col overflow-hidden" interactive>
      {/* A colour rail keeps the rating readable while scrolling past. */}
      <div className="flex">
        <span aria-hidden className={cn("w-1 shrink-0", accentBar[question.rating])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3 px-5 pt-4">
            <h3 className="text-[0.9375rem] font-semibold tracking-tight">
              {question.question}
            </h3>
            <RatingBadge rating={question.rating} />
          </div>

          <p className="px-5 pb-4 pt-2 text-[0.9375rem] leading-relaxed text-muted-strong">
            {question.answer}
          </p>
        </div>
      </div>

      <dl className="mt-auto grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-border bg-surface-2/40 px-5 py-3.5 sm:grid-cols-3">
        {question.metrics.map((m) => (
          <Metric
            key={m.label}
            label={m.label}
            value={m.value}
            hint={m.guide ? <MetricGuideBody id={m.guide} note={m.hint} /> : m.hint}
            size="sm"
          />
        ))}
      </dl>
    </Card>
  );
}

/** Compact summary of all five questions, for scanning before reading. */
export function QuestionSummary({ questions }: { questions: Question[] }) {
  const points: Record<Rating, number | null> = {
    good: 1,
    fair: 0.6,
    poor: 0.2,
    unknown: null,
  };

  return (
    <Card className="p-5">
      <p className="eyebrow mb-3">At a glance</p>
      <ul className="space-y-3">
        {questions.map((q) => (
          <li key={q.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
            <span className="truncate text-sm font-medium">{q.question}</span>
            <RatingBadge rating={q.rating} />
            <div className="col-span-2">
              <MeterBar
                value={points[q.rating]}
                rating={q.rating}
                label={`${q.question} rated ${q.rating}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
