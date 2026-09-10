import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UnsupportedListing } from "./unsupported";
import type { UnsupportedSymbol } from "@/lib/symbol-resolver";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

/**
 * What a reader is told when a ticker has no analysis.
 *
 * This page reached production telling someone looking up a US-listed fund that
 * it was a company filing with another country's regulator — wrong on both
 * counts — and then instructing them to set two environment variables, which is
 * not something a visitor to a website can do, would not have helped for a fund
 * anyway, and named the app's internals on a public page.
 */
const listing = (over: Partial<UnsupportedSymbol> = {}): UnsupportedSymbol => ({
  symbol: "DRAM",
  name: "Roundhill Memory ETF",
  exchange: "NYSE",
  country: "United States",
  type: "etf",
  otherListings: [],
  usEquivalent: null,
  address: null,
  ...over,
});

const render = (info: UnsupportedSymbol) =>
  renderToStaticMarkup(<UnsupportedListing info={info} />);

describe("coverage explainer", () => {
  it("never asks a reader to set an environment variable", () => {
    for (const info of [
      listing(),
      listing({ type: "stock", exchange: "TSX", country: "Canada" }),
      listing({ type: "unknown", exchange: null, country: null }),
    ]) {
      const html = render(info);
      expect(html).not.toContain("ENABLE_YAHOO_FALLBACK");
      expect(html).not.toContain("EODHD_API_KEY");
      expect(html).not.toMatch(/environment variable|deployment/i);
    }
  });

  it("calls a fund a fund, and does not claim it files abroad", () => {
    const html = render(listing());

    expect(html).toMatch(/is a fund/);
    expect(html).not.toMatch(/real company/);
    // NYSE is in the United States; the old copy said otherwise.
    expect(html).not.toMatch(/national regulator|different regulator/);
  });

  it("does not blame a foreign regulator for a US-listed company", () => {
    const html = render(listing({ type: "stock", name: "Newly Listed Inc." }));

    expect(html).not.toMatch(/different regulator|SEDAR/);
    expect(html).toMatch(/newly listed|different name/i);
  });

  it("does explain the regulator for a genuinely foreign listing", () => {
    const html = render(
      listing({ symbol: "ATZ", name: "Aritzia Inc.", exchange: "TSX", country: "Canada", type: "stock" }),
    );

    expect(html).toMatch(/different regulator/);
    expect(html).toContain("SEDAR+");
  });

  it("offers something the reader can actually act on", () => {
    // A fund is judged against the market, not against annual accounts.
    expect(render(listing())).toContain("/compare?symbols=DRAM,SPY");
    expect(render(listing({ type: "stock", exchange: "TSX", country: "Canada" }))).toContain(
      "/screen",
    );
  });

  it("still points at a US listing of the same company when one exists", () => {
    const html = render(
      listing({
        symbol: "ATZ",
        type: "stock",
        exchange: "TSX",
        country: "Canada",
        usEquivalent: { symbol: "ATZAF", name: "Aritzia Inc." },
      }),
    );

    expect(html).toContain("ATZAF");
    expect(html).toContain("/stock/ATZAF");
  });
});
