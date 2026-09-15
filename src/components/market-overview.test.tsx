import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketOverview } from "./market-overview";
import type { MarketSnapshot, Mover, SectorPerformance } from "@/lib/market";

/**
 * The dashboard's market section, rendered with data in it.
 *
 * This block only renders when the database holds quotes, so on a machine with
 * no `DATABASE_URL` the dashboard silently takes the other branch and this code
 * never runs at all. That is precisely how it reached production untested while
 * every local check passed: an empty database exercises the empty state, and
 * the populated state is the one readers actually see.
 *
 * Every value here is nullable in the schema, and SQL aggregates hand back
 * shapes the TypeScript types do not fully pin down — `max(timestamptz)` may
 * arrive as a Date or as a string depending on the driver. So the cases below
 * are about surviving real data rather than producing pretty output.
 */

const mover = (over: Partial<Mover> = {}): Mover => ({
  symbol: "AAPL",
  name: "Apple Inc.",
  displaySector: "Technology",
  price: 232.41,
  changePercent: 0.0184,
  healthScore: 8.2,
  marketCap: 3.44e12,
  ...over,
});

const sector = (over: Partial<SectorPerformance> = {}): SectorPerformance => ({
  sector: "Technology",
  averageChange: 0.0121,
  companyCount: 64,
  leader: "AAPL",
  ...over,
});

const snapshot = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  gainers: [mover(), mover({ symbol: "NVDA", name: "NVIDIA Corporation" })],
  losers: [mover({ symbol: "INTC", name: "Intel Corporation", changePercent: -0.0312 })],
  sectors: [sector(), sector({ sector: "Energy", averageChange: -0.008, leader: "XOM" })],
  asOf: new Date("2026-08-13T20:00:00Z"),
  covered: 542,
  // Fresh unless a case says otherwise, so the staleness notice does not
  // appear in the cases that are about something else.
  ageDays: 0,
  behind: 0,
  stale: false,
  ...over,
});

const render = (s: MarketSnapshot) => renderToStaticMarkup(<MarketOverview snapshot={s} />);

describe("market overview with data present", () => {
  it("renders the populated state a reader with a loaded database sees", () => {
    const html = render(snapshot());

    expect(html).toContain("AAPL");
    expect(html).toContain("Biggest risers");
    expect(html).toContain("542");
    // A move of +1.84% must read as a gain, not a bare number.
    expect(html).toContain("+1.84%");
    expect(html).toContain("-3.12%");
  });

  it("survives every nullable column arriving null", () => {
    expect(() =>
      render(
        snapshot({
          gainers: [mover({ price: null, changePercent: null, name: null as never })],
          losers: [mover({ price: null, changePercent: null })],
          sectors: [sector({ averageChange: null as never, leader: null })],
          asOf: null,
        }),
      ),
    ).not.toThrow();
  });

  it("renders when a refresh found nothing to report", () => {
    const html = render(snapshot({ gainers: [], losers: [], sectors: [], covered: 0 }));
    expect(html).toContain("No gainers in the latest refresh.");
    expect(html).toContain("Not enough companies with prices yet");
  });

  // The bar widths divide by the largest move in the set. Every sector being
  // flat makes that divisor zero, and a width of NaN% is an invalid style.
  it("does not divide by zero when every sector is flat", () => {
    const html = render(
      snapshot({ sectors: [sector({ averageChange: 0 }), sector({ sector: "Energy", averageChange: 0 })] }),
    );
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  // `max(price_updated_at)` is typed as a Date, but whether the driver parses a
  // timestamp or hands back the raw string is not something this component
  // should depend on.
  it.each([
    ["a Date", new Date("2026-08-13T20:00:00Z")],
    ["an ISO string", "2026-08-13T20:00:00Z"],
    ["epoch milliseconds", 1786000000000],
  ])("accepts a timestamp arriving as %s", (_label, value) => {
    expect(() => render(snapshot({ asOf: value as never }))).not.toThrow();
  });

  it("omits the timestamp rather than printing an invalid date", () => {
    const html = render(snapshot({ asOf: "not a date" as never }));
    expect(html).not.toContain("Invalid Date");
    expect(html).not.toContain("NaN");
  });

  it("handles a move large enough to look like bad data", () => {
    expect(() =>
      render(snapshot({ gainers: [mover({ changePercent: 42 })], sectors: [sector({ averageChange: 42 })] })),
    ).not.toThrow();
  });
});

describe("the sector heatmap links", () => {
  /*
    Each row stated a fact and offered nothing to do with it. The obvious next
    question is "which companies", and that is a page this app already has —
    it just could not answer it, because the screener filtered on the
    four-bucket scoring sector rather than the familiar names shown here.
  */
  it("links each sector to the companies in it", () => {
    const html = render(snapshot());

    expect(html).toContain("/screen?sector=Technology");
    expect(html).toContain("/screen?sector=Energy");
  });

  it("escapes a sector name containing a space", () => {
    const html = render(
      snapshot({ sectors: [sector({ sector: "Communication Services" })] }),
    );

    expect(html).toContain("/screen?sector=Communication%20Services");
    expect(html).not.toContain("/screen?sector=Communication Services");
  });

  it("says how many companies the link leads to", () => {
    expect(render(snapshot())).toContain("64 companies in Technology");
  });
});

describe("staleness", () => {
  /*
    The bug that started this. Nothing was scheduled to refresh stored quotes
    at all — only the fundamentals pass had a scheduler — so "biggest risers"
    showed the same five names for eleven days, with a date in the sub-heading
    as the only signal.
  */
  it("says plainly when the prices are days old", () => {
    const html = render(snapshot({ asOf: new Date(Date.now() - 11 * 86_400_000), ageDays: 11, stale: true }));

    expect(html).toContain("11 days old");
    expect(html).toContain("rather than today");
  });

  it("stays quiet across a weekend, where a two-day-old close is normal", () => {
    const html = render(snapshot({ asOf: new Date(Date.now() - 2 * 86_400_000), ageDays: 2 }));
    expect(html).not.toContain("days old");
  });

  it("stays quiet when the data is fresh", () => {
    expect(render(snapshot({ asOf: new Date(), ageDays: 0 }))).not.toContain("days old");
  });

  it("claims nothing when there is no timestamp to judge", () => {
    const html = render(snapshot({ asOf: null, ageDays: null }));
    expect(html).not.toContain("days old");
    expect(html).not.toContain("NaN");
  });

  it("claims nothing when the timestamp is unparseable", () => {
    const html = render(snapshot({ asOf: "not a date" as never, ageDays: null }));
    expect(html).not.toContain("days old");
    expect(html).not.toContain("NaN");
  });
});

describe("prices from different days", () => {
  it("warns from the snapshot's own verdict, which counts trading days", () => {
    // Four calendar days across a weekend is not stale; the snapshot says so.
    expect(render(snapshot({ ageDays: 4, stale: false }))).not.toContain("days old");
    expect(render(snapshot({ ageDays: 32, stale: true }))).toContain("32 days old");
  });

  it("says how many companies were left out for having only an older price", () => {
    expect(render(snapshot({ behind: 12 }))).toContain("12 more have no price from that day");
  });

  it("mentions nobody left out when every price is from the same day", () => {
    expect(render(snapshot({ behind: 0 }))).not.toContain("left out");
  });
});
