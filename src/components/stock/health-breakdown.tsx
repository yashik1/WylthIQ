import Link from "next/link";
import { Card, CardHeader, RatingBadge } from "@/components/ui";
import { calendarDate } from "@/lib/format";
import type { HealthBreakdown } from "@/lib/scoring/health-breakdown";
import type { HealthHistory } from "@/lib/scoring/health-history";
import { cn } from "@/lib/utils";
import { HealthHistoryChart } from "./health-history-chart";

/**
 * The score taken apart: each area in a word, and what was left out.
 *
 * Sits between the headline score and the scorecard. The scorecard shows
 * every check inside the three academic models; this shows the areas the
 * score itself averages, which is the level a reader asks "why 8.7" at.
 */
export function HealthBreakdownCard({ breakdown }: { breakdown: HealthBreakdown }) {
  const { unavailable } = breakdown;

  return (
    <Card>
      <CardHeader
        title="What the score is made of"
        subtitle={`${breakdown.scoredEvaluated} of ${breakdown.scoredTotal} scored areas had enough reported figures to judge`}
      />
      <dl className="divide-y divide-border">
        {breakdown.areas.map((area) => (
          <div
            key={area.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 px-5 py-2.5 sm:grid-cols-[11rem_9rem_minmax(0,1fr)]"
          >
            <dt className="text-sm font-medium">
              {area.label}
              {!area.scored && <span className="ml-1.5 text-xs font-normal text-faint">context</span>}
            </dt>
            <dd>
              <RatingBadge rating={area.rating} label={area.word} />
            </dd>
            <dd className="col-span-2 text-xs leading-relaxed text-muted sm:col-span-1">{area.summary}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        The score averages profitability, growth, leverage and accounting risk.{" "}
        {unavailable.length === 0
          ? "All four had enough reported figures."
          : `${joinList(unavailable)} ${unavailable.length === 1 ? "had" : "had"} too few reported figures and ${unavailable.length === 1 ? "is" : "are"} left out of the average rather than counted as a weakness, so a company is never marked down for a figure it did not publish.`}{" "}
        Cash generation is shown for context and already feeds profitability. Valuation is scored
        separately, because a share price says nothing about whether the business is sound.
        {breakdown.signalsTotal > 0 &&
          ` ${breakdown.signalsEvaluated} of the ${breakdown.signalsTotal} Piotroski checks could be evaluated.`}{" "}
        <Link href="/learn#health-score" className="text-accent underline underline-offset-2">
          How the score works
        </Link>
      </p>
    </Card>
  );
}

/** The score year by year, each scored from its annual report as first filed. */
export function HealthHistoryCard({ history }: { history: HealthHistory }) {
  const { latest, yearEarlier, change } = history;

  return (
    <Card>
      <CardHeader
        title="Health score over time"
        subtitle="Each year scored only from its annual report as it was first filed"
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:grid-cols-[13rem_minmax(0,1fr)]">
        <dl className="grid grid-cols-3 gap-3 md:grid-cols-1 md:content-start">
          <Figure label={`FY${latest.fiscalYear}`} value={latest.score.toFixed(1)} />
          <Figure
            label={yearEarlier ? `A year earlier, FY${yearEarlier.fiscalYear}` : "A year earlier"}
            value={yearEarlier ? yearEarlier.score.toFixed(1) : "—"}
          />
          <Figure
            label="Change"
            value={change == null ? "—" : `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change).toFixed(1)}`}
            tone={change == null || change === 0 ? undefined : change > 0 ? "up" : "down"}
          />
        </dl>
        <HealthHistoryChart points={history.points.map((p) => ({ year: p.fiscalYear, score: p.score }))} />
      </div>

      <div className="scroll-x border-t border-border">
        <table className="w-full min-w-[32rem] text-xs">
          <caption className="sr-only">Health score by fiscal year</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="px-5 py-2 font-medium">Fiscal year</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Health</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">F-Score</th>
              <th scope="col" className="px-5 py-2 font-medium">Scored from</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {[...history.points].reverse().map((point) => (
              <tr key={point.fiscalYear}>
                <th scope="row" className="px-5 py-1.5 text-left font-medium">FY{point.fiscalYear}</th>
                <td className="tnum px-3 py-1.5 text-right">{point.score.toFixed(1)}</td>
                <td className="tnum px-3 py-1.5 text-right">
                  {point.fScore != null ? `${point.fScore}/${point.fScoreMax}` : "—"}
                </td>
                <td className="px-5 py-1.5 text-muted">
                  {point.sourceFilingUrl ? (
                    <a href={point.sourceFilingUrl} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                      {point.form}, filed {calendarDate(point.asOf) ?? point.asOf}
                    </a>
                  ) : (
                    `${point.form}, filed ${calendarDate(point.asOf) ?? point.asOf}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        A later restatement never reaches back into an earlier year, and every year is scored
        without a share price, so the latest point can differ a little from the headline score,
        which uses today&apos;s price.
      </p>
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("tnum mt-0.5 text-xl font-semibold", tone === "up" && "text-up", tone === "down" && "text-down")}>
        {value}
      </dd>
    </div>
  );
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
