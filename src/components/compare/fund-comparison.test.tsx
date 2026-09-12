import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FundComparisonCard } from "./fund-comparison";
import type { FundComparison, FundFacts } from "@/lib/etf/compare-funds";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

/**
 * Three Canadian dividend ETFs, as a reader would compare them.
 *
 * What is worth pinning is the restraint: a row is marked only where leading
 * it is a fact, ties are marked together, the window every return covers is
 * stated, and nothing anywhere tells the reader which fund to hold.
 */

const fund = (over: Partial<FundFacts>): FundFacts => ({
  symbol: "VDY",
  name: "Vanguard FTSE Canadian High Dividend Yield Index ETF",
  currency: "CAD",
  price: 76.72,
  fee: 0.0022,
  feeSource: "Vanguard Canada",
  launched: null,
  firstPriced: "2012-11-05",
  holdingCount: 60,
  topTenWeight: 0.693,
  netAssets: 9_000_000_000,
  netAssetsCurrency: "CAD",
  frequency: "Monthly",
  trailingYield: 0.031,
  paymentsCounted: 12,
  includesDividends: false,
  returns: [
    { label: "1 year", years: 1, total: 0.5353, perYear: null, from: "2025-09-11" },
    { label: "3 years", years: 3, total: 0.62, perYear: 0.1743, from: "2023-09-11" },
    { label: "5 years", years: 5, total: 1.44, perYear: 0.1959, from: "2021-09-11" },
    { label: "10 years", years: 10, total: 3.0, perYear: 0.1486, from: "2016-09-11" },
    { label: "Whole history", years: null, total: 2.13, perYear: 0.0859, from: "2012-11-05" },
  ],
  ...over,
});

const comparison: FundComparison = {
  asOf: "2026-09-11",
  mixedCurrency: false,
  mixedBasis: false,
  funds: [
    fund({}),
    fund({
      symbol: "XEI",
      name: "iShares S&P/TSX Composite High Dividend Index ETF",
      fee: 0.0022,
      feeSource: "iShares Canada",
      launched: "2011-04-12",
      holdingCount: 75,
      topTenWeight: 0.4561,
      trailingYield: 0.0337,
      returns: fund({}).returns.map((r) => ({ ...r, total: (r.total ?? 0) * 0.8 })),
    }),
    fund({
      symbol: "ZDV",
      name: "BMO Canadian Dividend ETF",
      fee: null,
      feeSource: null,
      holdingCount: null,
      topTenWeight: null,
      netAssets: null,
      trailingYield: 0.0296,
      returns: fund({}).returns.map((r) => ({ ...r, total: (r.total ?? 0) * 0.7 })),
    }),
  ],
};

const html = renderToStaticMarkup(<FundComparisonCard comparison={comparison} />);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the fund comparison card", () => {
  it("asks the questions a fund can answer", () => {
    for (const row of [
      "Price",
      "Fee, a year",
      "Yield, last 12 months",
      "Pays",
      "Record starts",
      "Holdings",
      "Top 10 weight",
      "Fund size",
      "1 year",
      "Whole history",
    ]) {
      expect(text, row).toContain(row);
    }
  });

  it("marks a tie on both funds rather than picking one", () => {
    expect(text.match(/Cheapest/g)).toHaveLength(2);
  });

  it("marks the single leader of a row", () => {
    expect(text.match(/Most/g)).toHaveLength(1);
  });

  it("leaves concentration unmarked, because it is a preference", () => {
    expect(text).toContain("no fund leads this row");
  });

  it("says what date the returns are measured to, and on what basis", () => {
    expect(text).toMatch(/measured to .*Sep.*2026/);
    expect(text).toContain("distributions are not counted");
  });

  it("shows a blank rather than a zero where a manager published nothing", () => {
    expect(text).toContain("—");
    expect(text).toContain("not published to a source this page reads");
  });

  it("says where each whole-history column starts, since they differ", () => {
    expect(text).toMatch(/from .*Nov.*2012/);
  });

  it("shows when a fund's prices start well after it launched", () => {
    const late = renderToStaticMarkup(
      <FundComparisonCard
        comparison={{
          ...comparison,
          funds: comparison.funds.map((f) =>
            f.symbol === "XEI" ? { ...f, firstPriced: "2012-01-23" } : f,
          ),
        }}
      />,
    );
    expect(late.replace(/<[^>]+>/g, " ")).toMatch(/prices from .*Jan.*2012/);
  });

  it("never tells the reader which one to hold", () => {
    expect(text).not.toMatch(/\b(buy|sell|best for you|you should|recommend|winner)\b/i);
  });
});

describe("when the funds are not directly comparable", () => {
  it("says so when they are priced in different currencies", () => {
    const mixed = renderToStaticMarkup(
      <FundComparisonCard comparison={{ ...comparison, mixedCurrency: true }} />,
    );
    expect(mixed).toContain("different currencies");
  });

  it("warns when one series has distributions in it and another does not", () => {
    const mixed = renderToStaticMarkup(
      <FundComparisonCard comparison={{ ...comparison, mixedBasis: true }} />,
    );
    expect(mixed.replace(/<[^>]+>/g, " ")).toContain("not on the same basis");
  });
});
