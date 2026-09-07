import { NextResponse } from "next/server";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { getBarsWithSource } from "@/lib/providers";
import { eodhd, twelveData } from "@/lib/providers";
import type { Timeframe } from "@/lib/providers/types";

const VALID: Timeframe[] = ["1Min", "5Min", "15Min", "1Hour", "1Day", "1Week"];

/**
 * How far back each timeframe may look.
 *
 * Minute bars are capped well below the provider's 7-year history because a
 * year of 1-minute data is ~100k points — far more than a chart can draw and
 * enough to blow the response size. Longer horizons use coarser buckets.
 */
const MAX_DAYS: Record<Timeframe, number> = {
  "1Min": 7,
  "5Min": 30,
  "15Min": 60,
  "1Hour": 365,
  "1Day": 365 * 10,
  "1Week": 365 * 25,
};

export async function GET(request: Request) {
  const limited = refuseIfRateLimited(request, "marketData");
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.toUpperCase();
  const timeframe = (params.get("timeframe") ?? "1Day") as Timeframe;
  const requestedDays = Number(params.get("days") ?? 0);

  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  if (!VALID.includes(timeframe)) {
    return NextResponse.json(
      { error: `timeframe must be one of ${VALID.join(", ")}` },
      { status: 400 },
    );
  }

  if (!twelveData.isConfigured() && !eodhd.isConfigured()) {
    return NextResponse.json(
      {
        bars: [],
        error: "not-configured",
        message:
          "Price charts need a Twelve Data key. Get a free one at twelvedata.com " +
          "(email signup, no brokerage account) and set TWELVEDATA_API_KEY.",
      },
      { status: 200 },
    );
  }

  const days = Math.min(requestedDays > 0 ? requestedDays : MAX_DAYS[timeframe], MAX_DAYS[timeframe]);
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  try {
    const { bars, source, includesDividends } = await getBarsWithSource(
      symbol,
      timeframe,
      from,
      to,
    );
    /*
      `includesDividends` is reported, not merely known.

      Which provider answered decides whether a close is a price or a total
      return, and failover means that is not fixed per symbol. Tiingo returns
      adjClose — dividends reinvested — while Yahoo and Twelve Data return
      price only. Rebasing one of each onto the same axis and calling the gap
      "relative performance" attributes a dividend stream to skill: on SPY
      since 2020 that is about 27 points of difference. The backtester already
      accounts for this (see the comment in src/lib/backtest/run.ts); the
      charts could not, because the flag stopped here.
    */
    return NextResponse.json(
      { bars, timeframe, symbol, source, includesDividends },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${timeframe === "1Min" ? 60 : 300}, stale-while-revalidate=600`,
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load bars";
    // Returned with HTTP 200 so the client renders the explanation instead of
    // a generic network failure. `error` marks it as unsuccessful.
    return NextResponse.json(
      { bars: [], error: "provider-error", message, symbol, timeframe, includesDividends: null },
      { status: 200 },
    );
  }
}
