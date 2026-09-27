import { describe, expect, it } from "vitest";
import { appSymbol } from "./ibkr-symbols";

const map = (symbol: string, listingExchange: string | undefined, currency: string | undefined) =>
  appSymbol({ symbol, listingExchange, currency });

describe("IBKR listings in this app's notation", () => {
  it("keeps a US ticker bare", () => {
    expect(map("AAPL", "NASDAQ", "USD")).toEqual({ ok: true, symbol: "AAPL" });
    expect(map("SPY", "ARCA", "USD")).toEqual({ ok: true, symbol: "SPY" });
    expect(map("KO", "NYSE", "USD")).toEqual({ ok: true, symbol: "KO" });
  });

  it("writes a US share class with a dot", () => {
    expect(map("BRK B", "NYSE", "USD")).toEqual({ ok: true, symbol: "BRK.B" });
  });

  it("gives a Toronto listing the .TO suffix, and a class a dash", () => {
    expect(map("RY", "TSE", "CAD")).toEqual({ ok: true, symbol: "RY.TO" });
    expect(map("XEQT", "TSE", "CAD")).toEqual({ ok: true, symbol: "XEQT.TO" });
    expect(map("BBD.B", "TSE", "CAD")).toEqual({ ok: true, symbol: "BBD-B.TO" });
  });

  it("gives a Venture listing the .V suffix", () => {
    expect(map("ABC", "VENTURE", "CAD")).toEqual({ ok: true, symbol: "ABC.V" });
  });

  it("does not place Tokyo, which IBKR writes as TSEJ, in Toronto", () => {
    expect(map("7203", "TSEJ", "JPY").ok).toBe(false);
  });

  it("refuses a listing whose currency does not match its venue", () => {
    // A US-dollar line on the TSX is a different security from the CAD one.
    expect(map("DLR.U", "TSE", "USD").ok).toBe(false);
    expect(map("AAPL", "NASDAQ", "CAD").ok).toBe(false);
  });

  it("says why it cannot place a row with no exchange, rather than guessing US", () => {
    const result = map("AAPL", undefined, "USD");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/listing exchange/);
  });

  it("leaves an unknown venue unmapped", () => {
    expect(map("VOD", "LSE", "GBP").ok).toBe(false);
  });
});
