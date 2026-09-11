import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import { money, multiple, percent } from "../format";
import type { MetricGuideId } from "../learn/metric-guide";
import { altmanZScore } from "./altman";
import { type SectorKind } from "./applicability";
import { beneishMScore } from "./beneish";
import { div, round, sub } from "./math";
import { piotroskiFScore } from "./piotroski";
import { freeCashFlowOf } from "./returns";
import type { AltmanResult, BeneishResult, PiotroskiResult, Rating, ScoreResult } from "./types";

/** One of the five plain-English questions shown on a stock page. */
export interface Question {
  key: "profitable" | "growing" | "debt" | "valuation" | "accounting";
  question: string;
  /** One sentence a non-expert can act on, written in plain language. */
  answer: string;
  rating: Rating;
  /**
   * Supporting figures, each safe to show without further explanation.
   * `guide` names the shared metric-guide entry that explains the figure in
   * full, when there is one.
   */
  metrics: { label: string; value: string; hint: string; guide?: MetricGuideId }[];
}

export interface HealthReport {
  /** 0-10, or null when too little was reported to judge. */
  score: number | null;
  headline: string;
  questions: Question[];
  piotroski: PiotroskiResult;
  altman: ScoreResult<AltmanResult>;
  beneish: ScoreResult<BeneishResult>;
  /** Link to the filing the figures were taken from. */
  sourceFilingUrl: string | null;
  fiscalYear: number | null;
}

const RATING_POINTS: Record<Rating, number | null> = {
  good: 10,
  fair: 6,
  poor: 2,
  unknown: null,
};

/**
 * Builds the full plain-English health report for one company.
 *
 * Deliberately descriptive, never prescriptive: every sentence describes what
 * the filings say, and none suggests buying or selling. Anything that cannot be
 * computed says so rather than guessing.
 */
export function buildHealthReport(
  fundamentals: NormalizedFundamentals,
  sector: SectorKind,
  marketCap: number | null,
): HealthReport {
  // Statements are reported in the filer's own currency — CAD for a Canadian
  // company — and labelling those figures with a plain "$" reads as USD, which
  // is simply wrong. The unit travels on every fact, so it is read from there.
  const currency = fundamentals.annual[0]?.facts.assets?.unit ?? "USD";
  const amount = (value: number | null | undefined) => money(value, currency);
  const current = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  const f = (k: Parameters<typeof fieldValue>[1]) => fieldValue(current, k);
  const p = (k: Parameters<typeof fieldValue>[1]) => fieldValue(prior, k);

  const piotroski = piotroskiFScore(current, prior);
  const altman = altmanZScore(current, sector, marketCap);
  const beneish = beneishMScore(current, prior, sector);

  const questions: Question[] = [
    profitabilityQuestion(f, amount),
    growthQuestion(f, p, fundamentals, amount),
    debtQuestion(f, altman, sector, amount),
    valuationQuestion(f, marketCap),
    accountingQuestion(beneish),
  ];

  // Valuation is deliberately excluded from the health score. Whether a share
  // price is high is a separate question from whether the business is sound —
  // an excellent company can be expensive, and blending the two would make the
  // headline number mean neither thing clearly. Valuation is still shown, just
  // scored on its own.
  const points = questions
    .filter((q) => q.key !== "valuation")
    .map((q) => RATING_POINTS[q.rating])
    .filter((v): v is number => v !== null);
  const score = points.length
    ? round(points.reduce((a, b) => a + b, 0) / points.length, 1)
    : null;

  return {
    score,
    headline: headlineFor(score, fundamentals.entityName),
    questions,
    piotroski,
    altman,
    beneish,
    sourceFilingUrl: current?.facts.assets?.sourceFilingUrl ?? null,
    fiscalYear: current?.fiscalYear ?? null,
  };
}

