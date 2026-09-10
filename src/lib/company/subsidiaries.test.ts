import { describe, expect, it } from "vitest";
import { parseExhibit21 } from "./subsidiaries";

/**
 * Exhibit 21, as a hundred filers actually format it.
 *
 * There is no house style. The exhibit is required and its layout is not, so
 * the same list arrives as two columns or four, with section headings in the
 * data column, with the filer's own name at the top, and with a footnote about
 * everything left out. Each fixture below is shaped from a real filing that
 * broke an earlier version of this parser.
 */

const APPLE = `
<table>
  <tr><td></td><td></td></tr>
  <tr><td></td><td>Jurisdiction of&#160;Incorporation</td></tr>
  <tr><td>Apple Asia Limited</td><td>Hong Kong</td></tr>
  <tr><td>Apple Canada Inc.</td><td>Canada</td></tr>
  <tr><td>Braeburn Capital, Inc.</td><td>Nevada,&#160;U.S.</td></tr>
  <tr><td>* Pursuant to Item 601(b)(21)(ii) of Regulation S-K, the names of other subsidiaries are omitted.</td></tr>
</table>`;

/** Four columns: the jurisdiction is the second, not the last. */
const WALMART = `
<table>
  <tr><td>Subsidiary</td><td>Organized or Incorporated</td><td>Percent of Equity Securities Owned</td><td>Name Under Which Doing Business</td></tr>
  <tr><td>Wal-Mart Stores East, LP</td><td>Delaware, U.S.</td><td>100%</td><td>Walmart</td></tr>
  <tr><td>Wal-Mart Property Company</td><td>Delaware, U.S.</td><td>100%</td><td>NA</td></tr>
</table>`;

/** Grouped by region, with the filer itself named above its own list. */
const COCA_COLA = `
<table>
  <tr><td>The Coca-Cola Company</td><td>Delaware</td></tr>
  <tr><td>Organized Under Laws of:</td></tr>
  <tr><td>Atlantic Industries</td><td>Cayman Islands</td></tr>
  <tr><td>U.S. Subsidiaries:</td></tr>
  <tr><td>BA Sports Nutrition, LLC</td><td>Delaware</td></tr>
</table>`;

describe("reading the table", () => {
  it("pairs each company with where it is incorporated", () => {
    const subs = parseExhibit21(APPLE);
    expect(subs).toContainEqual({ name: "Apple Asia Limited", jurisdiction: "Hong Kong" });
    expect(subs).toContainEqual({ name: "Apple Canada Inc.", jurisdiction: "Canada" });
  });

  it("decodes the entities filings are full of", () => {
    const subs = parseExhibit21(APPLE);
    // Filed as "Nevada,&#160;U.S." — a non-breaking space, not a literal one.
    expect(subs.find((s) => s.name.startsWith("Braeburn"))?.jurisdiction).toBe("Nevada, U.S.");
  });

  it("takes the second column, not the last", () => {
    /*
      Walmart's exhibit has four columns and ends with a trading name. Reading
      the last cell reported every one of its subsidiaries as incorporated in
      "Walmart", which is not a jurisdiction.
    */
    const subs = parseExhibit21(WALMART);
    expect(subs[0]).toEqual({ name: "Wal-Mart Stores East, LP", jurisdiction: "Delaware, U.S." });
    expect(subs.some((s) => s.jurisdiction === "Walmart")).toBe(false);
  });
});

describe("what is in the table but is not a subsidiary", () => {
  it("drops the column header", () => {
    expect(parseExhibit21(WALMART).some((s) => s.name === "Subsidiary")).toBe(false);
  });

  it("drops a section heading", () => {
    // These sit in the same column as the companies; only the colon separates
    // them, which is why the rule is punctuation rather than wording.
    const names = parseExhibit21(COCA_COLA).map((s) => s.name);
    expect(names).not.toContain("Organized Under Laws of:");
    expect(names).not.toContain("U.S. Subsidiaries:");
    expect(names).toContain("Atlantic Industries");
    expect(names).toContain("BA Sports Nutrition, LLC");
  });

  it("drops the footnote about what was left out", () => {
    const names = parseExhibit21(APPLE).map((s) => s.name);
    expect(names.some((n) => n.includes("Pursuant to"))).toBe(false);
    expect(names.some((n) => n.includes("Regulation S-K"))).toBe(false);
  });

  it("drops the filer itself when told who it is", () => {
    // Coca-Cola heads its own list. Carried through, the page would tell a
    // reader the company owns itself.
    const withParent = parseExhibit21(COCA_COLA, "Coca-Cola Co");
    expect(withParent.some((s) => s.name === "The Coca-Cola Company")).toBe(false);
    expect(withParent).toHaveLength(2);

    // Without the name there is nothing to compare against, so it stays.
    expect(parseExhibit21(COCA_COLA).some((s) => s.name === "The Coca-Cola Company")).toBe(true);
  });

  it("does not mistake a subsidiary for the parent on a partial match", () => {
    // "Coca-Cola Bottling" is not "The Coca-Cola Company" and must survive.
    const html = `<table><tr><td>Coca-Cola Bottling Co.</td><td>Delaware</td></tr></table>`;
    expect(parseExhibit21(html, "The Coca-Cola Company")).toHaveLength(1);
  });
});

describe("exhibits that are shaped differently", () => {
  it("keeps a name when the exhibit lists no jurisdiction", () => {
    const html = `<table><tr><td>Some Holdings Limited</td></tr></table>`;
    expect(parseExhibit21(html)).toEqual([{ name: "Some Holdings Limited", jurisdiction: null }]);
  });

  it("ignores the empty cells layout tables are padded with", () => {
    // Apple's first row is six empty cells. Counting them would shift every
    // column by one.
    expect(parseExhibit21(APPLE).every((s) => s.name.length > 1)).toBe(true);
  });

  it("does not list one company twice", () => {
    const html = `<table>
      <tr><td>Repeated Ltd</td><td>Ireland</td></tr>
      <tr><td>repeated ltd</td><td>Ireland</td></tr>
    </table>`;
    expect(parseExhibit21(html)).toHaveLength(1);
  });

  it("returns nothing for a document with no table at all", () => {
    expect(parseExhibit21("<p>No subsidiaries to report.</p>")).toEqual([]);
    expect(parseExhibit21("")).toEqual([]);
  });
});
