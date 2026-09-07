import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, SectionHeading } from "@/components/ui";
import { getProvider, getBarsWithSource } from "@/lib/providers";
import { price, signedPercent } from "@/lib/format";
import {
  ASSET_CLASS_LABEL,
  COMMODITIES,
  CRYPTO,
  FUTURES,
  findInstrument,
  groupByCategory,
  type Instrument,
} from "@/lib/instruments";

/**
 * Prices move, but not so fast that a directory needs to be dynamic. Five
 * minutes keeps the headline tiles current while collapsing every visitor in
 * that window onto one set of provider calls — which matters on a free tier
 * that allows eight requests a minute in total.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Markets",
  description:
    "Bitcoin, gold, oil, wheat and the index futures — price history and backtesting for " +
    "the markets that file no accounts.",
  alternates: { canonical: "/markets" },
};

/**
 * The handful shown as full tiles, with a price and a trace.
 *
 * Deliberately not all fifty-nine. Each tile costs a quote and a bar series,
 * the free tier allows eight requests a minute, and a page that fired a
 * hundred and twenty would rate-limit itself into showing nothing at all — a
 * wall of dashes is worse than a directory that does not pretend. Everything
 * else carries its price on its own page, one request at a time.
 */
const HEADLINE = ["BTC-USD", "ETH-USD", "GC=F", "SI=F", "CL=F", "ES=F"];

/** How many daily closes the trace is drawn from. */
const SPARK_DAYS = 30;

/**
 * A trace, not a chart.
 *
 * No axes, no grid, no labels — it says "which way, and how steadily", and the
 * printed price above it says the rest. Scaled to its own range rather than a
 * shared one: these are six unrelated instruments, and a common scale would
 * flatten five of them to argue a comparison nobody is making.
 */
function Sparkline({ closes }: { closes: number[] }) {
  if (closes.length < 2) {
    return <div className="h-11" aria-hidden />;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const w = 240;
  const h = 44;

  const d = closes
    .map((v, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" L");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      className="block text-accent-bright"
      aria-hidden
    >
      <path d={`M${d}`} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export default async function MarketsPage() {
  const to = new Date();
  const from = new Date(to.getTime() - SPARK_DAYS * 86_400_000);

  const headline = await Promise.all(
    HEADLINE.map(async (symbol) => {
      const [quote, bars] = await Promise.all([
        getProvider().getQuote(symbol).catch(() => null),
        getBarsWithSource(symbol, "1Day", from, to)
          .then((r) => r.bars.map((b) => b.close))
          .catch(() => [] as number[]),
      ]);
      return { symbol, quote, closes: bars };
    }),
  );

  return (
    <div className="space-y-11">
      <PageHeader
        eyebrow="Crypto · metals · energy · agriculture · index futures"
        title="Markets"
        aside={<Badge>Eleven agricultural contracts quote in US cents (USX)</Badge>}
      >
        <p>
          None of these file accounts, so none of them get a health score. They get the
          chart, the comparison and the backtest — and this page says so rather than
          showing an empty panel.
        </p>
      </PageHeader>

      <section>
        <p className="eyebrow">Where things stand</p>
        <h2 className="font-display mt-1.5 mb-[18px] text-[1.875rem]">Today</h2>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-5">
          {headline.map(({ symbol, quote, closes }) => {
            const instrument = findInstrument(symbol);
            const change = quote?.changePercent ?? null;

            return (
              <Card key={symbol} as="article" className="px-4 py-3.5" interactive>
                <Link href={`/stock/${encodeURIComponent(symbol)}`} className="block">
                  <div className="flex items-start justify-between gap-2.5">
                    <p className="text-[0.9375rem] font-bold tracking-[0.02em]">{symbol}</p>
                    {instrument && (
                      <Badge>{ASSET_CLASS_LABEL[instrument.assetClass]}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-faint">
                    {instrument?.name ?? symbol}
                  </p>

                  {/* The quote's own currency, so a cents-quoted contract says cents. */}
                  <p className="display mt-2.5 text-[1.6875rem]">
                    {price(quote?.price, quote?.currency ?? "USD")}
                  </p>
                  <p
                    className={`tnum mt-1 text-[0.8125rem] ${
                      change == null ? "text-faint" : change >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {change == null ? "—" : signedPercent(change)}
                  </p>

                  <div className="mt-3">
                    <Sparkline closes={closes} />
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      <AssetSection
        eyebrow="Digital assets"
        title="Crypto"
        description="Trades every day of the year, weekends included. No accounts, no earnings — the price is whatever someone else will pay."
        instruments={CRYPTO}
      />

      <AssetSection
        eyebrow="Raw materials"
        title="Commodities"
        description="Quoted as the front-month futures contract. Watch the unit — eleven of these are priced in cents, not dollars."
        instruments={COMMODITIES}
      />

      <AssetSection
        eyebrow="Contracts"
        title="Financial futures"
        description="Stock indices, government bonds and currencies. Leveraged and dated — the long-run series is stitched across contracts as each expires."
        instruments={FUTURES}
      />

      <Card className="p-5">
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Educational only, not investment advice. Prices here come from the same free data
          sources as the rest of the site and can be delayed or wrong. Commodities and futures
          are shown as continuous front-month series, which is a research convention rather
          than a record of any position somebody could have held — rolling from one contract
          to the next costs money that none of these figures include.
        </p>
      </Card>
    </div>
  );
}

function AssetSection({
  eyebrow,
  title,
  description,
  instruments,
}: {
  eyebrow: string;
  title: string;
  description: string;
  instruments: Instrument[];
}) {
  const groups = groupByCategory(instruments);

  return (
    <section className="space-y-4">
      <SectionHeading eyebrow={eyebrow} title={title} description={description} />

      {groups.map((group) => (
        <Card key={group.category}>
          <CardHeader title={group.category} subtitle={`${group.items.length} listed`} />
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => (
              <li key={item.symbol}>
                <Link
                  href={`/stock/${encodeURIComponent(item.symbol)}`}
                  className="flex h-full items-baseline justify-between gap-3 bg-background px-5 py-3 transition-colors hover:bg-surface"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{item.name}</span>
                    {item.unit && (
                      <span className="block truncate text-xs text-faint">{item.unit}</span>
                    )}
                  </span>
                  <Badge>{item.symbol}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </section>
  );
}
