import { fieldValue } from "./fundamentals/normalize";
import type { NormalizedFundamentals } from "./fundamentals/types";
import { div } from "./scoring/math";

/**
 * Where one company sits against the others it is being compared with.
 *
 * Descriptive, and deliberately so. A sentence says a margin is higher or a
 * P/E is lower than the median of the other companies selected, with both
 * figures; it never ranks the companies, never calls one better, and never
 * suggests doing anything about it. A higher P/E beside higher margins is a
 * description of a price, not a verdict on it.
 */

export interface PeerFigures {
  symbol: string;
  healthScore: number | null;
  revenueGrowth: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  peRatio: number | null;
  debtToEquity: number | null;
}

/**
 * One company's comparison figures from its own latest annual filing — the
 * same definitions the nightly scores use, so a company page's own row sits
 * fairly beside its peers' stored ones.
 */
export function figuresFromFundamentals(
  symbol: string,
  fundamentals: NormalizedFundamentals,
  marketCap: number | null,
  healthScore: number | null,
): PeerFigures {
  const latest = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  const v = (field: Parameters<typeof fieldValue>[1]) => fieldValue(latest, field);

  const revenue = v("revenue");
  const priorRevenue =
    prior && latest && prior.fiscalYear === latest.fiscalYear - 1 ? fieldValue(prior, "revenue") : null;
  const netIncome = v("netIncome");

  return {
    symbol,
    healthScore,
    revenueGrowth:
      revenue != null && priorRevenue != null && priorRevenue !== 0
        ? (revenue - priorRevenue) / Math.abs(priorRevenue)
        : null,
    operatingMargin: div(v("operatingIncome"), revenue),
    netMargin: div(netIncome, revenue),
    peRatio: netIncome != null && netIncome > 0 ? div(marketCap, netIncome) : null,
    debtToEquity: div(v("liabilities"), v("equity")),
  };
}

/** The middle value, ignoring anything missing. */
export function median(values: (number | null | undefined)[]): number | null {
  const numbers = values
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2 === 1 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const times = (v: number) => `${v.toFixed(1)}x`;

type Position = "higher" | "lower" | "in line";

function position(subject: number, reference: number, tolerance: number, relative: boolean): Position {
  const gap = relative ? (subject - reference) / Math.abs(reference || 1) : subject - reference;
  if (Math.abs(gap) <= tolerance) return "in line";
  return gap > 0 ? "higher" : "lower";
}

/**
 * Up to four sentences, each only when the subject and at least one other
 * company have the figure.
 */
export function describeAgainstPeers(subject: PeerFigures, peers: PeerFigures[]): string[] {
  const others = peers.filter((peer) => peer.symbol !== subject.symbol);
  if (others.length === 0) return [];

  const sentences: string[] = [];
  const against = (count: number) =>
    count === 1 ? "the other company selected" : "the median of the other companies selected";

  const reference = (pick: (p: PeerFigures) => number | null) => {
    const values = others.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
    return { median: median(values), count: values.length };
  };

  // Margins: operating margin where both sides have it, profit margin otherwise.
  const operating = reference((p) => p.operatingMargin);
  const net = reference((p) => p.netMargin);
  const margin =
    subject.operatingMargin != null && operating.median != null
      ? { label: "operating margin", value: subject.operatingMargin, ...operating }
      : subject.netMargin != null && net.median != null
        ? { label: "profit margin", value: subject.netMargin, ...net }
        : null;
  if (margin && margin.median != null) {
    const where = position(margin.value, margin.median, 0.01, false);
    sentences.push(
      where === "in line"
        ? `${subject.symbol}'s ${margin.label} of ${pct(margin.value)} is in line with ${against(margin.count)} (${pct(margin.median)}).`
        : `${subject.symbol}'s ${margin.label} of ${pct(margin.value)} is ${where} than ${against(margin.count)} (${pct(margin.median)}).`,
    );
  }

  const growth = reference((p) => p.revenueGrowth);
  if (subject.revenueGrowth != null && growth.median != null) {
    const where = position(subject.revenueGrowth, growth.median, 0.02, false);
    sentences.push(
      where === "in line"
        ? `Its revenue growth of ${pct(subject.revenueGrowth)} is in line with ${against(growth.count)} (${pct(growth.median)}).`
        : `Its revenue grew ${where === "higher" ? "faster" : "more slowly"} than ${against(growth.count)}: ${pct(subject.revenueGrowth)} against ${pct(growth.median)}.`,
    );
  }

  const pe = reference((p) => p.peRatio);
  if (pe.median != null) {
    if (subject.peRatio != null) {
      const where = position(subject.peRatio, pe.median, 0.1, true);
      sentences.push(
        where === "in line"
          ? `It trades at a P/E in line with ${against(pe.count)} (${times(subject.peRatio)} against ${times(pe.median)}).`
          : `It trades at a ${where} P/E than ${against(pe.count)}: ${times(subject.peRatio)} against ${times(pe.median)}.`,
      );
    } else if (subject.netMargin != null && subject.netMargin <= 0) {
      sentences.push("It has no P/E to set against theirs, because it did not make a profit.");
    }
  }

  const leverage = reference((p) => p.debtToEquity);
  if (subject.debtToEquity != null && leverage.median != null) {
    const where = position(subject.debtToEquity, leverage.median, 0.1, true);
    if (where !== "in line") {
      sentences.push(
        `Its liabilities are ${where} relative to equity than ${against(leverage.count)}: ${times(subject.debtToEquity)} against ${times(leverage.median)}.`,
      );
    }
  }

  return sentences;
}
