import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import type { HealthReport, Question } from "./health";
import type { Rating } from "./types";

/**
 * The health score, taken apart into the areas it is made of.
 *
 * "8.7 out of 10" says how much, not why. This names each area in a word,
 * says how many areas had enough reported figures to be judged, and names the
 * ones that did not — which are left out of the average rather than counted
 * as failures, the rule the score has always followed.
 *
 * Nothing here scores anything. Four areas are the report's own answers;
 * cash generation is shown beside them for context and marked as not scored
 * separately, because it already feeds the profitability answer.
 */

export type AreaKey = "profitability" | "growth" | "cash" | "leverage" | "accounting";

export interface HealthArea {
  key: AreaKey;
  label: string;
  rating: Rating;
  /** The rating in a word suited to the area: strength for some, risk for others. */
  word: string;
  /** Whether the area counts toward the score. */
  scored: boolean;
  /** One sentence on what the filings show for this area. */
  summary: string;
}

export interface HealthBreakdown {
  areas: HealthArea[];
  /** Scored areas with enough figures to judge. */
  scoredEvaluated: number;
  scoredTotal: number;
  /** Scored areas left out of the average for want of figures. */
  unavailable: string[];
  signalsEvaluated: number;
  signalsTotal: number;
}

const STRENGTH: Record<Rating, string> = {
  good: "Strong",
  fair: "Moderate",
  poor: "Weak",
  unknown: "Not enough data",
};

const LEVERAGE: Record<Rating, string> = {
  good: "Low",
  fair: "Moderate",
  poor: "High",
  unknown: "Not enough data",
};

const ACCOUNTING_RISK: Record<Rating, string> = {
  good: "Low",
  fair: "Moderate",
  poor: "Elevated",
  unknown: "Not enough data",
};

function firstSentence(text: string | undefined): string {
  if (!text) return "Not enough was reported to judge.";
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

/** Whether operations produced cash, and whether any was left after capital spending. */
function cashGeneration(fundamentals: NormalizedFundamentals): { rating: Rating; summary: string } {
  const latest = fundamentals.annual[0];
  const ocf = fieldValue(latest, "operatingCashFlow");
  const capexRaw = fieldValue(latest, "capex");

  if (ocf == null) return { rating: "unknown", summary: "Operating cash flow was not reported." };
  if (ocf <= 0) return { rating: "poor", summary: "Operations consumed cash rather than producing it." };
  if (capexRaw == null) {
    return {
      rating: "fair",
      summary: "Operations produced cash; capital spending was not reported, so free cash flow is unknown.",
    };
  }

  const freeCashFlow = ocf - Math.abs(capexRaw);
  return freeCashFlow > 0
    ? { rating: "good", summary: "Operations produced cash, with some left after capital spending." }
    : { rating: "fair", summary: "Operations produced cash, but capital spending used all of it and more." };
}

export function buildHealthBreakdown(
  report: HealthReport,
  fundamentals: NormalizedFundamentals,
): HealthBreakdown {
  const answer = (key: Question["key"]) => report.questions.find((q) => q.key === key);

  const fromQuestion = (
    questionKey: Question["key"],
    key: AreaKey,
    label: string,
    words: Record<Rating, string>,
  ): HealthArea => {
    const question = answer(questionKey);
    const rating = question?.rating ?? "unknown";
    return { key, label, rating, word: words[rating], scored: true, summary: firstSentence(question?.answer) };
  };

  const cash = cashGeneration(fundamentals);
  const areas: HealthArea[] = [
    fromQuestion("profitable", "profitability", "Profitability", STRENGTH),
    fromQuestion("growing", "growth", "Growth", STRENGTH),
    { key: "cash", label: "Cash generation", rating: cash.rating, word: STRENGTH[cash.rating], scored: false, summary: cash.summary },
    fromQuestion("debt", "leverage", "Leverage", LEVERAGE),
    fromQuestion("accounting", "accounting", "Accounting risk", ACCOUNTING_RISK),
  ];

  const scored = areas.filter((area) => area.scored);
  return {
    areas,
    scoredEvaluated: scored.filter((area) => area.rating !== "unknown").length,
    scoredTotal: scored.length,
    unavailable: scored.filter((area) => area.rating === "unknown").map((area) => area.label),
    signalsEvaluated: report.piotroski.maxScore,
    signalsTotal: report.piotroski.signals.length,
  };
}
