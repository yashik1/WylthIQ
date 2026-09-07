import { NextResponse } from "next/server";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { getCorporateEvents } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * Dividends, splits and results dates for a window.
 *
 * Kept separate from the bars rather than bundled with them, so that a chart
 * still draws when this fails. Markers are an annotation on the price; losing
 * them should cost the annotation and nothing else.
 */
export async function GET(request: Request) {
  const limited = refuseIfRateLimited(request, "marketData");
  if (limited) return limited;

  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.toUpperCase();
  const days = Number(params.get("days") ?? 365);

  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const to = new Date();
  const from = new Date(to.getTime() - Math.max(1, Math.min(days, 365 * 25)) * 86_400_000);

  try {
    const events = await getCorporateEvents(symbol, from, to);
    return NextResponse.json(
      { events, symbol },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch {
    // An empty list is the honest answer here: the chart is still correct
    // without markers, and an error would only remove a working chart.
    return NextResponse.json({ events: [], symbol }, { status: 200 });
  }
}
