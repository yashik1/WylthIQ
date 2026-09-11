import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card, SectionHeading } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { price as fmtPrice, signedPercent } from "@/lib/format";
import type { MarketSnapshot, Mover, SectorPerformance } from "@/lib/market";

/**
 * Today's movers and sector performance.
 *
 * Both read stored quotes rather than calling a price API per company, so the
 * dashboard stays instant. That makes the data as fresh as the last refresh
 * rather than live, which the timestamp states outright instead of implying
 * real time.
 */
/**
 * How old a quote can be before "how things moved" stops being true.
 *
 * Three days rather than one, so a Monday morning reading Friday's close is
 * not flagged as broken — that is the normal state over a weekend.
 */
const STALE_AFTER_DAYS = 3;

export function MarketOverview({ snapshot }: { snapshot: MarketSnapshot }) {
  const { gainers, losers, sectors, asOf, covered, ageDays } = snapshot;

  /*
    Says so when the numbers are old, rather than leaving the timestamp to
    carry it alone.

    These lists were stuck on the same five risers for eleven days because
    nothing was scheduled to refresh the stored quotes, and the only signal
    was a date in the sub-heading that reads as decoration. A heading that
    says "biggest risers" is a claim about today; when it is not, the page
    should say which day it is a claim about.

    The age arrives on the snapshot rather than being read from the clock
    here — see MarketSnapshot for why.
  */
  const stale = ageDays != null && ageDays >= STALE_AFTER_DAYS;

  return (
    <section aria-labelledby="market-heading">
      <SectionHeading
        eyebrow="Market"
        title="How things moved"
        description={
          // Formatted in the browser: this component renders on the server,
          // whose clock is UTC, so a reader elsewhere saw a shifted time.
          asOf ? (
            <>
              Across {covered} companies, as of{" "}
              <LocalTime value={asOf} mode="datetime" showZone />.
            </>
          ) : (
            `Across ${covered} companies.`
          )
        }
      />

      {stale && (
        <p className="mb-4 border border-fair px-3.5 py-2.5 text-sm leading-relaxed text-muted-strong">
          These prices are {Math.floor(ageDays!)} days old, so this is how things moved on
          that day rather than today. The scheduled refresh has not run since then.
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5">
        <MoverList
          id="market-heading"
          title="Biggest risers"
          tone="up"
          movers={gainers}
          empty="No gainers in the latest refresh."
        />
        <MoverList
          title="Biggest fallers"
          tone="down"
          movers={losers}
          empty="Nothing fell in the latest refresh."
        />
        <SectorHeatmap sectors={sectors} />
      </div>
    </section>
  );
}

function MoverList({
  id,
  title,
  tone,
  movers,
  empty,
}: {
  id?: string;
  title: string;
  tone: "up" | "down";
  movers: Mover[];
  empty: string;
}) {
  const Icon = tone === "up" ? TrendingUp : TrendingDown;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon aria-hidden className={tone === "up" ? "size-4 text-up" : "size-4 text-down"} />
        <h3 id={id} className="font-display text-base font-semibold">
          {title}
        </h3>
      </div>

      {movers.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border">
          {movers.map((m) => (
            <li key={m.symbol}>
              <Link
                href={`/stock/${encodeURIComponent(m.symbol)}`}
                className="flex items-center justify-between gap-3 px-4 py-[9px] transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)]"
              >
                <div className="min-w-0">
                  <p className="text-[0.84375rem] font-bold tracking-[0.02em]">{m.symbol}</p>
                  <p className="max-w-[11rem] truncate text-[0.71875rem] text-faint">{m.name}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`tnum text-[0.84375rem] font-bold ${
                      (m.changePercent ?? 0) >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {signedPercent(m.changePercent)}
                  </p>
                  <p className="tnum text-[0.71875rem] text-faint">{fmtPrice(m.price)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Sector performance as a diverging bar.
 *
 * A grid of coloured tiles is the conventional "heatmap", but colour alone
 * encodes the value there and small differences become unreadable. A bar
 * anchored at zero encodes magnitude by length as well as direction by colour,
 * and the number is printed beside it, so nothing depends on hue.
 */
function SectorHeatmap({ sectors }: { sectors: SectorPerformance[] }) {
  const widest = Math.max(0.0001, ...sectors.map((s) => Math.abs(s.averageChange)));

  return (
    <Card>
      <div className="border-b border-border px-4 py-3">
        <h3 className="font-display text-base font-semibold">By sector</h3>
        <p className="mt-0.5 text-[0.71875rem] text-faint">Average move, anchored at zero</p>
      </div>

      {sectors.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">
          Not enough companies with prices yet to compare sectors.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sectors.map((s) => {
            const positive = s.averageChange >= 0;
            const width = (Math.abs(s.averageChange) / widest) * 50;

            return (
              /*
                The whole row is the link, not just the name.

                A sector row states a fact and then offered nothing to do with
                it — the obvious next question is "which companies", and the
                screener can already answer it now that it filters on the same
                familiar sector names this heatmap groups by.
              */
              <li key={s.sector}>
                <Link
                  href={`/screen?sector=${encodeURIComponent(s.sector)}&sort=market-cap`}
                  className="block px-4 py-2 transition-colors hover:bg-surface-2"
                  aria-label={`See the ${s.companyCount} companies in ${s.sector}`}
                >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[0.78125rem]">{s.sector}</span>
                  <span
                    className={`tnum shrink-0 text-[0.78125rem] font-bold ${
                      positive ? "text-up" : "text-down"
                    }`}
                  >
                    {signedPercent(s.averageChange)}
                  </span>
                </div>

                {/* Bars grow outward from a shared centre line, so direction is
                    readable without relying on colour. */}
                <div
                  className="relative mt-1.5 h-1.5 w-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]"
                  aria-hidden
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-1/2 w-px bg-border-strong"
                  />
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 ${positive ? "bg-up" : "bg-down"}`}
                    style={
                      positive
                        ? { left: "50%", width: `${width}%` }
                        : { right: "50%", width: `${width}%` }
                    }
                  />
                </div>

                <p className="mt-1 text-[11px] text-faint">
                  {s.companyCount} companies
                  {s.leader && ` · largest ${s.leader}`}
                </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Shown when quotes have never been refreshed. */
export function MarketSetupHint() {
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold">Movers and sectors need price data</h3>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
        These read stored quotes rather than calling a price API for every company on
        each page view, which no free plan would sustain. Load them once with the
        command below, then schedule it as often as you like.
      </p>
      <pre className="scroll-x mt-3 border border-border bg-surface-2 px-3 py-2 text-xs">
        <code>npm run quotes</code>
      </pre>
      <p className="mt-2 text-xs text-muted">
        Needs a free Finnhub or Twelve Data key. Everything else on this page works
        without one.
      </p>
    </Card>
  );
}
