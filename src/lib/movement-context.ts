import { classifyFiling } from "./filings/timeline";
import type { Filing, NewsItem } from "./providers/types";

/**
 * A price move, set beside its sector and the market, with what was published
 * around it.
 *
 * The one rule this module exists to keep: it never says why a price moved.
 * A filing on the same day is a coincidence in time, not an established
 * cause, and a sentence that joined the two with "because" would be making a
 * claim nothing on the page supports. So the comparison is numbers only —
 * how far the stock moved against its sector and against the market — and the
 * evidence is a list of what was published, dated and linked, for the reader
 * to weigh.
 */

export interface MoveReading {
  label: string;
  /** Daily change as a fraction: -0.028 is −2.8%. */
  change: number;
}

export interface SectorReading extends MoveReading {
  /** Companies the sector average was taken over. */
  companies: number;
}

export interface MovementEvidence {
  kind: "filing" | "earnings" | "news";
  label: string;
  /** ISO date or date-time. */
  date: string;
  title: string;
  source: string;
  url: string;
}

export interface MovementContext {
  stock: MoveReading;
  sector: SectorReading | null;
  market: MoveReading | null;
  comparison: string;
  evidence: MovementEvidence[];
  /** Said instead of a list when nothing was published in the window. */
  quietNote: string;
  days: number;
}

/** Moves within half a percentage point of each other are called in line. */
const IN_LINE = 0.005;
const DAY_MS = 86_400_000;
const MAX_NEWS = 4;

const signed = (change: number) =>
  `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change * 100).toFixed(2)}%`;

function relative(difference: number, against: string): string {
  if (Math.abs(difference) < IN_LINE) return `in line with ${against}`;
  const points = Math.abs(difference * 100).toFixed(1);
  return `${points} points ${difference > 0 ? "above" : "below"} ${against}`;
}

/** The move and how it compares, in numbers only. */
export function describeRelativeMove(
  symbol: string,
  stock: number,
  sector: SectorReading | null,
  market: MoveReading | null,
): string {
  const sentences: string[] = [
    stock === 0
      ? `${symbol} was unchanged on the latest quote.`
      : `${symbol} ${stock > 0 ? "rose" : "fell"} ${Math.abs(stock * 100).toFixed(2)}% on the latest quote.`,
  ];

  if (sector && market) {
    sentences.push(
      `The average ${sector.label} company tracked here moved ${signed(sector.change)}, and the ${market.label} ${signed(market.change)}.`,
    );
  } else if (sector) {
    sentences.push(`The average ${sector.label} company tracked here moved ${signed(sector.change)}.`);
  } else if (market) {
    sentences.push(`The ${market.label} moved ${signed(market.change)}.`);
  }

  const parts = [
    sector && relative(stock - sector.change, "its sector"),
    market && relative(stock - market.change, "the market"),
  ].filter((part): part is string => Boolean(part));
  if (parts.length > 0) sentences.push(`That is ${parts.join(" and ")}.`);

  return sentences.join(" ");
}

export function buildMovementContext(input: {
  symbol: string;
  stockChange: number | null;
  sector: SectorReading | null;
  market: MoveReading | null;
  filings: Filing[];
  news: NewsItem[];
  now: Date;
  days?: number;
}): MovementContext | null {
  const { symbol, stockChange, sector, market, now } = input;
  if (stockChange == null || !Number.isFinite(stockChange)) return null;

  const days = input.days ?? 3;
  const cutoff = now.getTime() - days * DAY_MS;
  const inWindow = (date: string) => {
    const at = Date.parse(date);
    return Number.isFinite(at) && at >= cutoff && at <= now.getTime() + DAY_MS;
  };

  const filings: MovementEvidence[] = input.filings
    .filter((filing) => inWindow(filing.filedAt))
    .map((filing) => {
      const classified = classifyFiling(filing);
      return {
        kind: classified.category === "earnings" ? "earnings" : "filing",
        label: classified.label,
        date: filing.filedAt,
        title: classified.title,
        source: `Form ${filing.form}`,
        url: filing.url,
      };
    });

  const news: MovementEvidence[] = input.news
    .filter((item) => inWindow(item.publishedAt))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_NEWS)
    .map((item) => ({
      kind: "news",
      label: "News",
      date: item.publishedAt,
      title: item.headline,
      source: item.source,
      url: item.url,
    }));

  return {
    stock: { label: symbol, change: stockChange },
    sector,
    market,
    comparison: describeRelativeMove(symbol, stockChange, sector, market),
    evidence: [...filings, ...news].sort((a, b) => b.date.localeCompare(a.date)),
    quietNote: `No filing from ${symbol} and no news item about it appeared in the last ${days} days.`,
    days,
  };
}
