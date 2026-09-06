import { describe, expect, it } from "vitest";
import { fieldValue, filingUrl, normalizeCompanyFacts } from "./normalize";
import type { SecCompanyFacts } from "./types";

import aaplRaw from "./__fixtures__/aapl.json";
import ryRaw from "./__fixtures__/ry.json";
import shopRaw from "./__fixtures__/shop.json";

const aapl = normalizeCompanyFacts(aaplRaw as unknown as SecCompanyFacts);
const ry = normalizeCompanyFacts(ryRaw as unknown as SecCompanyFacts);
const shop = normalizeCompanyFacts(shopRaw as unknown as SecCompanyFacts);

describe("taxonomy detection", () => {
  it("detects us-gaap for a US domestic filer", () => {
    expect(aapl.taxonomy).toBe("us-gaap");
  });

  // Regression guard: Canadian MJDS filers report under ifrs-full. Reading only
  // us-gaap would render every Canadian company with blank fundamentals.
  it("detects ifrs-full for a Canadian 40-F filer", () => {
    expect(ry.taxonomy).toBe("ifrs-full");
    expect(ry.entityName).toMatch(/ROYAL BANK/i);
  });
});

describe("cross-taxonomy field resolution", () => {
  it("resolves core fields for a us-gaap filer", () => {
    const p = aapl.annual[0];
    expect(p.facts.assets?.value).toBeGreaterThan(0);
    expect(p.facts.revenue?.value).toBeGreaterThan(0);
    expect(p.facts.netIncome?.value).toBeGreaterThan(0);
    expect(p.facts.netIncome?.sourceConcept).toBe("us-gaap:NetIncomeLoss");
  });

  it("resolves ifrs-full concepts to the same canonical fields", () => {
    const p = ry.annual[0];
    expect(p.facts.assets?.sourceConcept).toBe("ifrs-full:Assets");
    // IFRS calls net income ProfitLoss; it must land on `netIncome` regardless.
    expect(p.facts.netIncome?.sourceConcept).toBe("ifrs-full:ProfitLoss");
    expect(p.facts.netIncome?.value).toBeGreaterThan(0);
    expect(p.facts.operatingCashFlow?.sourceConcept).toBe(
      "ifrs-full:CashFlowsFromUsedInOperatingActivities",
    );
  });
});

describe("derived fields", () => {
  // Shopify reports assets and equity but never tags total liabilities.
  it("derives liabilities from assets - equity when untagged", () => {
    const p = shop.annual[0];
    expect(p.facts.liabilities).toBeDefined();
    expect(p.facts.liabilities?.derived).toBe(true);
    expect(p.facts.liabilities?.sourceConcept).toBe("derived:Assets-Equity");

    const assets = p.facts.assets!.value;
    const equity = p.facts.equity!.value;
    expect(p.facts.liabilities!.value).toBeCloseTo(assets - equity, 2);
  });

  it("does not mark directly reported liabilities as derived", () => {
    const p = aapl.annual[0];
    expect(p.facts.liabilities?.derived).toBeUndefined();
  });

  // `LiabilitiesAndStockholdersEquity` is the balance sheet total, not total
  // liabilities. Reading it as liabilities would roughly double reported debt.
  it("never sources liabilities from the balance sheet total", () => {
    for (const n of [aapl, ry, shop]) {
      for (const p of n.annual) {
        expect(p.facts.liabilities?.sourceConcept).not.toMatch(
          /LiabilitiesAndStockholdersEquity/,
        );
        if (p.facts.assets && p.facts.liabilities) {
          // Liabilities can never equal total assets on a solvent balance sheet.
          expect(p.facts.liabilities.value).not.toBe(p.facts.assets.value);
        }
      }
    }
  });
});

