import type { HealthReport } from "./health";
import type { Filing } from "../providers/types";
import type { InsiderActivity } from "../signals/insider";
import { describeEightK } from "../signals/eight-k-items";
import { money } from "../format";
import { ACCOUNTING_FLAG, DISTRESS_FLAG } from "./model-flags";

/**
 * Everything on this page that a careful reader should not miss.
 *
 * Not a new analysis. Every item here is already computed and already shown
 * somewhere further down — the Beneish flag inside the accounting question,
 * a distress zone inside the debt question, an 8-K item inside the filings
 * table, an unscheduled sale inside the early-signals panel. What was missing
 * was a place where they appear together, near the top, without the reader
 * having to know that a "4.02" is a restatement or that an Altman zone is a
 * bankruptcy model.
 *
 * That matters more than it sounds. In the FINRA Foundation's 2025 study, of
 * the people who at least sometimes act on a social-media personality's stock
 * advice, 72% said they would invest in a hypothetical opportunity built to
 * test fraud awareness — and social media is now the most-cited source of
 * financial news among younger investors. Somebody arriving with a ticker
 * from a video is exactly who this panel is for, and they will not scroll.
 *
 * Strictly descriptive. Each line reports something a company filed or a
 * published model flagged, and none of them says what to do about it. An
 * empty result is the ordinary case, not a failure.
 */

export interface Warning {
  /** The point, in one plain sentence. */
  text: string;
  /** The figure, form or date behind it, so the claim is checkable. */
  evidence: string;
  /**
   * How much attention it warrants.
   *
   * `severe` is reserved for the handful of filings that are, on their own,
   * the strongest warnings a company can publish about itself — a
   * restatement, an auditor change, a delisting notice, bankruptcy.
   */
  level: "severe" | "notable";
  /** The filing it came from, when there is one to read. */
  url?: string;
}

/** How far back a filed event still counts as current. */
const RECENT_DAYS = 120;

function isRecent(filedAt: string): boolean {
  const filed = Date.parse(filedAt);
  return Number.isFinite(filed) && Date.now() - filed <= RECENT_DAYS * 86_400_000;
}

export function buildWarnings(input: {
  report: HealthReport | null;
  filings: Filing[];
  insider: InsiderActivity;
  currency?: string;
}): Warning[] {
  const { report, filings, insider, currency = "USD" } = input;
  const warnings: Warning[] = [];

  /* ---- what the company said about itself ---------------------------------
     Taken first, and deliberately. A model's opinion is inference; an 8-K
     under item 4.02 is the company stating in a regulatory filing that its
     own published accounts should not be relied upon. Nothing else on this
     page carries that weight. */
  for (const filing of filings) {
    if (filing.form !== "8-K" || !filing.items || !isRecent(filing.filedAt)) continue;

    const summary = describeEightK(filing.items);
    for (const item of summary.items) {
      if (item.severity !== "red-flag") continue;
      warnings.push({
        text: `${item.label}, in a filing on ${filing.filedAt}.`,
        evidence: `Form 8-K, item ${item.code}`,
        level: "severe",
        url: filing.url,
      });
    }
  }

  /* ---- what the published models flagged --------------------------------- */
  if (report?.beneish.value?.flagged) {
    warnings.push({
      text: ACCOUNTING_FLAG.text,
      evidence: `Beneish M-Score ${report.beneish.value.m.toFixed(2)}, above the −1.78 threshold`,
      level: "notable",
    });
  }

  if (report?.altman.value?.zone === "distress") {
    warnings.push({
      text: DISTRESS_FLAG.text,
      evidence: `Altman Z-Score ${report.altman.value.z.toFixed(2)}`,
      level: "notable",
    });
  }

  /* ---- what the people running it did ------------------------------------
     Only unscheduled open-market sales. A sale under a Rule 10b5-1 plan was
     arranged months in advance and says close to nothing about today, and
     reporting one as a warning would be actively misleading — which is the
     same distinction the early-signals panel is built around. */
  const unscheduledSales = insider.trades.filter(
    (t) =>
      !t.scheduled &&
      t.transactions.some((tx) => tx.isOpenMarketTrade && tx.direction === "disposed"),
  );

  if (unscheduledSales.length > 0) {
    const total = unscheduledSales
      .flatMap((t) => t.transactions)
      .filter((tx) => tx.isOpenMarketTrade && tx.direction === "disposed")
      .reduce((sum, tx) => sum + (tx.value ?? 0), 0);

    const who =
      unscheduledSales.length === 1
        ? unscheduledSales[0].ownerName
        : `${unscheduledSales.length} insiders`;

    warnings.push({
      text: `Recent open-market selling by ${who}, not under a pre-arranged plan.`,
      evidence:
        total > 0
          ? `${money(total, currency)} sold in the last ${RECENT_DAYS} days`
          : `Filed in the last ${RECENT_DAYS} days`,
      level: "notable",
      url: unscheduledSales[0].url,
    });
  }

  // Severe first, so the strongest thing is the first thing read.
  return warnings.sort((a, b) =>
    a.level === b.level ? 0 : a.level === "severe" ? -1 : 1,
  );
}
