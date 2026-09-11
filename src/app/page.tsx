import type { Metadata } from "next";
import Link from "next/link";
import { TranslationHero } from "@/components/translation-hero";
import { WatchlistPanel, WatchlistSync } from "@/components/watchlist";
import { MarketOverview, MarketSetupHint } from "@/components/market-overview";
import { getMarketSnapshot, hasMarketData } from "@/lib/market";
import { getIndexStrip, type IndexReading } from "@/lib/indices";
import { Card, RatingBadge } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { money, num, percent, signedPercent } from "@/lib/format";
import type { Rating } from "@/lib/scoring/types";
import { getHealthiest, getUniverseCount } from "@/lib/screener";
import { organisationLd, websiteLd } from "@/lib/structured-data";
import { StructuredData } from "@/components/structured-data";
import { auth } from "@/lib/auth";
import { listWatchlist } from "@/lib/watchlist/actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

function healthRating(score: number | null): Rating {
  if (score == null) return "unknown";
  if (score >= 7.5) return "good";
  if (score >= 5) return "fair";
  return "poor";
}

export default async function HomePage() {
  const [healthiest, universeCount, market, indices, session, saved] = await Promise.all([
    getHealthiest(6),
    getUniverseCount(),
    getMarketSnapshot(5),
    getIndexStrip(),
    auth().catch(() => null),
    listWatchlist(),
  ]);
  const signedIn = Boolean(session?.user?.id);

  return (
    <div>
      <StructuredData data={[organisationLd(), websiteLd()]} />
      <TranslationHero />

      <IndexStrip readings={indices} universeCount={universeCount} asOf={market.asOf} ageDays={market.ageDays} />

      <div className="space-y-11 pt-11">
        {hasMarketData(market) ? (
          <MarketOverview snapshot={market} />
        ) : (
          universeCount != null && universeCount > 0 && <MarketSetupHint />
        )}

        <WatchlistSync signedIn={signedIn} />
        <WatchlistPanel signedIn={signedIn} saved={saved} />

        <section aria-labelledby="healthiest-heading">
          <div className="mb-[18px] flex items-end justify-between gap-5">
            <div>
              <p className="eyebrow">Ranked from the filings</p>
              <h2 id="healthiest-heading" className="font-display mt-1.5 text-[1.875rem]">
                Financially healthiest right now
              </h2>
            </div>
            <Link
              href="/screen"
              className="font-display shrink-0 text-sm font-semibold text-accent hover:underline"
            >
              Open screener →
            </Link>
          </div>

          {healthiest.status === "ok" ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-5">
              {healthiest.rows.map((r) => (
                <Card key={r.symbol} as="article" className="p-4" interactive>
                  <Link href={`/stock/${encodeURIComponent(r.symbol)}`} className="block">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="min-w-0">
                        <p className="text-[0.9375rem] font-bold tracking-[0.02em]">{r.symbol}</p>
                        <p className="truncate text-xs text-faint">{r.name}</p>
                      </div>
                      <RatingBadge
                        rating={healthRating(r.healthScore)}
                        label={r.healthScore != null ? `${r.healthScore.toFixed(1)}/10` : "—"}
                      />
                    </div>
                    <p className="mt-3 min-h-[2.8em] text-[0.8125rem] leading-relaxed text-muted">
                      {r.headline}
                    </p>
                    <dl className="mt-3.5 grid grid-cols-3 gap-2.5 border-t border-border pt-3">
                      <Cell label="Value" value={money(r.marketCap)} />
                      <Cell label="Growth" value={percent(r.revenueGrowth)} />
                      <Cell label="Margin" value={percent(r.netMargin)} />
                    </dl>
                  </Link>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-5">
              <p className="font-display text-base font-semibold">
                {healthiest.status === "no-database" ? "Rankings need a database" : "No companies loaded yet"}
              </p>
              <p className="mt-1.5 max-w-2xl text-sm text-muted">
                Individual stock pages work without any setup — search above or try{" "}
                <Link href="/stock/AAPL" className="text-accent underline">AAPL</Link>.
                To rank and filter across the whole universe, see the{" "}
                <Link href="/screen" className="text-accent underline">screener</Link> for setup steps.
              </p>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow text-[0.625rem]">{label}</dt>
      <dd className="tnum mt-0.5 text-[0.84375rem] font-bold">{value}</dd>
    </div>
  );
}

function IndexStrip({
  readings,
  universeCount,
  asOf,
  ageDays,
}: {
  readings: IndexReading[];
  universeCount: number | null;
  asOf: Date | string | null;
  ageDays: number | null;
}) {
  const stale = ageDays != null && ageDays > 3;

  return (
    <div className="full-bleed border-b border-border">
      <div className="mx-auto grid w-full max-w-[var(--content-max)] grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] px-0 sm:px-2">
        {readings.map((r) => (
          <div key={r.symbol} className="border-r border-border px-4 py-[18px] last:border-r-0 sm:px-5">
            <p className="eyebrow">{r.label}</p>
            <p className="display mt-1.5 text-[1.625rem]">
              {r.value == null ? "—" : r.format === "rate" ? `${num(r.value, 3)}%` : num(r.value, 2)}
            </p>
            <p className={`tnum mt-0.5 text-[0.8125rem] ${r.changePercent == null ? "text-faint" : r.changePercent >= 0 ? "text-up" : "text-down"}`}>
              {r.changePercent == null ? "—" : signedPercent(r.changePercent)}
            </p>
          </div>
        ))}

        <div className="px-4 py-[18px] sm:px-5">
          <p className="eyebrow">Companies scored</p>
          <p className="display mt-1.5 text-[1.625rem]">
            {universeCount == null ? "—" : num(universeCount, 0)}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-faint">
            {asOf ? (
              <>
                {stale ? "⚠ data refresh is stale · " : "refreshed "}
                <LocalTime value={asOf} mode="datetime" showZone />
              </>
            ) : (
              "not yet ingested"
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
