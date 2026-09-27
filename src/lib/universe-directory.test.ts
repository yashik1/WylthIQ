import { describe, expect, it } from "vitest";
import { listCoveredCompanies } from "./universe-directory";
import { getUniverse } from "./universe";

/**
 * The directory that makes every company page reachable by following links.
 *
 * An audit on 2026-09-21 found company pages with nothing linking to them:
 * the screener shows a hundred rows, the dashboard six, and the rest existed
 * only in the sitemap. Crawlers reach pages through links.
 */

describe("the company directory", () => {
  it("lists every company in the ingest universe, once", () => {
    const groups = listCoveredCompanies();
    const listed = groups.flatMap((g) => g.symbols);

    expect(listed.length).toBe(new Set(getUniverse()).size);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("groups by first letter, in order, sorted inside each group", () => {
    const groups = listCoveredCompanies(["MSFT", "AAPL", "ADM", "ZM"]);

    expect(groups.map((g) => g.letter)).toEqual(["A", "M", "Z"]);
    expect(groups[0].symbols).toEqual(["AAPL", "ADM"]);
  });

  it("tidies what it is given rather than trusting it", () => {
    const groups = listCoveredCompanies([" aapl ", "AAPL", "", "9F"]);

    expect(groups.find((g) => g.letter === "A")?.symbols).toEqual(["AAPL"]);
    // A ticker that does not start with a letter still has to live somewhere.
    expect(groups.find((g) => g.letter === "#")?.symbols).toEqual(["9F"]);
  });
});
