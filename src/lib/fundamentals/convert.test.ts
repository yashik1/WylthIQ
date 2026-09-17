import { describe, expect, it } from "vitest";
import { convertFundamentals } from "./convert";
import type { Fact, NormalizedFundamentals } from "./types";

/**
 * Restating a filer's figures in the currency its shares trade in.
 *
 * SK hynix keeps its books in won and lists in New York, so ₩42.92T is faithful
 * to the filing and close to useless to somebody buying it in dollars.
 *
 * The dangerous part is the share count, which sits in the same record as the
 * monetary fields but is a count, not money. Converting it would corrupt market
 * value and every per-share figure downstream.
 */
const fact = (value: number, unit: string): Fact => ({
  value,
  unit,
  end: "2025-12-31",
  fiscalYear: 2025,
  fiscalPeriod: "FY",
  form: "20-F",
  sourceConcept: "us-gaap:X",
  sourceFilingUrl: null,
});

const won: NormalizedFundamentals = {
  cik: "0002120882",
  entityName: "SK hynix Inc.",
  taxonomy: "us-gaap",
  missingFields: [],
  annual: [
    {
      fiscalYear: 2025,
      fiscalPeriod: "FY",
      end: "2025-12-31",
      form: "20-F",
      facts: {
        revenue: fact(97_146_675_000_000, "KRW"),
        netIncome: fact(42_920_000_000_000, "KRW"),
        sharesOutstanding: fact(728_002_365, "shares"),
      },
      filedAt: "2026-03-15",
    },
  ],
};

const RATE = 0.00071;

describe("converting a filer's figures", () => {
  it("restates money into the target currency", () => {
    const usd = convertFundamentals(won, RATE, "USD");
    const revenue = usd.annual[0].facts.revenue!;

    expect(revenue.value).toBeCloseTo(97_146_675_000_000 * RATE, 0);
    expect(revenue.unit).toBe("USD");
    // Roughly $69bn, not $97 trillion.
    expect(revenue.value).toBeGreaterThan(50e9);
    expect(revenue.value).toBeLessThan(100e9);
  });

  // The error that would matter most: a share count is not money.
  it("leaves the share count exactly alone", () => {
    const usd = convertFundamentals(won, RATE, "USD");
    const shares = usd.annual[0].facts.sharesOutstanding!;

    expect(shares.value).toBe(728_002_365);
    expect(shares.unit).toBe("shares");
  });

  /*
    The same protection, for a source that labels a share count as money.

    Yahoo supplies the filers EDGAR does not hold, and tags every figure it
    returns with the filer's currency — share counts included. Trusting the
    unit alone turned SK hynix's 701,691,780 shares into 512,235 and reported
    earnings of $61,165 a share.
  */
  it("leaves it alone even when the source called it money", () => {
    const mislabelled: NormalizedFundamentals = {
      ...won,
      annual: [
        {
          ...won.annual[0],
          facts: { ...won.annual[0].facts, sharesOutstanding: fact(701_691_780, "KRW") },
        },
      ],
    };

    const shares = convertFundamentals(mislabelled, RATE, "USD").annual[0].facts
      .sharesOutstanding!;

    expect(shares.value).toBe(701_691_780);
    expect(shares.unit).toBe("KRW");
  });

  it("returns the figures untouched for a nonsensical rate", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const out = convertFundamentals(won, bad, "USD");
      expect(out.annual[0].facts.revenue!.value).toBe(97_146_675_000_000);
      expect(out.annual[0].facts.revenue!.unit).toBe("KRW");
    }
  });

  it("does not mutate what it was given", () => {
    convertFundamentals(won, RATE, "USD");
    expect(won.annual[0].facts.revenue!.value).toBe(97_146_675_000_000);
    expect(won.annual[0].facts.revenue!.unit).toBe("KRW");
  });

  // Ratios are currency-free, so scores must come out identical either way.
  it("leaves every ratio unchanged", () => {
    const usd = convertFundamentals(won, RATE, "USD");
    const before =
      won.annual[0].facts.netIncome!.value / won.annual[0].facts.revenue!.value;
    const after =
      usd.annual[0].facts.netIncome!.value / usd.annual[0].facts.revenue!.value;

    expect(after).toBeCloseTo(before, 10);
  });

  it("keeps the provenance of each figure", () => {
    const usd = convertFundamentals(won, RATE, "USD");
    expect(usd.annual[0].facts.revenue!.sourceConcept).toBe("us-gaap:X");
    expect(usd.annual[0].facts.revenue!.form).toBe("20-F");
  });
});
