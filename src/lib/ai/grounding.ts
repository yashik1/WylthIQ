import { money, multiple, percent } from "../format";
import type { ChangeReport } from "../scoring/changes";
import type { HealthReport } from "../scoring/health";
import type { HealthHistory } from "../scoring/health-history";
import type { KeyFigures } from "../scoring/key-figures";
import { RATING_WORD } from "../scoring/ratings";
import { AI_QUESTIONS, type AiQuestionKey } from "./questions";

/**
 * What a grounded explanation is allowed to know.
 *
 * Built only from figures the company page already shows — the health report,
 * what changed, the key figures, the score's history — each block labelled
 * with a source id the answer must cite. Nothing is passed that a reader could
 * not check on the page: no news headlines, which are third-party text, and
 * nothing the reader typed.
 */

export interface GroundingSource {
  id: string;
  label: string;
  url: string | null;
}

export interface Grounding {
  sources: GroundingSource[];
  facts: string;
}

export interface GroundingInput {
  symbol: string;
  name: string;
  currency: string;
  latest: { fiscalYear: number; form: string; filedAt: string | null; url: string | null } | null;
  report: HealthReport;
  changes: ChangeReport | null;
  keyFigures: KeyFigures | null;
  history: HealthHistory | null;
  price: { freshness: string | null; marketCap: number | null } | null;
}

export function buildGrounding(input: GroundingInput): Grounding {
  const { symbol, name, currency, latest, report, changes, keyFigures, history, price } = input;
  const page = `/stock/${encodeURIComponent(symbol)}`;
  const sources: GroundingSource[] = [];
  const lines: string[] = [`Company: ${name} (${symbol}). Money amounts are in ${currency}.`];

  const cite = (label: string, url: string | null) => {
    const id = `S${sources.length + 1}`;
    sources.push({ id, label, url });
    return id;
  };

  const filing = latest
    ? cite(`${name}'s FY${latest.fiscalYear} ${latest.form}`, latest.url)
    : null;
  if (latest && filing) {
    lines.push(
      `[${filing}] The latest annual report is for fiscal year ${latest.fiscalYear}, Form ${latest.form}${latest.filedAt ? `, filed ${latest.filedAt}` : ""}.`,
    );
  }

  const health = cite("Health score and the questions behind it", `${page}#health`);
  const period = report.fiscalYear ? `FY${report.fiscalYear}` : "the latest fiscal year";
  lines.push(
    report.score != null
      ? `[${health}] Health score for ${period}: ${report.score.toFixed(1)} out of 10. It averages the ratings for profitability, growth, debt and accounting quality, scoring strong as 10, mixed as 6 and weak as 2, and leaves out any question without enough figures. Valuation is not part of it.`
      : `[${health}] There were not enough reported figures to compute a health score for ${period}.`,
  );
  for (const question of report.questions.filter((q) => q.key !== "valuation")) {
    const figures = question.metrics.map((m) => `${m.label} ${m.value}`).join("; ");
    lines.push(
      `[${health}] ${question.question} Rated ${RATING_WORD[question.rating].toLowerCase()}. ${question.answer} Figures: ${figures}.`,
    );
  }

  const { piotroski, altman, beneish } = report;
  lines.push(
    `[${health}] Piotroski F-Score: ${piotroski.maxScore > 0 ? `${piotroski.score} of ${piotroski.maxScore} checks passed` : "not evaluated"}. ` +
      `Altman Z-Score: ${altman.value ? `${altman.value.z.toFixed(2)} (${altman.value.variant} model), ${altman.value.zone} zone` : (altman.reason ?? "not applicable")}. ` +
      `Beneish M-Score: ${beneish.value ? `${beneish.value.m.toFixed(2)}, ${beneish.value.flagged ? "above" : "below"} the −1.78 threshold` : (beneish.reason ?? "not applicable")}.`,
  );

  if (changes) {
    const id = cite("What changed", `${page}#what-changed`);
    const moves = changes.changes.map(
      (c) => `${c.label} ${c.from} → ${c.to} (${c.delta}; ${c.severity}; ${c.direction})`,
    );
    lines.push(
      `[${id}] Between FY${changes.fromYear} and FY${changes.toYear}: ${moves.length > 0 ? moves.join("; ") : "no measure moved materially"}. ${changes.steady} further measures barely moved.`,
    );
    for (const quarter of changes.quarterly) {
      const quarterMoves = quarter.changes.map((c) => `${c.label} ${c.from} → ${c.to} (${c.delta})`);
      lines.push(
        `[${id}] ${quarter.toLabel} against ${quarter.fromLabel}: ${quarterMoves.length > 0 ? quarterMoves.join("; ") : "no measure moved materially"}.`,
      );
    }
  }

  if (history) {
    const id = cite("Health score history", `${page}#health`);
    const points = history.points
      .map((p) => `FY${p.fiscalYear} ${p.score.toFixed(1)} (from the ${p.form} filed ${p.asOf})`)
      .join("; ");
    lines.push(
      `[${id}] Health score by fiscal year, each scored only from that year's annual report as first filed and without a share price: ${points}.` +
        (history.change != null ? ` Change on the year before the latest: ${history.change > 0 ? "+" : ""}${history.change.toFixed(1)}.` : ""),
    );
  }

  if (keyFigures) {
    const id = cite("Key figures", `${page}#key-figures`);
    lines.push(
      `[${id}] Key figures for ${period}: free cash flow ${money(keyFigures.freeCashFlow, currency)}; free cash flow margin ${percent(keyFigures.fcfMargin)}; gross margin ${percent(keyFigures.grossMargin)}; operating margin ${percent(keyFigures.operatingMargin)}; net margin ${percent(keyFigures.netMargin)}; return on equity ${percent(keyFigures.returnOnEquity)}; return on assets ${percent(keyFigures.returnOnAssets)}; interest cover ${multiple(keyFigures.interestCoverage)}; change in shares outstanding ${percent(keyFigures.shareCountChange)}.`,
    );
  }

  const valuation = report.questions.find((q) => q.key === "valuation");
  if (valuation) {
    const id = cite("Valuation and share price", `${page}#questions`);
    const figures = valuation.metrics.map((m) => `${m.label} ${m.value}`).join("; ");
    lines.push(
      `[${id}] Valuation, from the share price${price?.freshness ? ` (${price.freshness})` : ""} and the ${period} figures: ${figures}` +
        `${price?.marketCap != null ? `; market value ${money(price.marketCap)}` : ""}` +
        `${keyFigures?.priceToFreeCashFlow != null ? `; price to free cash flow ${multiple(keyFigures.priceToFreeCashFlow)}` : ""}. ${valuation.answer}`,
    );
  }

  return { sources, facts: lines.join("\n") };
}

