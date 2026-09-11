import { fieldValue } from "../fundamentals/normalize";
import type { FinancialPeriod } from "../fundamentals/types";
import { multiple } from "../format";
import type { BusinessSummary } from "./business";
import { bySeverity } from "./change-thresholds";
import type { Change, ChangeReport } from "./changes";
import type { HealthReport, Question } from "./health";
import type { Highlights } from "./highlights";
import type { KeyFigures } from "./key-figures";
import { div } from "./math";
import { RATING_WORD } from "./ratings";
import type { Rating } from "./types";
import type { Warning } from "./warnings";

/**
 * The summary at the top of a company page.
 *
 * Nothing here is new analysis. Every line is assembled from panels the page
 * already computes — the business summary, the health report, what changed,
 * the warning signs, the key figures — so the brief and the detail beneath it
 * can never disagree, and anything the brief says can be checked a scroll
 * away.
 *
 * It describes; it never advises. No buy, sell or hold, no price target, no
 * "cheap" or "expensive": valuation is stated as multiples, and the bottom line
 * restates the evidence rather than drawing a conclusion from it for the
 * reader.
 */

type Area = Exclude<Question["key"], "valuation">;

export interface BriefArea {
  key: Area;
  label: string;
  rating: Rating;
  /** The rating in a word, so it never rests on colour. */
  verdict: string;
  answer: string;
}

export interface BriefMove {
  key: string;
  label: string;
  from: string;
  to: string;
  delta: string;
  severity: Change["severity"];
  /** Which comparison it came from, e.g. "FY2025 against FY2024". */
  period: string;
}

export interface BriefWatch {
  text: string;
  evidence: string;
  /** A filing, or an anchor on this page when it starts with "#". */
  url: string | null;
}

export interface BriefValuation {
  pe: number | null;
  priceToSales: number | null;
  priceToFreeCashFlow: number | null;
  summary: string;
}

export interface InvestorBrief {
  business: string | null;
  scale: BusinessSummary["scale"];
  health: {
    score: number | null;
    headline: string;
    /**
     * One sentence naming the strong and weak areas. The card shows this
     * rather than a grid of ratings: the breakdown in the health section
     * lists every area, and the grid repeated it a scroll above.
     */
    summary: string;
    areas: BriefArea[];
    /** How many areas had enough data to be rated. */
    assessed: number;
    /** The areas that did not, by label. */
    unassessed: string[];
  };
  /** Whether there was an earlier period to compare against at all. */
  compared: boolean;
  improving: BriefMove[];
  deteriorating: BriefMove[];
  watch: BriefWatch | null;
  valuation: BriefValuation;
  bottomLine: string;
  source: {
    fiscalYear: number;
    form: string;
    filedAt: string | null;
    url: string | null;
  };
}

const MAX_MOVES = 3;

const AREA_LABEL: Record<Area, string> = {
  profitable: "Profitability",
  growing: "Growth",
  debt: "Debt",
  accounting: "Accounting",
};

/** How a strong area reads inside a sentence. */
const STRONG_PHRASE: Record<Area, string> = {
  profitable: "solid profitability",
  growing: "strong sales growth",
  debt: "a manageable debt load",
  accounting: "clean accounting signals",
};

/** How a weak area reads inside a sentence. */
const WEAK_PHRASE: Record<Area, string> = {
  profitable: "weak profitability",
  growing: "shrinking or stalled sales",
  debt: "a heavy debt load",
  accounting: "an accounting flag",
};

