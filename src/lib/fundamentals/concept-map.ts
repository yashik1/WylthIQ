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
    // The spelling 87 filers here actually use, leases included.
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization",
    // A landlord's plant is its buildings: Prologis, Realty Income, Simon and
    // eleven more tag this and never PropertyPlantAndEquipmentNet.
    "RealEstateInvestmentPropertyNet",
  ],

  longTermDebt: [
    "LongTermDebtNoncurrent",
    "LongTermDebt",
    "NoncurrentPortionOfNoncurrentBorrowings",
    "LongtermBorrowings",
    "NoncurrentBorrowings",
    // Leases folded in with the borrowings, which is how 78 filers here tag
    // it. Last, so anybody tagging debt on its own is read that way instead.
    "LongTermDebtAndCapitalLeaseObligations",
  ],

  shortTermDebt: [
    "LongTermDebtCurrent",
    "ShortTermBorrowings",
    "DebtCurrent",
    "ShorttermBorrowings",
    "CurrentPortionOfLongtermBorrowings",
    "CommercialPaper",
    "LongTermDebtAndCapitalLeaseObligationsCurrent",
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
    /*
      Last, and only for filers who tag nothing above.

      A bank's top line is revenue after the interest it pays out, which is
      what `RevenuesNetOfInterestExpense` holds — Goldman, Morgan Stanley and
      Wells Fargo tag that and nothing else. Their gross interest income is
      deliberately not used instead: it is a bigger number that is not the
      revenue anybody compares a bank on. A regulated utility's equivalent is
      the last entry.
    */
    "RevenuesNetOfInterestExpense",
    "RegulatedAndUnregulatedOperatingRevenue",
  ],

  costOfRevenue: [
    "CostOfGoodsAndServicesSold",
    "CostOfRevenue",
    "CostOfSales",
    "CostOfGoodsSold",
    /*
      Cost of sales with depreciation left out, which 22 filers here tag and
      no plainer alternative. Gross profit derived from it runs a little high,
      because the depreciation on the plant that made the goods sits below the
      line instead of in it — but a gross margin that is slightly generous is
      worth more to a reader than no gross margin at all, and it is the same
      convention most data vendors publish.
    */
    "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization",
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

  /*
    Only the cost of borrowing, and only from the income statement.

    Two tempting concepts are left out. `InterestIncomeExpenseNet` is a bank's
    net interest income — a revenue line wearing a similar name, and reading it
    as an expense would invert what it says. `InterestPaidNet` is real and
    would fill this field for 263 more companies, but it is cash paid out of
    the cash flow statement rather than the charge in the accounts, and this
    field feeds the EBIT inside the Altman score as well as interest cover.
  */
  interestExpense: [
    "InterestExpense",
    "FinanceCosts",
    "InterestExpenseDebt",
    "InterestAndDebtExpense",
    "InterestExpenseNonoperating",
    "InterestExpenseBorrowings",
    "InterestExpenseDebtExcludingAmortization",
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

  /*
    Money spent on the assets the business runs on.

    The three below cover an industrial or a software company. A landlord and
    an oil producer spend on different things and tag them differently, which
    is why free cash flow was blank for most of the real estate and energy
    sectors. Buying a finished building (`PaymentsToAcquireRealEstate`) is left
    out deliberately: that is an acquisition, the same kind of growth spending
    as buying a company, and the convention everywhere is to keep it out of
    capital expenditure.
  */
  capex: [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
    "PaymentsToAcquireProductiveAssets",
    "PaymentsForCapitalImprovements",
    "PaymentsToDevelopRealEstateAssets",
    "PaymentsToAcquireOilAndGasPropertyAndEquipment",
    "PaymentsToExploreAndDevelopOilAndGasProperties",
    "PaymentsToAcquireOilAndGasProperty",
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

/**
 * Fields that are counts, not money.
 *
 * Kept beside the other field metadata because two different places need the
 * same answer: a snapshot rebuilding a fact's unit, and the currency
 * conversion deciding what it may multiply. SK hynix is why the second one
 * matters — Yahoo tags every figure it returns with the filer's currency,
 * including the share count, so a KRW→USD conversion that trusts the unit
 * alone turns 701 million shares into 512 thousand and every per-share figure
 * with it.
 */
export const COUNT_FIELDS: ReadonlySet<CanonicalField> = new Set(["sharesOutstanding"]);