export const SYSTEM_PROMPT = [
  "You explain a public company's reported financial figures for WylthIQ, an educational research site.",
  "Rules:",
  "1. Use only the facts in the user's message. Do not use outside knowledge about the company, its products, its news or its share price history.",
  "2. After each statement drawn from the facts, cite its source id in square brackets, such as [S2].",
  "3. Name the fiscal period of any figure you mention.",
  "4. If the facts do not contain what the question needs, say so plainly instead of guessing.",
  "5. Never recommend buying, selling or holding anything, never give a price target, and never say what the reader should do. Describe; do not advise.",
  "6. Do not speculate about why a figure moved beyond what the facts state.",
  "7. Write plain English for someone new to finance: at most 180 words, in short paragraphs, with no headings and no lists.",
].join("\n");

export function buildUserMessage(question: AiQuestionKey, grounding: Grounding): string {
  const { label, instruction } = AI_QUESTIONS[question];
  return [
    `Question: ${label}`,
    "",
    `How to answer: ${instruction}`,
    "",
    "Sources:",
    ...grounding.sources.map((s) => `${s.id}: ${s.label}`),
    "",
    "FACTS (the only information you may use):",
    grounding.facts,
  ].join("\n");
}

/**
 * A last check on what came back.
 *
 * The prompt forbids advice, and models follow it, but an explanation shown
 * under a company's name is not a place to rely on that alone. An answer that
 * reads as a recommendation is withheld rather than shown.
 */
export function screenAnswer(text: string): { ok: true; text: string } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false };
  // "A buy", "a sell" and "a hold" as verdicts, but not "a sell-off".
  const advice =
    /\b(you should|we recommend|i recommend|consider (buying|selling)|strong (buy|sell)|price target|(buy|sell|hold) rating|undervalued|overvalued)\b|\ba (buy|sell|hold)\b(?!-)/i;
  return advice.test(trimmed) ? { ok: false } : { ok: true, text: trimmed };
}
