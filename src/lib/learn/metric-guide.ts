/**
 * What each figure on a company page is, in five parts.
 *
 * Every explanation a reader can open answers the same five questions — what
 * the figure is, how it is worked out, why it matters, where it misleads, and
 * where this site got it — so no figure is explained better than another by
 * accident. The same entries are the reference section of /learn, and every
 * explanation links to its entry there, so a term learned once on a company
 * page can be looked up again later.
 *
 * Written to describe, never to advise. A limitation says where a figure
 * misleads, not what to do about a company that shows it.
 */

export type MetricGuideId =
  | "revenue"
  | "gross-margin"
  | "operating-margin"
  | "net-margin"
  | "free-cash-flow"
  | "fcf-margin"
  | "eps"
  | "net-debt"
  | "debt-to-equity"
  | "current-ratio"
  | "interest-cover"
  | "pe"
  | "ps"
  | "pb"
  | "price-to-fcf"
  | "roe"
  | "roa"
  | "share-count"
  | "piotroski"
  | "altman"
  | "beneish"
  | "dividend-yield"
  | "health-score";

export interface MetricGuide {
  id: MetricGuideId;
  name: string;
  what: string;
  how: string;
  why: string;
  limits: string;
  source: string;
}

const FROM_FILINGS =
  "The company's latest annual report — a 10-K, or a 40-F for a Canadian filer — read from SEC EDGAR's structured XBRL data.";

const FROM_FILINGS_AND_PRICE =
  "Market value from the latest share price, whose timing is labelled beside it at the top of the page, and the other figure from the company's latest annual report on SEC EDGAR.";

