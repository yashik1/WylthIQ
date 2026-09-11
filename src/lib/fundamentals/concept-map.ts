import type { CanonicalField } from "./types";

/**
 * Maps each canonical field to the XBRL concepts that may carry it, in order of
 * preference. The first concept present in a filing wins.
 *
 * Both taxonomies are listed together on purpose. A single company can mix them
 * (Shopify files `us-gaap` despite being Canadian, Royal Bank files `ifrs-full`),
 * so resolution is by concept name across whatever the filer actually used
 * rather than by assuming a taxonomy up front.
 */
export const CONCEPT_MAP: Record<CanonicalField, string[]> = {
  // ---------------------------------------------------------------- balance sheet
  assets: ["Assets"],

  // Many us-gaap filers never tag total liabilities. `normalize` derives it from
  // assets - equity when every candidate below is absent.
  //
  // `LiabilitiesAndStockholdersEquity` is deliberately NOT listed here: despite
  // the name it is the balance sheet total (equal to total assets), so treating
  // it as total liabilities roughly doubles a company's apparent debt.
  liabilities: ["Liabilities"],

  equity: [
    "StockholdersEquity",
    "Equity",
    "EquityAttributableToOwnersOfParent",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ],

  // Absent for banks and insurers, which present unclassified balance sheets.
  // Scores that depend on working capital are suppressed rather than guessed.
  currentAssets: ["AssetsCurrent", "CurrentAssets"],
  currentLiabilities: ["LiabilitiesCurrent", "CurrentLiabilities"],

  cash: [
    "CashAndCashEquivalentsAtCarryingValue",
    "CashAndCashEquivalents",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndBalancesWithCentralBanks",
  ],

  receivables: [
    "AccountsReceivableNetCurrent",
    "TradeAndOtherCurrentReceivables",
    "ReceivablesNetCurrent",
    "TradeAndOtherReceivables",
    "AccountsReceivableGrossCurrent",
  ],

  inventory: ["InventoryNet", "Inventories"],

  ppe: [
    "PropertyPlantAndEquipmentNet",
    "PropertyPlantAndEquipment",
    "PropertyPlantAndEquipmentIncludingRightofuseAssetAfterAccumulatedDepreciationAndAmortization",
  ],

  longTermDebt: [
    "LongTermDebtNoncurrent",
    "LongTermDebt",
    "NoncurrentPortionOfNoncurrentBorrowings",
    "LongtermBorrowings",
    "NoncurrentBorrowings",
  ],

  shortTermDebt: [
    "LongTermDebtCurrent",
    "ShortTermBorrowings",
    "DebtCurrent",
    "ShorttermBorrowings",
    "CurrentPortionOfLongtermBorrowings",
    "CommercialPaper",
  ],

  retainedEarnings: ["RetainedEarningsAccumulatedDeficit", "RetainedEarnings"],

  // ------------------------------------------------------------- income statement
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "Revenue",
    "RevenueFromContractsWithCustomers",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
    "TotalRevenues",
  ],

  costOfRevenue: [
    "CostOfGoodsAndServicesSold",
    "CostOfRevenue",
    "CostOfSales",
    "CostOfGoodsSold",
  ],

  grossProfit: ["GrossProfit"],

  operatingIncome: [
    "OperatingIncomeLoss",
    "ProfitLossFromOperatingActivities",
  ],

  netIncome: [
    "NetIncomeLoss",
    "ProfitLoss",
    "ProfitLossAttributableToOwnersOfParent",
    "NetIncomeLossAvailableToCommonStockholdersBasic",
  ],

  incomeBeforeTax: [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "ProfitLossBeforeTax",
  ],

  interestExpense: [
    "InterestExpense",
    "FinanceCosts",
    "InterestExpenseDebt",
    "InterestAndDebtExpense",
  ],

  sga: [
    "SellingGeneralAndAdministrativeExpense",
    "GeneralAndAdministrativeExpense",
    "AdministrativeExpense",
  ],

  depreciation: [
    "DepreciationDepletionAndAmortization",
    "DepreciationAndAmortisationExpense",
    "DepreciationAmortizationAndAccretionNet",
    "Depreciation",
  ],

  // ------------------------------------------------------------------- cash flow
  operatingCashFlow: [
    "NetCashProvidedByUsedInOperatingActivities",
    "CashFlowsFromUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ],

  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PaymentsToAcquireProductiveAssets",
  ],

  dividendsPaid: [
    "PaymentsOfDividends",
    "PaymentsOfDividendsCommonStock",
    "DividendsPaidClassifiedAsFinancingActivities",
    "DividendsPaid",
  ],

  // ----------------------------------------------------------------- share data
  sharesOutstanding: [
    "CommonStockSharesOutstanding",
    "EntityCommonStockSharesOutstanding",
    "NumberOfSharesOutstanding",
    "WeightedAverageNumberOfSharesOutstandingBasic",
    "WeightedAverageNumberOfDilutedSharesOutstanding",
    "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
  ],
};

/**
 * Concepts reported over a period even though their field is a point-in-time
 * measure.
 *
 * `sharesOutstanding` is the only hybrid in the map. A share count is normally
 * an instant, but a filer with more than one class of stock often tags the
 * instants per class and reports the consolidated figure only as an average
 * over the year. Shopify is exactly that: `CommonStockSharesOutstanding` has
 * two observations in its entire filing history, while the weighted averages
 * have thirty and are current. Judging the shape from the field alone threw
 * away the only usable number, which left the company with no market value —
 * and, downstream, no P/E, no P/B and no answer to "is it cheap or expensive?".
 *
 * A yearly average is not the same as the count on the closing date, so it sits
 * below every instant concept in preference order and is reached only when no
 * instant is available.
 */
export const DURATION_CONCEPTS: ReadonlySet<string> = new Set([
  "WeightedAverageNumberOfSharesOutstandingBasic",
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
]);

/**
 * Fields for which a non-positive value is meaningless and indicates a filing
 * error rather than a real figure.
 *
 * This is not hypothetical: Royal Bank of Canada's FY2020 40-F reports
 * `EntityCommonStockSharesOutstanding = 0` on its cover page. Taken at face
 * value that turns every per-share figure into Infinity, so such observations
 * are discarded and the field falls back to the next candidate concept.
 */
export const MUST_BE_POSITIVE: ReadonlySet<CanonicalField> = new Set([
  "assets",
  "sharesOutstanding",
]);

/**
 * Fields representing a flow over a period rather than a balance at a point in
 * time. These carry a `start` date in XBRL and must be matched to roughly a full
 * year when building annual periods.
 */
export const DURATION_FIELDS: ReadonlySet<CanonicalField> = new Set([
  "revenue",
  "costOfRevenue",
  "grossProfit",
  "operatingIncome",
  "netIncome",
  "incomeBeforeTax",
  "interestExpense",
  "sga",
  "depreciation",
  "operatingCashFlow",
  "capex",
  "dividendsPaid",
]);

/**
 * Quarterly report forms.
 *
 * Only the domestic 10-Q. A foreign private issuer's interim results arrive on
 * a 6-K, which carries no XBRL financial statements, so a Canadian 40-F filer
 * has no quarterly figures here by construction rather than by omission.
 */
export const QUARTERLY_FORMS: ReadonlySet<string> = new Set(["10-Q", "10-Q/A"]);

/** Annual report forms. `40-F` and `20-F` are the foreign private issuer variants. */
export const ANNUAL_FORMS: ReadonlySet<string> = new Set([
  "10-K",
  "10-K/A",
  "20-F",
  "20-F/A",
  "40-F",
  "40-F/A",
]);