describe("concept migration across years", () => {
  // Shopify tagged revenue as RevenueFromContractWithCustomerExcludingAssessedTax
  // through FY2023, then switched to Revenues in FY2024. Resolving concepts once
  // for the whole company drops one era or the other.
  it("picks up revenue across a mid-history concept switch", () => {
    const withRevenue = shop.annual.filter((p) => p.facts.revenue != null);
    expect(withRevenue.length).toBeGreaterThanOrEqual(4);

    // The most recent year must have revenue — that is the one the UI shows.
    expect(shop.annual[0].facts.revenue?.value).toBeGreaterThan(0);

    const concepts = new Set(withRevenue.map((p) => p.facts.revenue!.sourceConcept));
    expect(concepts.size).toBeGreaterThan(1);
  });

  it("keeps revenue increasing across the switch, with no gap year", () => {
    const years = shop.annual
      .filter((p) => p.facts.revenue != null)
      .map((p) => p.fiscalYear)
      .sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      expect(years[i] - years[i - 1]).toBe(1);
    }
  });
});

describe("filing-error guards", () => {
  // Royal Bank's FY2020 40-F cover page reports 0 shares outstanding. Left in,
  // it makes every per-share figure Infinity.
  it("discards a reported share count of zero", () => {
    const fy2020 = ry.annual.find((p) => p.fiscalYear === 2020);
    expect(fy2020).toBeDefined();
    expect(fy2020!.facts.sharesOutstanding).toBeUndefined();

    // Neighbouring years are unaffected and still carry real share counts.
    const fy2021 = ry.annual.find((p) => p.fiscalYear === 2021);
    expect(fy2021!.facts.sharesOutstanding!.value).toBeGreaterThan(1e9);
  });
});

describe("unclassified balance sheets", () => {
  // Banks present unclassified balance sheets with no current/non-current split.
  // These must stay absent so the scoring layer can suppress the ratios that
  // depend on them, rather than computing them from a fabricated zero.
  it("leaves current assets and liabilities absent for a bank", () => {
    const p = ry.annual[0];
    expect(p.facts.currentAssets).toBeUndefined();
    expect(p.facts.currentLiabilities).toBeUndefined();
    expect(ry.missingFields).toContain("currentAssets");
    expect(ry.missingFields).toContain("currentLiabilities");
  });

  it("reports current assets and liabilities for a classified balance sheet", () => {
    const p = aapl.annual[0];
    expect(p.facts.currentAssets?.value).toBeGreaterThan(0);
    expect(p.facts.currentLiabilities?.value).toBeGreaterThan(0);
  });
});