export const METRIC_GUIDE: Readonly<Record<MetricGuideId, MetricGuide>> = {
  revenue: {
    id: "revenue",
    name: "Revenue",
    what: "Everything customers paid the company over the period, before any costs come out.",
    how: "Reported directly by the company as its revenue, sales or turnover line.",
    why: "It is the top line every other figure is carved out of. Growth here is the raw material for growth everywhere else.",
    limits: "It says nothing about profit — a shop that sells $1M of goods has $1M of revenue even if those goods cost it $1.2M — and an acquisition can add revenue without the business itself growing.",
    source: FROM_FILINGS,
  },
  "gross-margin": {
    id: "gross-margin",
    name: "Gross margin",
    what: "The share of each sale left after the direct cost of producing what was sold.",
    how: "Gross profit divided by revenue. Where a company tags no gross profit, it is revenue less cost of revenue.",
    why: "It shows pricing power and production cost before overheads. It is usually the first place pressure on prices shows.",
    limits: "Industries differ enormously — software runs near 80%, supermarkets near 25% — so it only compares within an industry. Some companies, banks among them, report no cost of revenue at all.",
    source: FROM_FILINGS,
  },
  "operating-margin": {
    id: "operating-margin",
    name: "Operating margin",
    what: "The share of each sale left after running the business, before interest and tax.",
    how: "Operating income divided by revenue.",
    why: "It separates how the business performs from how it is financed and taxed.",
    limits: "Companies draw the operating line differently, and restructuring or impairment charges can land inside it in one year and not the next.",
    source: FROM_FILINGS,
  },
  "net-margin": {
    id: "net-margin",
    name: "Profit margin",
    what: "The share of each sale that survives to the very end, after every cost, interest payment and tax.",
    how: "Net income divided by revenue.",
    why: "It is what the business ultimately keeps, and the figure growth in sales has to translate into.",
    limits: "One-off items — a legal settlement, a tax charge, selling a division — move it without the business changing. Supermarkets run on thin margins and software companies on very wide ones, so it only compares within an industry.",
    source: FROM_FILINGS,
  },
  "free-cash-flow": {
    id: "free-cash-flow",
    name: "Free cash flow",
    what: "Cash left after running the business and paying for the buildings and equipment it needs.",
    how: "Cash from operations minus capital expenditure, with capital expenditure taken as an outflow whichever sign the filer tagged it with.",
    why: "It is the cash genuinely available for dividends, buybacks or paying down debt, and it is harder to flatter than profit.",
    limits: "Lumpy: a year of heavy investment can make a healthy company look cash-poor. Stock-based pay is not a cash cost, so it flatters this figure.",
    source: FROM_FILINGS,
  },
  "fcf-margin": {
    id: "fcf-margin",
    name: "Free cash flow margin",
    what: "The share of each sale that became spendable cash.",
    how: "Free cash flow divided by revenue.",
    why: "It compares cash generation between companies of different sizes.",
    limits: "It inherits every limitation of free cash flow, including the swings from years of heavy investment.",
    source: FROM_FILINGS,
  },
  eps: {
    id: "eps",
    name: "Earnings per share",
    what: "The profit attributable to each share.",
    how: "Net income divided by the shares in issue at the period end.",
    why: "It turns a company-sized profit into one a single holding can be measured against, and it is what the P/E ratio is built on.",
    limits: "A company's own reported EPS divides by the average share count across the year, so this sits close to it rather than exactly on it. Buybacks raise it with no growth in profit at all.",
    source: FROM_FILINGS,
  },
  "net-debt": {
    id: "net-debt",
    name: "Net debt",
    what: "What the company would still owe if it used every dollar of cash to repay its borrowings.",
    how: "Long-term plus short-term debt, minus cash and cash equivalents. Negative means more cash than debt.",
    why: "It is a better measure of borrowing than total liabilities, which include ordinary supplier bills and payments received in advance.",
    limits: "Cash here excludes short-term investments, where cash-rich companies keep much of their money, so it can overstate net debt. It is not meaningful for banks, whose deposits are their raw material.",
    source: FROM_FILINGS,
  },
  "debt-to-equity": {
    id: "debt-to-equity",
    name: "Debt to equity",
    what: "How much of the company is funded by what it owes rather than by its owners.",
    how: "Total liabilities divided by shareholders' equity.",
    why: "Heavy reliance on borrowed money magnifies both good and bad years.",
    limits: "It uses total liabilities, not just borrowings. Buybacks shrink equity and inflate the ratio without new debt, and negative equity makes the figure meaningless.",
    source: FROM_FILINGS,
  },
  "current-ratio": {
    id: "current-ratio",
    name: "Current ratio",
    what: "Whether the bills due within a year are covered by what can be turned into cash within a year.",
    how: "Current assets divided by current liabilities.",
    why: "Below 1 means more falls due this year than is readily available to pay it.",
    limits: "Plenty of healthy companies run below 1 because customers pay them before suppliers must be paid. Banks and insurers present no current split at all.",
    source: FROM_FILINGS,
  },
  "interest-cover": {
    id: "interest-cover",
    name: "Interest cover",
    what: "How many times over operating profit covers the interest bill.",
    how: "Operating income divided by interest expense.",
    why: "A company can carry debt for decades; it cannot survive long without earning its interest.",
    limits: "A company with no interest expense has no ratio, which is a different statement from a poor one. Interest rates resetting on floating-rate debt can change it quickly.",
    source: FROM_FILINGS,
  },
  pe: {
    id: "pe",
    name: "Price to earnings (P/E)",
    what: "What the market pays for each dollar of the company's yearly profit.",
    how: "Market value divided by net income — equivalently, share price divided by earnings per share.",
    why: "It is the most common shorthand for how much growth the market is already expecting. Two companies each earning $1 a share, priced at $10 and $50, have P/Es of 10 and 50 — the market is paying five times as much for the same profit.",
    limits: "It cannot be calculated for a company that loses money, one-off items distort it, and it is backward-looking: it uses last year's profit against today's price.",
    source: FROM_FILINGS_AND_PRICE,
  },
  ps: {
    id: "ps",
    name: "Price to sales (P/S)",
    what: "What the market pays for each dollar of yearly sales.",
    how: "Market value divided by revenue.",
    why: "It works for a company with no profit yet, where a P/E does not exist.",
    limits: "It ignores whether those sales make any money, so two companies with the same P/S can be in very different health.",
    source: FROM_FILINGS_AND_PRICE,
  },
  pb: {
    id: "pb",
    name: "Price to book (P/B)",
    what: "What the market pays for each dollar of the company's net worth on its balance sheet.",
    how: "Market value divided by shareholders' equity.",
    why: "It is a common reference point for banks and asset-heavy businesses, whose balance sheets carry most of their value.",
    limits: "Brands, software and research rarely appear on a balance sheet, so asset-light companies look expensive on this measure, and buybacks shrink book value.",
    source: FROM_FILINGS_AND_PRICE,
  },
  "price-to-fcf": {
    id: "price-to-fcf",
    name: "Price to free cash flow",
    what: "What the market pays for each dollar of cash the company actually generates.",
    how: "Market value divided by free cash flow, shown only when free cash flow is positive.",
    why: "Cash is harder to flatter than profit, so this is a useful check on a P/E.",
    limits: "Free cash flow swings with investment cycles, so one year can make the ratio look unusually high or low.",
    source: FROM_FILINGS_AND_PRICE,
  },
  roe: {
    id: "roe",
    name: "Return on equity",
    what: "The profit earned on what the owners have put into the company.",
    how: "Net income divided by shareholders' equity.",
    why: "It shows how effectively the owners' money is being used.",
    limits: "Debt and buybacks shrink equity, so very high figures often come from a heavily borrowed balance sheet rather than a better business. Negative equity makes it meaningless.",
    source: FROM_FILINGS,
  },
  roa: {
    id: "roa",
    name: "Return on assets",
    what: "The profit earned on everything the company owns.",
    how: "Net income divided by total assets.",
    why: "Unlike return on equity, borrowing cannot inflate it.",
    limits: "Banks and insurers hold enormous asset bases and naturally score low, and asset-light businesses naturally score high.",
    source: FROM_FILINGS,
  },
  "share-count": {
    id: "share-count",
    name: "Share count",
    what: "How many shares the company is divided into, and how that changed on a year earlier.",
    how: "Shares in issue at the period end, against the same figure a year before.",
    why: "New shares divide the company into more pieces, so each existing holding owns less; buybacks do the opposite.",
    limits: "A company with more than one share class may only report an average across the year, which moves more slowly than the count on any one date.",
    source: FROM_FILINGS,
  },
  piotroski: {
    id: "piotroski",
    name: "Piotroski F-Score",
    what: "Nine yes-or-no checks of whether a company's finances improved over the year.",
    how: "One point each for positive profit, positive cash flow, rising return on assets, cash flow above profit, falling debt, a rising current ratio, no new shares, a rising gross margin and rising asset turnover.",
    why: "Published by Joseph Piotroski in 2000 as a quick test of financial strength and direction. 8 or 9 describes strong and improving finances; 0 to 2 weak and deteriorating ones.",
    limits: "A check that needs a figure the company did not report is skipped, so the score is shown out of fewer than nine rather than counted as a failure. It measures direction, not size.",
    source: "Computed by WylthIQ from the company's two latest annual reports on SEC EDGAR.",
  },
  altman: {
    id: "altman",
    name: "Altman Z-Score",
    what: "A published model of how far a company sits from financial distress.",
    how: "A weighted sum of working capital, retained earnings, operating profit, market or book value and sales, each against total assets. The weights depend on which of Altman's variants applies. On the original model, above 2.99 is the safe zone, 1.81 to 2.99 grey, and below 1.81 distress; each variant has its own thresholds.",
    why: "Published by Edward Altman in 1968, it remains one of the most widely used measures of bankruptcy risk.",
    limits: "Fitted on manufacturers, so WylthIQ uses the non-manufacturing variant elsewhere, and omits it for banks and insurers entirely. It is a statistical screen, not a forecast.",
    source: "Computed by WylthIQ from the company's latest annual report on SEC EDGAR and, where available, its market value.",
  },
  beneish: {
    id: "beneish",
    name: "Beneish M-Score",
    what: "A statistical screen for accounting patterns resembling those of companies that later restated earnings.",
    how: "Eight ratios comparing this year with last — receivables, margins, asset quality, sales growth, depreciation, overheads, leverage and accruals — combined with published weights.",
    why: "Published by Messod Beneish in 1999. Above −1.78 flags patterns worth reading the filings for.",
    limits: "A flag is a prompt to read the filings, never evidence of wrongdoing; plenty of honest, fast-changing companies trip it. It needs two years of figures and is not meaningful for banks.",
    source: "Computed by WylthIQ from the company's two latest annual reports on SEC EDGAR.",
  },
  "dividend-yield": {
    id: "dividend-yield",
    name: "Dividend yield",
    what: "What the company paid out over the last twelve months, as a share of today's price.",
    how: "Dividends per share over the trailing twelve months divided by the current share price.",
    why: "It shows the income a holding produced at today's price.",
    limits: "It is trailing, not a promise: a dividend can be cut, and a falling price raises the yield on its own.",
    source: "Dividend payments per share from the price provider's payment history, against the latest share price.",
  },
  "health-score": {
    id: "health-score",
    name: "Financial health score",
    what: "WylthIQ's summary of four questions about the business: is it profitable, is it growing, how much debt does it carry, and are there accounting red flags.",
    how: "Each question is rated good, mixed or weak and scored 10, 6 or 2; the score is the average of the questions that could be assessed.",
    why: "It turns four separate answers into a single starting point, with the reasoning shown beside it.",
    limits: "A question with too little data is left out rather than guessed, so a score can rest on fewer than four answers. Valuation is deliberately excluded: an expensive share price says nothing about the business underneath.",
    source: "Computed by WylthIQ from the company's latest annual report on SEC EDGAR.",
  },
};

/** Every guide, in a stable reading order. */
export const METRIC_GUIDES: readonly MetricGuide[] = Object.values(METRIC_GUIDE);

/** Where a guide lives on /learn. */
export function learnHref(id: MetricGuideId): string {
  return `/learn#${id}`;
}

/** The guide for a What Changed measure, when there is one. */
export function guideForChange(key: string): MetricGuideId | null {
  const map: Record<string, MetricGuideId> = {
    revenue: "revenue",
    grossMargin: "gross-margin",
    operatingMargin: "operating-margin",
    netMargin: "net-margin",
    freeCashFlow: "free-cash-flow",
    eps: "eps",
    sharesOutstanding: "share-count",
  };
  return map[key] ?? null;
}