function headlineFor(score: number | null, name: string): string {
  if (score == null) return `${name} has not reported enough data to assess.`;
  if (score >= 8) return "Strong finances across the board.";
  if (score >= 6.5) return "Generally healthy, with a few things to watch.";
  if (score >= 4.5) return "A mixed picture — some clear strengths and some weaknesses.";
  if (score >= 3) return "Several areas of financial weakness.";
  return "Significant financial weakness across most measures.";
}

type Getter = (k: Parameters<typeof fieldValue>[1]) => number | null;
/** Formats an amount in the filing's own currency. */
type Amount = (value: number | null | undefined) => string;

function profitabilityQuestion(f: Getter, amount: Amount): Question {
  const netIncome = f("netIncome");
  const revenue = f("revenue");
  const margin = div(netIncome, revenue);
  const roa = div(netIncome, f("assets"));
  const ocf = f("operatingCashFlow");
  // Capex is an outflow, but a minority of filers tag it negative — taken as
  // written, those companies would appear to generate cash by spending it.
  const capexRaw = f("capex");
  const capex = capexRaw == null ? null : Math.abs(capexRaw);
  const freeCashFlow = freeCashFlowOf(ocf, capexRaw);

  let rating: Rating = "unknown";
  let answer = "This company has not reported enough detail to tell.";

  if (netIncome != null && margin != null) {
    const cents = Math.round(Math.abs(margin) * 100);
    if (netIncome > 0) {
      rating = margin >= 0.1 ? "good" : "fair";
      answer =
        `Yes. It keeps about ${cents} cents of every dollar of sales as profit, ` +
        `earning ${amount(netIncome)} last year.`;
    } else {
      rating = "poor";
      answer =
        `No. It lost ${amount(Math.abs(netIncome))} last year, ` +
        `losing about ${cents} cents on every dollar of sales.`;
    }
    if (ocf != null && ocf < 0 && netIncome > 0) {
      answer += " Note that operations still consumed cash despite the reported profit.";
      rating = "fair";
    } else if (freeCashFlow != null && freeCashFlow < 0 && netIncome > 0) {
      /*
        Profitable on paper, and still consuming cash once the plant it runs
        on is paid for.

        This is a genuinely different situation from a loss and from negative
        operating cash flow, and the page could not describe it at all before
        — capex was ingested and never read, so the gap between what
        operations produced and what the business actually kept was invisible.
      */
      answer +=
        ` Note that after ${amount(capex!)} of spending on property and equipment, ` +
        `it consumed ${amount(Math.abs(freeCashFlow))} more cash than it generated.`;
      rating = "fair";
    }
  } else if (netIncome != null) {
    rating = netIncome > 0 ? "good" : "poor";
    answer = netIncome > 0
      ? `Yes. It earned ${amount(netIncome)} last year.`
      : `No. It lost ${amount(Math.abs(netIncome))} last year.`;
  }

  return {
    key: "profitable",
    question: "Is it profitable?",
    answer,
    rating,
    metrics: [
      { label: "Net profit margin", value: percent(margin), hint: "Out of every $100 of sales, this much is left over as profit.", guide: "net-margin" },
      { label: "Return on assets", value: percent(roa), hint: "How hard everything the company owns is working — profit earned per $100 of assets.", guide: "roa" },
      { label: "Operating cash flow", value: amount(ocf), hint: "Real money that landed in the bank, after paying bills and wages. Harder to massage than profit." },
      {
        label: "Free cash flow",
        value: amount(freeCashFlow),
        hint: "What is left after also paying for the buildings and equipment the business needs. The cash genuinely available for dividends, buybacks or paying down debt.",
        guide: "free-cash-flow",
      },
    ],
  };
}

