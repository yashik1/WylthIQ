import { NextResponse } from "next/server";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { getProvider } from "@/lib/providers";
import { ASSET_CLASS_LABEL, searchInstruments } from "@/lib/instruments";
import { addressSearchResults } from "@/lib/exchange-suffix";
import type { SymbolSearchResult } from "@/lib/providers/types";
import { searchTopics } from "@/lib/learn/topics";

/**
 * Symbol search.
 *
 * Explicitly dynamic and uncached. It previously exported `revalidate = 3600`,
 * which asks Next to cache the handler's response — wrong for a route whose
 * whole output depends on a query string, and a way for one empty or failed
 * result to be served for an hour afterwards. The upstream calls do their own
 * caching, which is the right layer for it.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = refuseIfRateLimited(request, "search");
  if (limited) return limited;

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 1) return NextResponse.json({ results: [] });

  /*
    Commodities, contracts and coins are matched locally, first.

    The upstream directory is a directory of *companies*: searching it for
    "gold" returns gold miners, and for "bitcoin" a handful of trusts holding
    it, but never gold or Bitcoin themselves — which made the whole catalogue
    unreachable to anyone who did not already know to type "GC=F".

    Local matches lead because they are exact rather than fuzzy, and because
    they survive the upstream being down: a search for "gold" keeps working
    when the equity provider is rate-limited, which is when a dead search box
    is least excusable.
  */
  const local: SymbolSearchResult[] = searchInstruments(query, 5).map((i) => ({
    symbol: i.symbol,
    name: i.unit ? `${i.name} · ${i.unit}` : i.name,
    // The chip beside the name. "Crypto" and "Commodity" say more here than
    // any venue would.
    exchange: ASSET_CLASS_LABEL[i.assetClass],
    cik: null,
    // These pages work — chart, comparison and backtest all apply. "Not
    // supported" is reserved for a listing this deployment genuinely cannot
    // show, and claiming it here would be wrong.
    supported: true,
  }));

  /*
    Guides and explanations, matched locally and returned beside the symbols
    rather than mixed into them. Like the instruments above, they need no
    upstream, so they survive the equity provider being down.
  */
  const topics = searchTopics(query, 3).map(({ title, kind, href }) => ({ title, kind, href }));

  const remaining = Math.max(0, 8 - local.length);

  try {
    /*
      Each row linked to the listing it names: VGRO on the TSX is VGRO.TO, not
      the US fund at VGRO. Twice as many are asked for as are shown, because
      collapsing cross-listed duplicates — most Toronto ETFs also trade on Cboe
      Canada — can halve what comes back.
    */
    const upstream =
      remaining > 0
        ? addressSearchResults(await getProvider().searchSymbols(query, remaining * 2)).slice(
            0,
            remaining,
          )
        : [];
    const seen = new Set(local.map((r) => r.symbol.toUpperCase()));
    const results = [...local, ...upstream.filter((r) => !seen.has(r.symbol.toUpperCase()))];

    return NextResponse.json(
      { results, topics },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    // Previously this returned an empty list, which made every failure look
    // identical to "no company matched" — the single most confusing outcome,
    // because there is nothing to act on. The reason is now reported.
    // Local matches are still returned: a failure upstream is no reason to
    // withhold an answer this route already has in hand.
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json(
      { results: local, topics, error: "search-failed", message },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
