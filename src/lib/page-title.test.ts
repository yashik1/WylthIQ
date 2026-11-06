import { describe, expect, it } from "vitest";
import { fitDescription, fitTitle, tidyCompanyName, titleSubject } from "@/lib/page-title";

/**
 * How long a title may be before a search result cuts it.
 *
 * An audit of the live site on 2026-09-21 flagged 46 company pages whose
 * titles were outside the range engines display. "Archer-Daniels-Midland
 * Company (ADM) — financial health in plain English" is 77 characters before
 * the " · WylthIQ" the layout appends, and what a reader saw in results was
 * the first two thirds of it.
 */

const COMPANY = ["financial health in plain English", "financial health"];
const rendered = (title: string) => `${title} · WylthIQ`.length;

describe("a company page title", () => {
  it("keeps the whole phrase when it fits", () => {
    const title = fitTitle({ subject: "Apple Inc. (AAPL)", tails: COMPANY });
    expect(title).toBe("Apple Inc. (AAPL) — financial health");
    expect(rendered(title)).toBeLessThanOrEqual(60);
  });

  /*
    The shorter tail rather than a cut one. Half a descriptive phrase reads as
    a broken page, and the subject is what somebody typed into the search box.
  */
  it("steps down to a shorter tail before dropping it", () => {
    const title = fitTitle({ subject: "Archer-Daniels-Midland Company (ADM)", tails: COMPANY });
    expect(title).toBe("Archer-Daniels-Midland Company (ADM)");
    expect(rendered(title)).toBeLessThanOrEqual(60);
  });

  it("never cuts a name that is long on its own", () => {
    const long = "Taiwan Semiconductor Manufacturing Company Limited (TSM)";
    expect(fitTitle({ subject: long, tails: COMPANY })).toBe(long);
  });

  it("joins a listing without a dash, the way the page reads it", () => {
    const title = fitTitle({ subject: "ZDV (ZDV.TO)", tails: ["on the TSX"], separator: " " });
    expect(title).toBe("ZDV (ZDV.TO) on the TSX");
  });

  it("fits every title it is given, or hands back the subject", () => {
    for (const subject of ["A (A)", "Apple Inc. (AAPL)", "Archer-Daniels-Midland Company (ADM)"]) {
      const title = fitTitle({ subject, tails: COMPANY });
      expect(rendered(title) <= 60 || title === subject, title).toBe(true);
    }
  });
});

describe("a company name in a title", () => {
  it("drops the SEC's state tag and its capitals", () => {
    expect(tidyCompanyName("ZIONS BANCORPORATION, NATIONAL ASSOCIATION /UT/")).toBe(
      "Zions Bancorporation, National Association",
    );
    expect(tidyCompanyName("AMERICAN TOWER CORP /MA/")).toBe("American Tower Corp");
    expect(tidyCompanyName("Apple Inc.")).toBe("Apple Inc.");
  });

  it("drops a trailing legal form only when the name and ticker overrun", () => {
    expect(titleSubject("Apple Inc.", "AAPL")).toBe("Apple Inc. (AAPL)");
    expect(titleSubject("CHARLES RIVER LABORATORIES INTERNATIONAL, INC.", "CRL")).toBe(
      "Charles River Laboratories International (CRL)",
    );
    // Loses "Ltd." and stops as soon as it fits.
    expect(titleSubject("China Gold International Resources Corp. Ltd.", "2099.HK")).toBe(
      "China Gold International Resources Corp. (2099.HK)",
    );
    const zion = titleSubject("ZIONS BANCORPORATION, NATIONAL ASSOCIATION /UT/", "ZION");
    expect(rendered(zion)).toBeLessThanOrEqual(60);
  });
});

describe("a description that fits a result list", () => {
  it("takes the first candidate that fits", () => {
    expect(fitDescription("x".repeat(170), "Short and complete.")).toBe("Short and complete.");
  });

  it("cuts the last at a whole word when none fits", () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const cut = fitDescription(words);
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).toMatch(/word\d+…$/);
  });
});
