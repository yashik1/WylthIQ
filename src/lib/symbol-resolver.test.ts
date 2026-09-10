import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SymbolSearchResult } from "./providers/types";

/**
 * Where a bare ticker that is not a US security sends the reader.
 *
 * The worldwide directory and the SEC ticker file are both network calls, so
 * they are replaced here with listings in the shape and order the live
 * directory returned them.
 */

const { search } = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("./providers/twelvedata", () => ({ searchGlobalSymbols: search }));
vi.mock("./providers/sec-edgar", () => ({ loadTickerMap: async () => new Map() }));

import { resolveUnsupported } from "./symbol-resolver";

function listing(
  symbol: string,
  exchange: string,
  country: string,
  name = `${symbol} on ${exchange}`,
): SymbolSearchResult {
  return { symbol, name, exchange, country, cik: null, type: "etf" };
}

beforeEach(() => search.mockReset());

describe("a bare ticker's address", () => {
  it("is the Toronto listing when the ticker trades nowhere in the US", async () => {
    search.mockResolvedValue([listing("QQC", "TSX", "Canada"), listing("QQC", "NEO", "Canada")]);

    const resolved = await resolveUnsupported("QQC");

    expect(resolved?.address).toBe("QQC.TO");
    expect(resolved?.exchange).toBe("TSX");
  });

  it("is null when the ticker also trades in the US", async () => {
    search.mockResolvedValue([
      listing("TEC", "TSX", "Canada", "TD Global Technology Leaders Fund"),
      listing("TEC", "NEO", "Canada", "TD Global Technology Leaders Fund"),
      listing("TEC", "NYSE", "United States", "US-listed TEC fund"),
    ]);

    const resolved = await resolveUnsupported("TEC");

    expect(resolved?.address).toBeNull();
    // And the page is about the US fund, not the Toronto one listed first.
    expect(resolved?.name).toBe("US-listed TEC fund");
    expect(resolved?.exchange).toBe("NYSE");
  });

  it("is null for a ticker that already carries its suffix", async () => {
    search.mockResolvedValue([listing("QQC", "TSX", "Canada"), listing("QQC", "NEO", "Canada")]);

    const resolved = await resolveUnsupported("QQC.TO");

    expect(resolved).not.toBeNull();
    expect(resolved?.address).toBeNull();
  });

  it("is null when the listing's venue cannot be placed", async () => {
    search.mockResolvedValue([listing("QQC0", "Munich", "Germany")]);

    const resolved = await resolveUnsupported("QQC0");

    expect(resolved).not.toBeNull();
    expect(resolved?.address).toBeNull();
  });
});