describe("period construction", () => {
  it("returns multiple annual periods sorted newest first", () => {
    for (const n of [aapl, ry, shop]) {
      expect(n.annual.length).toBeGreaterThan(2);
      const years = n.annual.map((p) => p.fiscalYear);
      expect([...years].sort((a, b) => b - a)).toEqual(years);
    }
  });

  it("only builds periods from annual filings", () => {
    const forms = new Set(aapl.annual.map((p) => p.form));
    for (const f of forms) expect(f).toMatch(/^(10-K|20-F|40-F)/);
  });

  // Duration facts are length-checked so quarterly figures reported inside an
  // annual filing are not mistaken for full-year revenue.
  it("uses full-year spans for duration facts", () => {
    const rev = aapl.annual[0].facts.revenue!;
    const days = (Date.parse(rev.end) - Date.parse(rev.start!)) / 86_400_000;
    expect(days).toBeGreaterThan(340);
    expect(days).toBeLessThan(400);
  });

  // Scoped to fields where zero is structurally impossible. A reported zero
  // elsewhere can be genuine — Shopify really did have no interest expense in
  // years when it carried no debt — and must be preserved, not filtered.
  it("never emits zero for fields where zero is impossible", () => {
    for (const n of [aapl, ry, shop]) {
      for (const p of n.annual) {
        for (const field of ["assets", "sharesOutstanding"] as const) {
          const fact = p.facts[field];
          if (fact) expect(fact.value, `${n.entityName} ${field}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("provenance", () => {
  it("attaches a source concept and filing link to every reported fact", () => {
    const p = aapl.annual[0];
    for (const fact of Object.values(p.facts)) {
      expect(fact.sourceConcept).toMatch(/^(us-gaap|ifrs-full|dei|derived):/);
      if (!fact.derived) expect(fact.sourceFilingUrl).toContain("sec.gov");
    }
  });

  it("builds a valid EDGAR filing URL", () => {
    expect(filingUrl(320193, "0000320193-24-000123")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/0000320193-24-000123-index.htm",
    );
  });

  it("returns null for a malformed accession number", () => {
    expect(filingUrl(320193, undefined)).toBeNull();
    expect(filingUrl(320193, "bogus")).toBeNull();
  });
});

/**
 * Share counts from a filer that publishes no usable instant.
 *
 * A share count is a point-in-time measure, so the extractor looked only for
 * facts without a start date. But a company with more than one class of stock
 * often tags the per-class instants and publishes the consolidated figure only
 * as an average over the year: Shopify's `CommonStockSharesOutstanding` has two
 * observations in its whole history while the weighted averages have thirty.
 *
 * Judging the shape from the field alone discarded the only usable number, and
 * the effect reached much further than one blank cell — with no share count
 * there is no market value, and with no market value there is no P/E, no P/B
 * and no answer to "is it cheap or expensive?".
 */
describe("share counts across differently-tagged filers", () => {
  it("falls back to the yearly average when a filer publishes no instant", () => {
    const shares = fieldValue(shop.annual[0], "sharesOutstanding");

    expect(shares).not.toBeNull();
    expect(shares!).toBeGreaterThan(1e9);
    expect(shop.annual[0]!.facts.sharesOutstanding!.sourceConcept).toMatch(
      /WeightedAverageNumber/,
    );
  });

  // The average is a worse measure than the closing count, so it must never
  // displace an instant on a filer that reports one.
  it("still prefers the point-in-time count where one exists", () => {
    for (const f of [aapl, ry]) {
      const concept = f.annual[0]!.facts.sharesOutstanding!.sourceConcept;
      expect(concept).not.toMatch(/WeightedAverageNumber/);
    }
  });

  it("keeps the share count within a believable range for a real company", () => {
    for (const f of [aapl, ry, shop]) {
      const shares = fieldValue(f.annual[0], "sharesOutstanding")!;
      expect(shares).toBeGreaterThan(1e6);
      expect(shares).toBeLessThan(1e12);
    }
  });
});

/**
 * When a period's figures actually became public.
 *
 * This is the load-bearing fact for backtesting: a strategy that scores 2020
 * using 2020's own year-end results is testing something that could not have
 * been known at the time, because those results were not filed until early
 * 2021.
 *
 * The first version of this shipped with a real bug, caught before it went
 * anywhere near a backtest: it took whichever filed date `isBetter` preferred
 * for value selection, which is always the *most recent* one. SEC XBRL
 * re-tags a prior year's unchanged comparative figures inside every
 * subsequent 10-K, so Apple's FY2023 assets ($352,583,000,000) appear three
 * times in its own fixture — filed 2023-11-03, 2024-11-01, and 2025-10-31 —
 * with the identical value each time. Taking the latest of those claimed the
 * 2023 figure only became public in 2025. A backtest run "as of 2024" would
 * have wrongly treated Apple's own FY2023 results as not yet knowable.
 */
describe("when a period's figures became public", () => {
  it("records a real filing date, not the period end", () => {
    const latest = aapl.annual[0]!;
    expect(latest.filedAt).toBeTruthy();
    expect(latest.filedAt).not.toBe(latest.end);
  });

  it("reflects the real reporting lag, not an invented one", () => {
    const latest = aapl.annual[0]!;
    const lagDays = (Date.parse(latest.filedAt!) - Date.parse(latest.end)) / 86_400_000;

    // A large filer reports within roughly two months of its fiscal year end;
    // a negative lag or a multi-year one would mean the wrong date was picked.
    expect(lagDays).toBeGreaterThan(0);
    expect(lagDays).toBeLessThan(120);
  });

  // The regression test for the bug described above, against real fixture
  // data rather than a synthetic case: every one of Apple's annual periods
  // should show the same ~34-day lag, not just the newest one. An older
  // period showing a lag of hundreds of days would mean a later re-tag of an
  // unchanged comparative figure was mistaken for a fresh disclosure.
  it("is not inflated by a later filing re-tagging an unchanged comparative figure", () => {
    for (const period of aapl.annual.slice(0, 4)) {
      const lagDays = (Date.parse(period.filedAt!) - Date.parse(period.end)) / 86_400_000;
      expect(lagDays, `FY${period.fiscalYear} lag`).toBeGreaterThan(0);
      expect(lagDays, `FY${period.fiscalYear} lag`).toBeLessThan(60);
    }
  });

  it("carries a filed date on every fact that has one", () => {
    const revenue = aapl.annual[0]!.facts.revenue!;
    expect(revenue.filed).toBeTruthy();
    expect(revenue.filed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Every fact WylthIQ reads from a real SEC filing does, in fact, carry
  // one — this is the assumption Phase 2's exclusion logic is built on.
  it("gives every field in a real filing a filed date", () => {
    const latest = aapl.annual[0]!;
    for (const fact of Object.values(latest.facts)) {
      if (!fact || fact.derived) continue;
      expect(fact.filed).toBeTruthy();
    }
  });

  it("takes the latest filed date across the period's own facts, not the first", () => {
    const raw: SecCompanyFacts = {
      cik: 1,
      entityName: "Synthetic Co",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                {
                  end: "2022-12-31",
                  val: 1000,
                  form: "10-K",
                  fy: 2022,
                  fp: "FY",
                  filed: "2023-02-01",
                },
              ],
            },
          },
          Revenues: {
            units: {
              USD: [
                {
                  start: "2022-01-01",
                  end: "2022-12-31",
                  val: 500,
                  form: "10-K",
                  fy: 2022,
                  fp: "FY",
                  // A late amendment restated revenue after the original 10-K.
                  filed: "2023-04-15",
                },
              ],
            },
          },
        },
      },
    };

    const result = normalizeCompanyFacts(raw);
    // The period was not fully knowable until the later of its two facts —
    // taking the earlier one would have claimed knowledge of a number that
    // had not been restated yet.
    expect(result.annual[0]!.filedAt).toBe("2023-04-15");
  });

  // The synthetic version of the real Apple bug above: one concept, the same
  // value, tagged three times at increasing filed dates because each later
  // 10-K echoes the prior year as a comparative column.
  it("attributes an unchanged value to its earliest filing, not its latest", () => {
    const raw: SecCompanyFacts = {
      cik: 1,
      entityName: "Synthetic Co",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: "2022-12-31", val: 1000, form: "10-K", fy: 2022, fp: "FY", filed: "2023-02-01" },
                // Re-tagged as a comparative figure in the next two 10-Ks. The
                // value never changes.
                { end: "2022-12-31", val: 1000, form: "10-K", fy: 2023, fp: "FY", filed: "2024-02-01" },
                { end: "2022-12-31", val: 1000, form: "10-K", fy: 2024, fp: "FY", filed: "2025-02-01" },
              ],
            },
          },
        },
      },
    };

    const result = normalizeCompanyFacts(raw);
    expect(result.annual[0]!.facts.assets!.filed).toBe("2023-02-01");
  });

  // The other side of the same coin: when the value actually does change, the
  // later filed date is correct, because the corrected number genuinely was
  // not public until then.
  it("attributes a genuinely restated value to the filing that restated it", () => {
    const raw: SecCompanyFacts = {
      cik: 1,
      entityName: "Synthetic Co",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [
                { end: "2022-12-31", val: 1000, form: "10-K", fy: 2022, fp: "FY", filed: "2023-02-01" },
                // A correction, not a re-tag: the value itself changed.
                { end: "2022-12-31", val: 1050, form: "10-K", fy: 2023, fp: "FY", filed: "2024-02-01" },
              ],
            },
          },
        },
      },
    };

    const result = normalizeCompanyFacts(raw);
    const assets = result.annual[0]!.facts.assets!;
    expect(assets.value).toBe(1050);
    expect(assets.filed).toBe("2024-02-01");
  });

  it("is null when nothing in the period carries a filed date", () => {
    const raw: SecCompanyFacts = {
      cik: 1,
      entityName: "No Filed Dates Co",
      facts: {
        "us-gaap": {
          Assets: {
            units: {
              USD: [{ end: "2022-12-31", val: 1000, form: "10-K", fy: 2022, fp: "FY" }],
            },
          },
        },
      },
    };

    expect(normalizeCompanyFacts(raw).annual[0]!.filedAt).toBeNull();
  });
});
