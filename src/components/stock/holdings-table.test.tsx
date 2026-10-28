import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HoldingsTable, ROWS_SHOWN, type HoldingRow } from "./holdings-table";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const row = (i: number, over: Partial<HoldingRow> = {}): HoldingRow => ({
  name: `Holding ${i}`,
  symbol: null,
  where: "United States",
  weight: (100 - i) / 1000,
  detail: null,
  isShort: false,
  ...over,
});

describe("a fund's holdings table", () => {
  it("shows the first rows and folds the rest behind 'Show all'", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(i));
    const html = renderToStaticMarkup(<HoldingsTable rows={rows} whereLabel="Where" />);
    expect(html).toContain("Show all 40 largest");
    expect(html.indexOf("Holding 24")).toBeLessThan(html.indexOf("<details"));
    expect(html.indexOf(`Holding ${ROWS_SHOWN}<`)).toBeGreaterThan(html.indexOf("<details"));
    expect(html).toContain("10.00%");
  });

  it("has no disclosure when every row fits", () => {
    const html = renderToStaticMarkup(<HoldingsTable rows={[row(1), row(2)]} whereLabel="Sector" />);
    expect(html).not.toContain("<details");
    expect(html).toContain(">Sector<");
  });

  it("links a holding only where it has a page here", () => {
    const html = renderToStaticMarkup(
      <HoldingsTable rows={[row(1, { name: "Royal Bank", symbol: "RY.TO" }), row(2, { name: "A Bond" })]} whereLabel="Where" />,
    );
    expect(html).toContain('href="/stock/RY.TO"');
    expect(html.match(/href=/g)).toHaveLength(1);
  });

  it("marks a short and prints a bond's terms", () => {
    const html = renderToStaticMarkup(
      <HoldingsTable
        rows={[row(1, { isShort: true }), row(2, { name: "United States Treasury", detail: "4.25% · due 2034-11" })]}
        whereLabel="Where"
      />,
    );
    expect(html).toContain(">short<");
    expect(html).toContain("4.25% · due 2034-11");
  });

  it("renders nothing for a fund with no holdings", () => {
    expect(renderToStaticMarkup(<HoldingsTable rows={[]} whereLabel="Where" />)).toBe("");
  });
});