export function buildInvestorBrief(input: {
  name: string;
  business: BusinessSummary | null;
  report: HealthReport;
  changes: ChangeReport | null;
  warnings: Warning[];
  highlights: Highlights | null;
  keyFigures: KeyFigures | null;
  latest: FinancialPeriod;
  marketCap: number | null;
}): InvestorBrief {
  const { name, business, report, changes, warnings, highlights, keyFigures, latest, marketCap } = input;

  const areas: BriefArea[] = report.questions
    .filter((q): q is Question & { key: Area } => q.key !== "valuation")
    .map((q) => ({
      key: q.key,
      label: AREA_LABEL[q.key],
      rating: q.rating,
      verdict: RATING_WORD[q.rating],
      answer: q.answer,
    }));

  const improving = movesFrom(changes, "better");
  const deteriorating = movesFrom(changes, "worse");
  const valuation = valuationOf(latest, marketCap, keyFigures);

  return {
    business: business?.sentence ?? null,
    scale: business?.scale ?? [],
    health: {
      score: report.score,
      headline: report.headline,
      summary: areaSummaryOf(areas),
      areas,
      assessed: areas.filter((a) => a.rating !== "unknown").length,
      unassessed: areas.filter((a) => a.rating === "unknown").map((a) => a.label),
    },
    compared: changes !== null,
    improving,
    deteriorating,
    watch: biggestWatch(warnings, deteriorating, highlights),
    valuation,
    bottomLine: bottomLineOf(name, report, areas, changes, valuation, latest),
    source: {
      fiscalYear: latest.fiscalYear,
      form: latest.form,
      filedAt: latest.filedAt ?? null,
      url: report.sourceFilingUrl,
    },
  };
}

/**
 * The largest moves in one direction.
 *
 * The latest quarter against a year earlier leads when there is one, because
 * it is the newer news; the annual comparison fills the rest. A measure is
 * listed once, and every move carries the comparison it came from, so a
 * quarter's figure is never read as a year's.
 */
function movesFrom(changes: ChangeReport | null, direction: "better" | "worse"): BriefMove[] {
  if (!changes) return [];

  const picked: BriefMove[] = [];
  const seen = new Set<string>();

  const take = (list: Change[], period: string) => {
    for (const change of list) {
      if (picked.length >= MAX_MOVES) return;
      if (change.direction !== direction || seen.has(change.key)) continue;
      seen.add(change.key);
      picked.push({
        key: change.key,
        label: change.label,
        from: change.from,
        to: change.to,
        delta: change.delta,
        severity: change.severity,
        period,
      });
    }
  };

  const quarter = changes.quarterly.find((q) => q.kind === "year-over-year");
  if (quarter) take(quarter.changes, `${quarter.toLabel} against ${quarter.fromLabel}`);
  take(changes.changes, `FY${changes.toYear} against FY${changes.fromYear}`);

  return picked.sort(bySeverity);
}

/**
 * "Strong on profitability and debt; mixed on growth; accounting could not be
 * rated." Areas that could not be rated are named as such, never as weak.
 */
