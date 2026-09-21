import { describe, expect, it } from "vitest";
import { fitTitle } from "@/lib/page-title";

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