function growthQuestion(
  f: Getter,
  p: Getter,
  fundamentals: NormalizedFundamentals,
  amount: Amount,
): Question {
  const revNow = f("revenue");
  const revPrior = p("revenue");
  const growth = revNow != null && revPrior != null && revPrior !== 0
    ? (revNow - revPrior) / Math.abs(revPrior)
    : null;

  // Three-year compound growth, when enough history exists.
  const older = fundamentals.annual[3];
  const revOlder = older ? fieldValue(older, "revenue") : null;
  const cagr = revNow != null && revOlder != null && revOlder > 0
    ? (revNow / revOlder) ** (1 / 3) - 1
    : null;

  let rating: Rating = "unknown";
  let answer = "Not enough history has been reported to judge growth.";

  if (growth != null) {
    const pct = Math.abs(growth * 100).toFixed(1);
    if (growth >= 0.15) {
      rating = "good";
      answer = `Yes, quickly. Sales grew ${pct}% last year.`;
    } else if (growth >= 0.03) {
      rating = "fair";
      answer = `Slowly. Sales grew ${pct}% last year.`;
    } else if (growth >= 0) {
      rating = "fair";
      answer = `Barely. Sales were roughly flat, up ${pct}%.`;
    } else {
      rating = "poor";
      answer = `No. Sales shrank ${pct}% last year.`;
    }
  }

  return {
    key: "growing",
    question: "Is it growing?",
    answer,
    rating,
    metrics: [
      { label: "Revenue growth (1y)", value: percent(growth), hint: "Whether the company sold more or less than it did a year ago." },
      { label: "Revenue growth (3y avg)", value: percent(cagr), hint: "Average yearly growth over three years — steadier than any single year." },
      { label: "Revenue", value: amount(revNow), hint: "Everything customers paid it over the year, before any costs come out.", guide: "revenue" },
    ],
  };
}

/**
 * Debt assessment.
 *
 * Rated on actual borrowings net of cash, measured against the cash flow
 * available to repay them — not on total liabilities. Total liabilities include
 * trade payables and deferred revenue, which are ordinary operating items rather
 * than debt; judging by that measure alone rates cash-rich companies such as
 * Apple as distressed, which is plainly wrong.
 *
 * The "for every $1 it owes" sentence is still shown, because it is the clearest
 * summary of the balance sheet, but it no longer drives the rating on its own.
 */
