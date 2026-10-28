import { Card, CardHeader, Metric, RatingBadge } from "@/components/ui";
import type { Adherence, Group, TradeStats } from "@/lib/journal/trade-math";
import { money, num, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * What the book says.
 *
 * The headline row is deliberately five figures rather than fifty. A trade
 * journal earns its keep by being read after every session, and a wall of
 * reports is read once — so this shows the handful that change a decision and
 * puts everything else in the breakdowns below.
 */

/** Amounts are the reader's own, in whatever they trade. */
const CCY = "USD";

function signedMoney(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value), CCY)}`;
}

export function StatsHeadline({ stats }: { stats: TradeStats }) {
  if (stats.closed === 0) {
    return (
      <Card className="p-5">
        <p className="eyebrow">Your numbers</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {stats.open > 0 ? (
            <>
              {stats.open === 1 ? "One trade is" : `${stats.open} trades are`} still open, so there is
              nothing closed to average yet. Close a position when you are out — the figures here
              fill in from your own fills, not from anything this site fetches.
            </>
          ) : (
            <>
              Nothing closed yet, so there is nothing to average. Log a trade below and close it when
              you are out — the figures here fill in from your own fills, not from anything this site
              fetches.
            </>
          )}
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Your numbers"
        subtitle={`${stats.closed} closed${stats.open > 0 ? `, ${stats.open} still open` : ""}`}
      />
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-4 p-5">
        <Metric
          label="Net P&L"
          value={signedMoney(stats.netPnl)}
          tone={stats.netPnl > 0 ? "up" : stats.netPnl < 0 ? "down" : "muted"}
          hint="Everything realised, after the fees you entered. Open positions are not counted."
          size="lg"
        />
        <Metric
          label="Win rate"
          value={percent(stats.winRate)}
          hint={`${stats.wins} won, ${stats.losses} lost${stats.breakeven ? `, ${stats.breakeven} flat` : ""}. A high win rate is not the same as making money.`}
        />
        <Metric
          label="Profit factor"
          value={stats.profitFactor == null ? "no losses yet" : num(stats.profitFactor, 2)}
          hint="Everything you made divided by everything you lost. Above 1 means the wins outweigh the losses; below 1 means they do not."
        />
        <Metric
          label="Expectancy"
          value={signedMoney(stats.expectancy)}
          hint="What one more trade is worth on average. The single figure that says whether doing this again is worth it."
        />
        <Metric
          label="Average R"
          value={stats.avgR == null ? "no stops set" : `${stats.avgR >= 0 ? "+" : "−"}${num(Math.abs(stats.avgR), 2)}R`}
          hint="Your result as a multiple of what you risked. Comparable across position sizes in a way that a dollar figure is not."
        />
        <Metric
          label="Max drawdown"
          value={stats.maxDrawdown > 0 ? money(stats.maxDrawdown, CCY) : "—"}
          hint="The deepest fall from a high point in your running total. Not your worst trade — the worst run of them."
        />
      </dl>

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-4 border-t border-border bg-surface-2/40 px-5 py-3.5">
        <Metric label="Average win" value={signedMoney(stats.avgWin)} size="sm"
          hint="The mean of your winning trades." />
        <Metric label="Average loss" value={stats.avgLoss == null ? "—" : `−${money(stats.avgLoss, CCY)}`} size="sm"
          hint="The mean of your losing trades, as a positive amount." />
        <Metric label="Largest win" value={signedMoney(stats.largestWin)} size="sm" />
        <Metric label="Largest loss" value={stats.largestLoss == null ? "—" : `−${money(stats.largestLoss, CCY)}`} size="sm" />
        <Metric
          label="Planned vs realised R"
          value={
            stats.avgPlannedR == null || stats.avgR == null
              ? "—"
              : `${num(stats.avgPlannedR, 1)}R → ${num(stats.avgR, 1)}R`
          }
          size="sm"
          hint="What you were aiming for against what you got. A big gap usually means positions are being cut before the plan plays out."
        />
        <Metric
          label="Current run"
          value={
            stats.streak === 0
              ? "—"
              : stats.streak > 0
                ? `${stats.streak} won in a row`
                : `${Math.abs(stats.streak)} lost in a row`
          }
          size="sm"
          tone={stats.streak > 0 ? "up" : stats.streak < 0 ? "down" : "muted"}
        />
      </dl>
    </Card>
  );
}

/**
 * Did following your own rules pay?
 *
 * The one report here that a spreadsheet of P&L cannot produce, and the reason
 * the trade form asks the question at all. A strategy that makes money when
 * followed and loses money overall is a discipline problem; one that loses
 * money either way is a bad strategy. Those call for opposite responses, and
 * nothing else on the page separates them.
 */
export function AdherencePanel({ adherence }: { adherence: Adherence }) {
  const { followed, broke, unanswered, costPerTrade } = adherence;

  if (followed.closed === 0 && broke.closed === 0) {
    return (
      <Card className="p-5">
        <p className="eyebrow">Discipline</p>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          When you close a trade, say whether you kept to your own rules. Once there
          are a few of each, this compares them — which is the difference between a
          strategy that does not work and one you are not following.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Following your rules, and not"
        subtitle="The same book split by whether you did what you said you would"
      />

      <div className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <Side title="Kept to the rules" stats={followed} good />
        <Side title="Broke them" stats={broke} />
      </div>

      {costPerTrade != null && (
        <p className="border-t border-border px-5 py-3.5 text-sm leading-relaxed text-muted-strong">
          {costPerTrade > 0 ? (
            <>
              Sticking to your rules has been worth{" "}
              <span className="tnum font-semibold text-foreground">
                {money(costPerTrade, CCY)}
              </span>{" "}
              a trade. That is the gap between the two averages above, not a
              projection.
            </>
          ) : (
            <>
              Breaking your rules has done better, by{" "}
              <span className="tnum font-semibold text-foreground">
                {money(Math.abs(costPerTrade), CCY)}
              </span>{" "}
              a trade. Worth reading as a question about the rules rather than a
              licence to ignore them — especially while the counts are small.
            </>
          )}
        </p>
      )}

      {unanswered > 0 && (
        <p className="border-t border-border px-5 py-3 text-xs text-faint">
          {unanswered} closed {unanswered === 1 ? "trade is" : "trades are"} not counted
          on either side, because the question was left unanswered.
        </p>
      )}
    </Card>
  );
}

function Side({ title, stats, good }: { title: string; stats: TradeStats; good?: boolean }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-faint">
          {stats.closed} {stats.closed === 1 ? "trade" : "trades"}
        </span>
      </div>

      {stats.closed === 0 ? (
        <p className="mt-2 text-sm text-muted">
          {good ? "None recorded yet." : "None recorded — which is the good version."}
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,110px),1fr))] gap-3">
          <Metric label="Net P&L" value={signedMoney(stats.netPnl)} size="sm"
            tone={stats.netPnl > 0 ? "up" : stats.netPnl < 0 ? "down" : "muted"} />
          <Metric label="Win rate" value={percent(stats.winRate)} size="sm" />
          <Metric label="Per trade" value={signedMoney(stats.expectancy)} size="sm" />
        </dl>
      )}
    </div>
  );
}

/**
 * Performance by strategy, or by symbol.
 *
 * Sorted by what each actually made rather than alphabetically, because the
 * question being asked is always "which of these should I do more of".
 */
export function Breakdown({
  title,
  subtitle,
  groups,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  groups: Group[];
  emptyLabel: string;
}) {
  if (groups.length === 0) {
    return (
      <Card className="p-5">
        <p className="eyebrow">{title}</p>
        <p className="mt-2 text-sm text-muted">{emptyLabel}</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="scroll-x">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
              <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Trades</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Win rate</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Profit factor</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Net P&L</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groups.map((g) => (
              <tr key={g.key} className="transition-colors hover:bg-surface-2">
                <td className="px-5 py-3 font-medium">{g.label}</td>
                <td className="tnum px-3 py-3 text-right">
                  {g.stats.closed}
                  {g.stats.open > 0 && (
                    <span className="text-faint"> +{g.stats.open} open</span>
                  )}
                </td>
                <td className="tnum px-3 py-3 text-right">{percent(g.stats.winRate)}</td>
                <td className="tnum px-3 py-3 text-right">
                  {g.stats.profitFactor == null ? "—" : num(g.stats.profitFactor, 2)}
                </td>
                <td
                  className={cn(
                    "tnum px-3 py-3 text-right font-medium",
                    g.stats.netPnl > 0 ? "text-up" : g.stats.netPnl < 0 ? "text-down" : "",
                  )}
                >
                  {signedMoney(g.stats.netPnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/**
 * The running total, drawn as an inline SVG.
 *
 * No charting library: this is one line over at most a few hundred points,
 * and the page already carries enough JavaScript. Drawn from the same ordered
 * series the drawdown figure is computed from, so the picture and the number
 * beneath it cannot disagree.
 */
export function EquityCurve({ points }: { points: { date: string; value: number }[] }) {
  if (points.length < 2) return null;

  const w = 720;
  const h = 160;
  const pad = 4;
  const values = points.map((p) => p.value);
  // Zero is always in frame: a curve that never shows the break-even line
  // makes a losing book look like a rising one that started lower.
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;

  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (h - pad * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = values[values.length - 1];
  const up = last >= 0;

  return (
    <Card>
      <CardHeader
        title="Running total"
        subtitle="Cumulative realised P&L, in the order your trades closed"
      />
      <div className="p-5">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-40 w-full"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Cumulative profit and loss across ${points.length} closed trades, ending at ${signedMoney(last)}`}
        >
          <line
            x1={pad} x2={w - pad} y1={y(0)} y2={y(0)}
            stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="3 3"
          />
          <path d={area} fill={up ? "var(--up)" : "var(--down)"} opacity="0.12" />
          <path d={line} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2"
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <p className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-faint">
          <span>{points[0].date}</span>
          <span className="tnum">
            The dashed line is break-even. Ends at {signedMoney(last)}.
          </span>
          <span>{points[points.length - 1].date}</span>
        </p>
      </div>
    </Card>
  );
}

/** A win/loss pill for a single trade row. */
export function ResultBadge({ pnl }: { pnl: number | null }) {
  if (pnl == null) return <RatingBadge rating="unknown" label="Open" />;
  if (pnl > 0) return <RatingBadge rating="good" label="Win" />;
  if (pnl < 0) return <RatingBadge rating="poor" label="Loss" />;
  return <RatingBadge rating="fair" label="Flat" />;
}
