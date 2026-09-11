import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import { money, percent } from "../format";
import type { SectorKind } from "./applicability";
import { div } from "./math";
import type { HealthReport } from "./health";

/**
 * The two-column "what's working / what to watch" view.
 *
 * Deliberately not framed as a bull and bear case. Those words describe
 * positions someone has taken on where a price is going, and this tool does not
 * forecast prices or suggest trades. What it can do is separate what the
 * filings show going well from what they show worth watching — which is the
 * genuinely useful half of that idea.
 *
 * Every line is derived from a reported figure or a computed signal, and each
 * carries the number it came from. Nothing here is inferred about lawsuits,
 * competitors, management or anything else the filings do not state, because a
 * confident-sounding claim with no source behind it is exactly what a beginner
 * cannot evaluate.
 */

export interface Highlight {
  /** The point, in one plain sentence. */
  text: string;
  /** The figure behind it, so the claim is checkable. */
  evidence: string;
}

export interface Highlights {
  working: Highlight[];
  watch: Highlight[];
  /** True when the filings gave too little to say anything either way. */
  thin: boolean;
}

export function buildHighlights(
  fundamentals: NormalizedFundamentals,
  report: HealthReport,
  sector: SectorKind,
  currency = "USD",
): Highlights {
  const latest = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  const f = (k: Parameters<typeof fieldValue>[1]) => fieldValue(latest, k);
  const p = (k: Parameters<typeof fieldValue>[1]) => fieldValue(prior, k);

  const working: Highlight[] = [];
  const watch: Highlight[] = [];

  const revenue = f("revenue");
  const priorRevenue = p("revenue");
  const netIncome = f("netIncome");
  const priorNetIncome = p("netIncome");
  const ocf = f("operatingCashFlow");
  const margin = div(netIncome, revenue);
  const priorMargin = div(priorNetIncome, priorRevenue);

  // ---- profit ----
  if (netIncome != null) {
    if (netIncome > 0) {
      working.push({
        text: "It makes a profit rather than burning through money.",
        evidence: `${money(netIncome, currency)} earned last year`,
      });
    } else {
      watch.push({
        text: "It loses money, so it depends on cash reserves or new funding to keep going.",
        evidence: `${money(Math.abs(netIncome), currency)} lost last year`,
      });
    }
  }

  // Profit that is not backed by cash is the classic warning sign, and the one
  // a newcomer is least likely to look for.
  if (ocf != null && netIncome != null && netIncome > 0 && ocf < netIncome * 0.6) {
    watch.push({
      text: "Reported profit is running well ahead of the cash actually coming in.",
      evidence: `${money(netIncome, currency)} profit vs ${money(ocf, currency)} cash`,
    });
  } else if (ocf != null && ocf > 0) {
    working.push({
      text: "Day-to-day operations generate real cash, not just accounting profit.",
      evidence: `${money(ocf, currency)} cash from operations`,
    });
  }

  // ---- growth ----
  if (revenue != null && priorRevenue != null && priorRevenue > 0) {
    const growth = (revenue - priorRevenue) / priorRevenue;
    if (growth >= 0.15) {
      working.push({
        text: "Sales are growing quickly.",
        evidence: `up ${percent(growth)} on last year`,
      });
    } else if (growth < 0) {
      watch.push({
        text: "Sales are shrinking rather than growing.",
        evidence: `down ${percent(Math.abs(growth))} on last year`,
      });
    }
  }

  if (margin != null && priorMargin != null && margin < priorMargin - 0.02) {
    watch.push({
      text: "It keeps less of each sale as profit than it did a year ago.",
      evidence: `${percent(priorMargin)} → ${percent(margin)}`,
    });
  }

  // ---- balance sheet ----
  const longTerm = f("longTermDebt");
  const shortTerm = f("shortTermDebt");
  const cash = f("cash");
  const totalDebt =
    longTerm == null && shortTerm == null ? null : (longTerm ?? 0) + (shortTerm ?? 0);
  const netDebt = totalDebt == null ? null : totalDebt - (cash ?? 0);

  if (sector !== "financial") {
    if (netDebt != null && netDebt <= 0) {
      working.push({
        text: "It holds more cash than debt, so borrowings are not a pressure.",
        evidence: `${money(Math.abs(netDebt), currency)} more cash than debt`,
      });
    } else if (netDebt != null && ocf != null && ocf > 0) {
      const years = netDebt / ocf;
      if (years > 6) {
        watch.push({
          text: "Clearing its debt would take many years at the current rate of cash generation.",
          evidence: `about ${years.toFixed(1)} years of cash flow`,
        });
      } else if (years < 2) {
        working.push({
          text: "Its debt is small next to the cash the business produces.",
          evidence: `about ${years.toFixed(1)} years of cash flow to clear`,
        });
      }
    }

    const currentRatio = div(f("currentAssets"), f("currentLiabilities"));
    if (currentRatio != null && currentRatio < 1) {
      watch.push({
        text: "More bills fall due within a year than it holds in short-term assets.",
        evidence: `${currentRatio.toFixed(2)}x cover on near-term bills`,
      });
    }
  }

  // ---- model signals ----
  if (report.piotroski.maxScore > 0) {
    const ratio = report.piotroski.score / report.piotroski.maxScore;
    if (ratio >= 0.78) {
      working.push({
        text: "It passes almost every standard check of financial strength.",
        evidence: `Piotroski ${report.piotroski.score}/${report.piotroski.maxScore}`,
      });
    } else if (ratio <= 0.34) {
      watch.push({
        text: "It fails most of the standard checks of financial strength.",
        evidence: `Piotroski ${report.piotroski.score}/${report.piotroski.maxScore}`,
      });
    }
  }

  /*
    The Altman and Beneish readings are not repeated here. A distress zone or
    an accounting flag is already listed in the warning signs at the top of
    the page, and both models' full readings are in the scorecard — this
    column restating them put the same flag on the page three times.
  */

  // A page showing five strengths and no risks reads as a recommendation. Both
  // columns are capped so neither can dominate by sheer length.
  return {
    working: working.slice(0, 4),
    watch: watch.slice(0, 4),
    thin: working.length === 0 && watch.length === 0,
  };
}
