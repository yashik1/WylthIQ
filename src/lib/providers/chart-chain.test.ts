import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alpaca,
  barSourcesFor,
  describeBarFailure,
  finnhub,
  hasAnyBarSource,
  yahoo,
} from "./index";

/**
 * Who is asked for a chart, and what a reader is told when nobody can answer.
 *
 * Charts ran out of requests under ordinary use because the chain was Twelve
 * Data at 8 a minute, a Finnhub slot that never returns bars, and Tiingo for
 * daily history only — and the error then told the reader to add a Tiingo key
 * the live site already had. These pin the chain that replaced it and a
 * message that only suggests what is actually missing.
 */

afterEach(() => vi.unstubAllEnvs());

describe("the chart chain", () => {
  it("asks Alpaca first for a US listing", () => {
    expect(barSourcesFor("AAPL")[0]).toBe(alpaca);
  });

  it("never asks Finnhub, whose free tier has no candles", () => {
    for (const symbol of ["AAPL", "RY.TO", "BTC-USD", "^GSPC"]) {
      expect(barSourcesFor(symbol)).not.toContain(finnhub);
    }
  });

  it("leaves Alpaca out for listings it cannot chart", () => {
    for (const symbol of ["RY.TO", "BTC-USD", "^GSPC"]) {
      expect(barSourcesFor(symbol)).not.toContain(alpaca);
    }
  });

  it("still asks Yahoo first for its own instruments", () => {
    expect(barSourcesFor("BTC-USD")[0]).toBe(yahoo);
    expect(barSourcesFor("^GSPC")[0]).toBe(yahoo);
  });

  it("counts any one configured source as enough to draw charts", () => {
    vi.stubEnv("TWELVEDATA_API_KEY", "");
    vi.stubEnv("TIINGO_API_KEY", "");
    vi.stubEnv("ENABLE_YAHOO_FALLBACK", "false");
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
    expect(hasAnyBarSource()).toBe(false);

    vi.stubEnv("ALPACA_API_KEY_ID", "id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "secret");
    expect(hasAnyBarSource()).toBe(true);
  });
});

describe("the message when every chart source fails", () => {
  const limited = [
    { provider: "Alpaca", category: "RATE_LIMITED" as const },
    { provider: "Twelve Data", category: "RATE_LIMITED" as const },
    { provider: "Tiingo", category: "NO_DATA" as const },
  ];

  it("never suggests a key that is already set", () => {
    vi.stubEnv("TIINGO_API_KEY", "set");
    vi.stubEnv("ALPACA_API_KEY_ID", "id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "secret");

    const message = describeBarFailure(limited);

    expect(message).toContain("rate limited right now");
    expect(message).not.toContain("TIINGO_API_KEY");
    expect(message).not.toContain("ALPACA_API_KEY_ID");
  });

  it("suggests only the sources that are missing", () => {
    vi.stubEnv("TIINGO_API_KEY", "set");
    vi.stubEnv("ALPACA_API_KEY_ID", "");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");

    const message = describeBarFailure(limited);

    expect(message).toContain("ALPACA_API_KEY_ID");
    expect(message).not.toContain("TIINGO_API_KEY");
  });

  it("describes each attempt by what happened, never with a provider's own message", () => {
    expect(describeBarFailure([{ provider: "Twelve Data", category: "PROVIDER_ERROR" }])).toBe(
      "Could not load price data: Twelve Data returned an error.",
    );
  });
});
