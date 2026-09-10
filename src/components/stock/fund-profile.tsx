import Link from "next/link";
import { Card, CardHeader, MeterBar, Metric } from "@/components/ui";
import { count, money, num, percent } from "@/lib/format";
import {
  assetLabel,
  countryLabel,
  type Breakdown,
  type FundHolding,
  type FundPortfolio,
} from "@/lib/etf/nport";
import type { NportFiling } from "@/lib/etf/fund-filings";

/**
 * A calendar date, rendered as one.
 *
 * Deliberately not `LocalTime`, which exists to move a *moment* into the
 * reader's own zone and is right everywhere it is used for one. A portfolio
 * date is not a moment: 30 June is 30 June in Vancouver and in Frankfurt, and
 * pushing it through a timezone turns it into the 29th for every reader west
 * of UTC. Formatted from the string's own parts so no zone is ever involved.
 */
function ReportedOn({ date }: { date: string }) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return <>{date}</>;

  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return <time dateTime={date}>{label}</time>;
}

/**
 * A bond's coupon and maturity, as one line, or nothing.
 *
 * Nothing for a share, which has neither — the fields only exist on a debt
 * security, and an empty line under every equity holding would be noise in
 * exchange for the one case that needs it.
 */
function bondTerms(holding: FundHolding): string | null {
  const parts: string[] = [];
  if (holding.coupon != null)
    parts.push(
      `${num(holding.coupon, 3).replace(/0+$/, "").replace(/\.$/, "")}%`,
    );
  if (holding.maturity) parts.push(`due ${holding.maturity.slice(0, 7)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * What a fund actually owns, from its own N-PORT filing.
 *
 * This is the section that was missing. A fund page used to say "this is a
 * fund, not a company" and stop, which is true and useless — it told a reader
 * what the page could not do and nothing about the thing they had looked up.
 * A fund is not unanalysable, it is analysable differently: the question is
 * not "is this business profitable" but "what am I buying, how much of it is
 * one position, and where is it".
 *
 * Everything here is the fund's own statement to its regulator, and the panel
 * links back to it. The tense is deliberate throughout — "held", not "holds" —
 * for the same reason the 13F panel next door uses it: this is the most recent
 * public record, roughly two to four months old, and a fund can have traded
 * out of any of it since.
 *
 * Percentages arrive from N-PORT in percent units rather than as ratios, so
 * every one is divided by 100 on the way into `percent()`. That conversion is
 * done here at the boundary rather than in the parser, which reports what the
 * filing says.
 */
export function FundProfile({
  symbol,
  portfolio,
  filing,
}: {
  symbol: string;
  portfolio: FundPortfolio;
  filing: NportFiling;
}) {
  const {
    holdings,
    netAssets,
    holdingCount,
    topTenPercent,
    byAsset,
    byCountry,
  } = portfolio;

  // Bars are scaled to the largest position rather than to 100%, or every row
  // in a five-hundred-stock index fund renders as an empty track.
  const largest = Math.max(
    ...holdings.map((h) => Math.abs(h.percent ?? 0)),
    0.0001,
  );

  return (
    <Card>
      <CardHeader
        title="What this fund held"
        subtitle={
          <>
            Every position, as reported to the SEC on{" "}
            {portfolio.asOf ? (
              <ReportedOn date={portfolio.asOf} />
            ) : (
              "its last filing"
            )}
            . Funds report quarterly and publish about two months later, so this
            is the latest public record rather than a live holding.
          </>
        }
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b border-border px-5 py-4 sm:grid-cols-4">
        {/*
            Always US dollars, whatever the fund trades in. N-PORT reports
            every value as `valUSD` by definition, so a Canadian-listed fund
            files its portfolio in USD while its price is in CAD — printing
            both as a bare "$" on one page is how a reader concludes the two
            are the same money.
        */}
        <Metric
          label="Net assets (USD)"
          value={money(netAssets, "USD")}
          size="lg"
        />
        <Metric label="Positions" value={count(holdingCount)} size="lg" />
        <Metric
          label="In the top 10"
          value={topTenPercent == null ? "—" : percent(topTenPercent / 100, 1)}
          size="lg"
          hint="How much of the fund its ten largest positions make up. A high number means the fund's fate rests on a few names, whatever the total count says."
        />
        <Metric
          label="Largest holding"
          value={
            holdings[0]?.percent == null
              ? "—"
              : percent(holdings[0].percent / 100, 1)
          }
          size="lg"
        />
      </dl>

      {holdings.length > 0 && (
        <div className="scroll-x border-b border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                <th scope="col" className="px-5 py-2.5 font-medium">
                  Holding
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Where
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Weight
                </th>
                <th scope="col" className="w-[28%] px-3 py-2 font-medium">
                  <span className="sr-only">Relative size</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {holdings.map((holding, i) => {
                const terms = bondTerms(holding);
                return (
                  <tr
                    key={`${holding.cusip ?? holding.name}-${i}`}
                    className="hover:bg-surface-2"
                  >
                    <td className="px-5 py-2.5">
                      <span className="font-medium">{holding.name}</span>
                      {/* A short is the opposite bet at the same weight, so it
                        cannot be left to a minus sign three columns away. */}
                      {holding.isShort && (
                        <span className="ml-2 text-xs font-medium text-down">
                          short
                        </span>
                      )}
                      {/* Without this a bond fund renders twenty rows all reading
                        "United States Treasury Note/Bond" — accurate, and
                        indistinguishable. The coupon and maturity are what tell
                        one Treasury from another, and are what a bond reader
                        was looking for anyway. */}
                      {terms && (
                        <span className="tnum block text-xs text-faint">
                          {terms}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">
                      {holding.country ? countryLabel(holding.country) : "—"}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right font-medium">
                      {holding.percent == null
                        ? "—"
                        : percent(holding.percent / 100, 2)}
                    </td>
                    <td className="px-3 py-2.5">
                      <MeterBar
                        value={Math.abs(holding.percent ?? 0)}
                        max={largest}
                        rating={holding.isShort ? "poor" : "good"}
                        label={`${holding.name}, ${percent((holding.percent ?? 0) / 100, 2)} of the fund`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {holdingCount > holdings.length && (
        <p className="border-b border-border px-5 py-3 text-xs text-faint">
          The {holdings.length} largest of {count(holdingCount)} positions. The
          mix below covers all of them.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border @2xl:grid-cols-2 @2xl:divide-x @2xl:divide-y-0">
        <Mix
          title="What it holds"
          rows={byAsset}
          render={(row) => assetLabel(row.key || null)}
        />
        <Mix
          title="Where it is"
          rows={byCountry}
          render={(row) => countryLabel(row.key || null)}
        />
      </div>

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
        Source:{" "}
        <a
          href={filing.indexUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          Form N-PORT
        </a>
        {filing.filedAt && (
          <>
            , filed <ReportedOn date={filing.filedAt} />
          </>
        )}
        . Every value in this panel is in US dollars, as the form reports them,
        whatever currency the fund itself trades in. N-PORT reports what a fund
        owns and not what it charges, so no expense ratio appears here — the
        fund&rsquo;s own factsheet states that.{" "}
        <Link
          href={`/compare?symbols=${encodeURIComponent(symbol)},SPY`}
          className="text-accent underline"
        >
          Compare its performance
        </Link>{" "}
        against the wider market.
      </p>
    </Card>
  );
}

/**
 * One composition breakdown.
 *
 * Shows the categories that carry real weight and rolls the rest into "other"
 * rather than listing a tail of twenty countries at 0.1% each. The cut is by
 * share of the fund, not by rank, so a genuinely diversified fund still shows
 * its spread while a US index fund shows one line.
 */
function Mix({
  title,
  rows,
  render,
}: {
  title: string;
  rows: Breakdown[];
  render: (row: Breakdown) => string;
}) {
  if (rows.length === 0) return null;

  const shown = rows.filter((r) => Math.abs(r.percent) >= 0.5).slice(0, 6);
  const rest = rows.filter((r) => !shown.includes(r));
  const restTotal = rest.reduce((sum, r) => sum + r.percent, 0);

  return (
    <div className="px-5 py-4">
      <p className="eyebrow text-[0.625rem]">{title}</p>
      <ul className="mt-2.5 space-y-1.5">
        {shown.map((row) => (
          <li
            key={row.key}
            className="flex items-baseline justify-between gap-4 text-sm"
          >
            <span className="min-w-0 truncate text-muted-strong">
              {render(row)}
            </span>
            <span className="tnum shrink-0 font-medium">
              {percent(row.percent / 100, 1)}
            </span>
          </li>
        ))}
        {rest.length > 0 && Math.abs(restTotal) >= 0.05 && (
          <li className="flex items-baseline justify-between gap-4 text-sm text-muted">
            <span>Other ({rest.length})</span>
            <span className="tnum shrink-0">{percent(restTotal / 100, 1)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