function areaSummaryOf(areas: BriefArea[]): string {
  const labelled = (rating: Rating) =>
    areas.filter((a) => a.rating === rating).map((a) => a.label.toLowerCase());

  const groups: [string, string[]][] = [
    ["strong on", labelled("good")],
    ["mixed on", labelled("fair")],
    ["weak on", labelled("poor")],
  ];
  const parts = groups
    .filter(([, labels]) => labels.length > 0)
    .map(([lead, labels]) => `${lead} ${list(labels)}`);

  const unrated = labelled("unknown");
  if (unrated.length > 0) parts.push(`${list(unrated)} could not be rated`);
  if (parts.length === 0) return "No area had enough reported figures to rate.";

  const sentence = parts.join("; ");
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * The one thing most worth a reader's attention, in order of weight.
 *
 * A company's own severe filing — a restatement, an auditor change — outranks
 * everything, because it is the company saying it. Then a critical
 * deterioration in its figures, then any other warning sign, then the watch
 * list.
 *
 * A warning sign is pointed to rather than restated. The warning signs sit
 * directly beneath this brief, and copying the first of them here put the
 * same sentence on the page twice, one above the other.
 */
function biggestWatch(
  warnings: Warning[],
  deteriorating: BriefMove[],
  highlights: Highlights | null,
): BriefWatch | null {
  const severe = warnings.some((w) => w.level === "severe");
  if (severe) return toWarnings(warnings, true);

  const critical = deteriorating.find((m) => m.severity === "critical");
  if (critical) return fromMove(critical);

  if (warnings.length > 0) return toWarnings(warnings, false);

  const flagged = highlights?.watch[0];
  if (flagged) return { text: flagged.text, evidence: flagged.evidence, url: null };

  if (deteriorating[0]) return fromMove(deteriorating[0]);

  return null;
}

/** Points at the warning signs below; `url` is an anchor on this page. */
function toWarnings(warnings: Warning[], severe: boolean): BriefWatch {
  const count = warnings.length;
  return {
    text:
      count === 1
        ? "One warning sign is worth reading first. It is listed just below this brief."
        : `${count} warning signs are worth reading first. They are listed just below this brief.`,
    evidence: severe ? "Includes one rated severe" : "None rated severe",
    url: "#warning-signs",
  };
}

function fromMove(move: BriefMove): BriefWatch {
  return {
    text: `${move.label}: ${move.delta}, ${move.period}.`,
    evidence: `${move.from} → ${move.to}`,
    url: null,
  };
}

/**
 * The multiples, stated as multiples.
 *
 * A single year's figures against today's price. Comparing them with the
 * company's own history needs the share price as it stood when each past
 * filing was published, adjusted for every split since — which this page
 * does not yet hold — so it says so rather than implying a context it lacks.
 */
function valuationOf(
  latest: FinancialPeriod,
  marketCap: number | null,
  keyFigures: KeyFigures | null,
): BriefValuation {
  const netIncome = fieldValue(latest, "netIncome");
  const revenue = fieldValue(latest, "revenue");

  const pe = marketCap != null && netIncome != null && netIncome > 0 ? div(marketCap, netIncome) : null;
  const priceToSales =
    marketCap != null && revenue != null && revenue > 0 ? div(marketCap, revenue) : null;
  const priceToFreeCashFlow = keyFigures?.priceToFreeCashFlow ?? null;

  let summary: string;
  if (marketCap == null) {
    summary = "No current share price is available, so no valuation multiple can be worked out.";
  } else if (pe != null) {
    summary =
      `At the current price the market values it at ${multiple(pe, 1)} its latest annual profit` +
      (priceToFreeCashFlow != null
        ? ` and ${multiple(priceToFreeCashFlow, 1)} its free cash flow.`
        : ".") +
      " These are single-year figures; this page does not yet compare them with the company's own past.";
  } else if (netIncome != null && netIncome <= 0) {
    summary =
      "It lost money in its latest year, so there is no P/E" +
      (priceToSales != null
        ? `; the market values it at ${multiple(priceToSales, 1)} its annual sales.`
        : ".");
  } else {
    summary = "Its latest filing does not report enough to set the share price against.";
  }

  return { pe, priceToSales, priceToFreeCashFlow, summary };
}

/**
 * Two or three sentences restating the evidence: the score and what drives
 * it, what moved, and the headline multiple. No conclusion is drawn for the
 * reader.
 */
function bottomLineOf(
  name: string,
  report: HealthReport,
  areas: BriefArea[],
  changes: ChangeReport | null,
  valuation: BriefValuation,
  latest: FinancialPeriod,
): string {
  const sentences: string[] = [];
  const filing = `FY${latest.fiscalYear} ${latest.form}`;

  if (report.score == null) {
    sentences.push(`${name}'s ${filing} does not report enough to score its financial health.`);
  } else {
    const strong = areas.filter((a) => a.rating === "good").map((a) => STRONG_PHRASE[a.key]);
    const weak = areas.filter((a) => a.rating === "poor").map((a) => WEAK_PHRASE[a.key]);

    const reasons =
      strong.length && weak.length
        ? `, reflecting ${list(strong)} but ${list(weak)}`
        : strong.length
          ? `, reflecting ${list(strong)}`
          : weak.length
            ? `, held back by ${list(weak)}`
            : "";

    sentences.push(
      `On its ${filing}, ${name} scores ${report.score.toFixed(1)} out of 10 for financial health${reasons}.`,
    );
  }

  if (changes) {
    const rated = changes.changes.filter((c) => c.direction !== "neutral");
    if (rated.length === 0) {
      sentences.push(`Little moved against FY${changes.fromYear}.`);
    } else {
      const better = rated.filter((c) => c.direction === "better").length;
      const worse = rated.length - better;
      const largest = rated[0];
      sentences.push(
        `Against FY${changes.fromYear}, ${better} measure${better === 1 ? "" : "s"} improved and ` +
          `${worse} deteriorated; the largest move was ${largest.label.toLowerCase()} (${largest.delta}).`,
      );
    }
  }

  if (valuation.pe != null) {
    sentences.push(`At the current price the market values it at ${multiple(valuation.pe, 1)} its latest annual profit.`);
  }

  return sentences.join(" ");
}

/** "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