function debtQuestion(
  f: Getter,
  altman: ScoreResult<AltmanResult>,
  sector: SectorKind,
  amount: Amount,
): Question {
  const assets = f("assets");
  const liabilities = f("liabilities");
  const equity = f("equity");
  const cash = f("cash");
  const ocf = f("operatingCashFlow");

  const coverage = div(assets, liabilities);
  const debtToEquity = div(liabilities, equity);
  const currentRatio = div(f("currentAssets"), f("currentLiabilities"));

  const longTerm = f("longTermDebt");
  const shortTerm = f("shortTermDebt");
  const totalDebt =
    longTerm == null && shortTerm == null ? null : (longTerm ?? 0) + (shortTerm ?? 0);
  const netDebt = totalDebt == null ? null : totalDebt - (cash ?? 0);
  const yearsToRepay = netDebt != null && netDebt > 0 ? div(netDebt, ocf) : null;

  /*
    Whether the interest is affordable at all, which is a more immediate
    question than how long the principal would take to clear — a company can
    carry debt for decades quite happily, and cannot survive a year of not
    covering the interest on it.

    `interestExpense` was already being ingested for the Altman calculation
    and never surfaced anywhere a reader could see it.
  */
  const interest = f("interestExpense");
  const operatingIncome = f("operatingIncome");
  const interestCover =
    interest != null && interest > 0 ? div(operatingIncome, interest) : null;

  let rating: Rating = "unknown";
  let answer = "This company has not reported enough detail to tell.";
  const owns = coverage != null ? coverage.toFixed(2) : null;
  const ownsLine = owns ? `For every $1 it owes, it owns $${owns} in assets.` : "";

  if (sector === "financial") {
    rating = coverage != null && coverage >= 1.05 ? "fair" : "poor";
    answer =
      `${ownsLine} Banks and insurers always carry high debt — that is how lending ` +
      `works — so this is normal for the industry and not comparable with other sectors.`;
  } else if (netDebt != null && netDebt <= 0) {
    rating = "good";
    answer =
      `No — it holds more cash than debt, with ${amount(Math.abs(netDebt))} left over ` +
      `after paying off every borrowing. ${ownsLine}`;
  } else if (yearsToRepay != null && yearsToRepay > 0) {
    const yrs = yearsToRepay.toFixed(1);
    if (yearsToRepay < 1) {
      rating = "good";
      answer = `No. Its borrowings would take under a year of cash flow to clear. ${ownsLine}`;
    } else if (yearsToRepay < 3) {
      rating = "good";
      answer = `No. At its current cash flow it could clear its debt in about ${yrs} years. ${ownsLine}`;
    } else if (yearsToRepay < 6) {
      rating = "fair";
      answer = `Manageable, but notable. Clearing its debt would take about ${yrs} years of cash flow. ${ownsLine}`;
    } else {
      rating = "poor";
      answer = `Yes. Clearing its debt would take roughly ${yrs} years of cash flow. ${ownsLine}`;
    }
  } else if (netDebt != null && netDebt > 0 && ocf != null && ocf <= 0) {
    rating = "poor";
    answer = `Yes — it carries debt while operations are consuming cash rather than generating it. ${ownsLine}`;
  } else if (coverage != null) {
    // Debt not broken out; fall back to the balance-sheet-wide view.
    if (coverage >= 2) {
      rating = "good";
      answer = `It does not appear so. ${ownsLine}`;
    } else if (coverage >= 1.3) {
      rating = "fair";
      answer = `Manageable. ${ownsLine}`;
    } else if (coverage > 1) {
      rating = "fair";
      answer = `It is tight. ${ownsLine}`;
    } else {
      rating = "poor";
      answer = `Yes. It owes more than it owns — only $${owns} in assets for every $1 of liabilities.`;
    }
  }

  /*
    A thin interest cover overrides a comfortable-looking repayment figure.
    Both can be true at once: a company whose borrowings are small against
    its cash flow can still be paying more in interest than it earns, and
    that is the more urgent of the two facts.
  */
  if (interestCover != null && interestCover < 1 && rating !== "unknown") {
    rating = "poor";
    answer +=
      ` Its operating profit does not cover its interest bill — ${multiple(interestCover)} ` +
      `against the interest it owes.`;
  } else if (interestCover != null && interestCover < 2.5 && rating === "good") {
    rating = "fair";
    answer += ` Its operating profit covers the interest ${multiple(interestCover)} over, which is not much room.`;
  }

  if (altman.value?.zone === "distress" && rating !== "unknown") {
    rating = "poor";
    answer += " A bankruptcy-risk model also places it in its distress range.";
  }

  return {
    key: "debt",
    question: "Is it drowning in debt?",
    answer: answer.trim(),
    rating,
    metrics: [
      // Net debt is meaningless for a bank: customer deposits are its raw
      // material, not borrowings, and are never tagged as debt.
      {
        label: "Net debt",
        value: sector === "financial" ? "n/a for banks" : netDebt == null ? "—" : amount(netDebt),
        hint: "What it would still owe if it spent every dollar of cash on repaying debt.",
        guide: "net-debt",
      },
      {
        label: "Years of cash flow to repay",
        value:
          sector === "financial"
            ? "n/a for banks"
            : yearsToRepay != null
              ? yearsToRepay.toFixed(1)
              : netDebt != null && netDebt <= 0
                ? "None needed"
                : "—",
        hint: "At its current rate of earning cash, how many years to become debt-free.",
      },
      { label: "Assets per $1 of liabilities", value: multiple(coverage), hint: "For every $1 of bills and debts, how many dollars of things it owns." },
      { label: "Debt to equity", value: multiple(debtToEquity), hint: "How much is funded by borrowing versus by the owners themselves.", guide: "debt-to-equity" },
      { label: "Current ratio", value: multiple(currentRatio), hint: "Whether it can cover the bills due this year with what it can turn into cash this year.", guide: "current-ratio" },
      {
        label: "Interest cover",
        value: interestCover == null ? "no debt costs" : `${multiple(interestCover)}`,
        hint: "How many times over its operating profit covers its interest bill. Below 1 means it is not earning enough to pay the interest.",
        guide: "interest-cover",
      },
    ],
  };
}

