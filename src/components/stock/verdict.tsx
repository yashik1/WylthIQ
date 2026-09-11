import type { HealthReport, Question } from "@/lib/scoring/health";
import { healthRating } from "@/lib/scoring/ratings";
import type { Rating } from "@/lib/scoring/types";
import { Card, Metric, RatingBadge } from "@/components/ui";
import { MetricGuideBody } from "@/components/metric-guide-body";
import { cn } from "@/lib/utils";

/**
 * The headline verdict.
 *
 * This is the one thing a non-expert came for, so it is given the largest type
 * on the page and sits above everything else. The number is financial health
 * only — valuation is scored separately, because an expensive share price says
 * nothing about whether the business underneath is sound.
 *
 * The three model figures — Piotroski, Altman and Beneish — are not repeated
 * here. They sat in this card and again in the scorecard beneath it; the
 * scorecard is where they belong, with every check and threshold beside them.
 */
export function VerdictCard({
  report,
  companyName,
}: {
  report: HealthReport;
  companyName: string;
}) {
  const score = report.score;
  const tone = healthRating(score);

  return (
    <Card>
      <div className="flex items-center gap-5 p-6">
        <ScoreDial score={score} tone={tone} />
        <div className="min-w-0">
          <p className="eyebrow">Financial health</p>
          <p className="font-display mt-1.5 text-2xl sm:text-[1.75rem]">{report.headline}</p>
          <p className="mt-1.5 text-xs text-muted">
            From {companyName}&apos;s
            {report.fiscalYear ? ` FY${report.fiscalYear} ` : " latest "}
            annual filing · share price scored separately
          </p>
        </div>
      </div>
    </Card>
  );
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