// Takes no currency formatter, unlike its siblings: every figure it reports is
// a ratio of one money amount to another, so the units cancel and there is
// nothing here to label.
function valuationQuestion(f: Getter, marketCap: number | null): Question {
  const netIncome = f("netIncome");
  const equity = f("equity");
  const revenue = f("revenue");
  const pe = netIncome != null && netIncome > 0 ? div(marketCap, netIncome) : null;
  const pb = div(marketCap, equity);
  const ps = div(marketCap, revenue);

  let rating: Rating = "unknown";
  // Distinguish "we have no price" from "there are no profits to compare to" —
  // the first is a setup gap, the second is a fact about the company.
  let answer =
    marketCap == null
      ? "No share price is available, so this company cannot be valued here. " +
        "Valuation needs a price source — see the setup notes for adding a free key."
      : "A price could not be compared with earnings for this company.";

  if (pe != null) {
    const v = pe.toFixed(1);
    if (pe < 15) {
      rating = "good";
      answer = `On the cheaper side. Investors pay $${v} for every $1 of yearly profit.`;
    } else if (pe < 30) {
      rating = "fair";
      answer = `Around average. Investors pay $${v} for every $1 of yearly profit.`;
    } else {
      rating = "poor";
      answer =
        `Expensive. Investors pay $${v} for every $1 of yearly profit, ` +
        `so a lot of future growth is already priced in.`;
    }
  } else if (netIncome != null && netIncome <= 0) {
    rating = "unknown";
    answer =
      "It has no profits to compare a price against, because it lost money last year.";
  }

  return {
    key: "valuation",
    question: "Is it cheap or expensive?",
    answer,
    rating,
    metrics: [
      { label: "Price to earnings", value: multiple(pe), hint: "How many years of current profits it would take to earn back the share price.", guide: "pe" },
      { label: "Price to book", value: multiple(pb), hint: "What you pay for each $1 of what the company actually owns, after debts.", guide: "pb" },
      { label: "Price to sales", value: multiple(ps), hint: "What you pay for each $1 of yearly sales, regardless of whether those sales make a profit.", guide: "ps" },
    ],
  };
}

function accountingQuestion(beneish: ScoreResult<BeneishResult>): Question {
  let rating: Rating = "unknown";
  let answer =
    beneish.reason ?? "There is not enough history to check the accounting for warning signs.";

  if (beneish.value) {
    if (beneish.value.flagged) {
      rating = "poor";
      answer =
        "Some accounting patterns here resemble those found in companies that " +
        "overstated earnings. This is a statistical flag, not evidence of wrongdoing — " +
        "it is a prompt to read the filings closely.";
    } else {
      rating = beneish.value.rating === "good" ? "good" : "fair";
      answer =
        "Nothing unusual. Its accounting patterns look like those of companies " +
        "that report earnings straightforwardly.";
    }
  }

  return {
    key: "accounting",
    question: "Are there accounting red flags?",
    answer,
    rating,
    metrics: [
      {
        label: "Beneish M-Score",
        value: beneish.value ? beneish.value.m.toFixed(2) : "—",
        hint: "A statistical check for accounting that looks unusual. Below -1.78 is normal.",
        guide: "beneish",
      },
    ],
  };
}

/** Convenience: net-debt style summary used by the balance sheet visual. */
export function balanceSheetSummary(fundamentals: NormalizedFundamentals) {
  const current = fundamentals.annual[0];
  const assets = fieldValue(current, "assets");
  const liabilities = fieldValue(current, "liabilities");
  const equity = fieldValue(current, "equity") ?? sub(assets, liabilities);
  return { assets, liabilities, equity, current };
}
