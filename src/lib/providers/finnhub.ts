import type { NormalizedFundamentals } from "../fundamentals/types";
import type {
  Bar,
  CompanyProfile,
  Filing,
  MarketDataProvider,
  NewsItem,
  Quote,
  SymbolSearchResult,
  Timeframe,
} from "./types";
import { ProviderNotConfiguredError } from "./types";
import { parseFinnhubRecommendations, type AnalystView } from "../signals/analysts";

const BASE = "https://finnhub.io/api/v1";

/**
 * Finnhub — news, company profiles and peers.
 *
 * Its free tier allows 60 requests/minute and covers profiles, peers and company
 * news. It deliberately does NOT provide candles here: Finnhub moved historical
 * and intraday candles to its paid plans in April 2025 and the free tier now
 * returns 403, which is why price data comes from Twelve Data instead.
 */
export class FinnhubProvider implements MarketDataProvider {
  readonly name = "Finnhub";

  /** Raw candles, when the plan serves them at all. Dividends not included. */
  readonly barsIncludeDividends = false;

  private get token() {
    return process.env.FINNHUB_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  private url(path: string, params: Record<string, string> = {}): string {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError("Finnhub", ["FINNHUB_API_KEY"]);
    }
    const search = new URLSearchParams({ ...params, token: this.token! });
    return `${BASE}${path}?${search}`;
  }

  async getProfile(symbol: string): Promise<CompanyProfile | null> {
    const res = await fetch(this.url("/stock/profile2", { symbol }), {
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return null;

    const p = (await res.json()) as {
      name?: string;
      ticker?: string;
      exchange?: string;
      country?: string;
      currency?: string;
      finnhubIndustry?: string;
      weburl?: string;
      logo?: string;
      marketCapitalization?: number;
      shareOutstanding?: number;
    };
    if (!p?.name) return null;

    return {
      symbol: symbol.toUpperCase(),
      name: p.name,
      exchange: p.exchange ?? null,
      country: p.country ?? null,
      currency: p.currency ?? null,
      sicCode: null,
      sicDescription: null,
      industry: p.finnhubIndustry ?? null,
      website: p.weburl ?? null,
      logo: p.logo ?? null,
      // Finnhub reports market cap in millions, in the currency of whichever
      // venue it priced — which is not always the one this ticker trades on.
      marketCap: p.marketCapitalization != null ? p.marketCapitalization * 1e6 : null,
      marketCapCurrency: p.currency ?? null,
      sharesOutstanding: p.shareOutstanding != null ? p.shareOutstanding * 1e6 : null,
      cik: null,
      description: null,
    };
  }

  async getNews(symbol: string, limit = 20): Promise<NewsItem[]> {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const res = await fetch(
      this.url("/company-news", { symbol, from: fmt(from), to: fmt(to) }),
      { next: { revalidate: 900 } },
    );

    // A refused key, an exhausted allowance and a company with nothing written
    // about it all used to return an empty list, so the page could only guess
    // at which — and it guessed "no key", which is the one case the reader can
    // do something about and the one that is usually wrong.
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403
          ? "Finnhub rejected the API key. Check FINNHUB_API_KEY is the key itself, not the webhook secret."
          : res.status === 429
            ? "Finnhub's free allowance is used up for the moment. It resets shortly."
            : `Finnhub returned HTTP ${res.status}.`,
      );
    }

    const items = (await res.json()) as {
      id?: number;
      headline?: string;
      summary?: string;
      source?: string;
      url?: string;
      datetime?: number;
      image?: string;
    }[];
    if (!Array.isArray(items)) return [];

    return items
      .filter((n) => n.headline && n.url)
      .slice(0, limit)
      .map((n) => ({
        id: String(n.id ?? n.url),
        headline: n.headline!,
        summary: n.summary || null,
        source: n.source ?? "Unknown",
        url: n.url!,
        publishedAt: new Date((n.datetime ?? 0) * 1000).toISOString(),
        imageUrl: n.image || null,
      }));
  }

  /** Peer tickers in the same industry, used for the comparison overlay. */
  async getPeers(symbol: string): Promise<string[]> {
    const res = await fetch(this.url("/stock/peers", { symbol }), {
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return [];
    const peers = (await res.json()) as string[];
    return Array.isArray(peers)
      ? peers.filter((p) => p && p !== symbol.toUpperCase()).slice(0, 8)
      : [];
  }

  /**
   * Published analyst ratings, as a distribution.
   *
   * On the interface as an extra method rather than on MarketDataProvider,
   * following getPeers above: only this provider answers it, and widening the
   * shared interface would mean a null stub in five other files to express
   * that.
   *
   * Note the free tier serves recommendation trends but not price targets,
   * which moved to the paid plans — so the panel this feeds shows who said
   * what without a target to compare against. See src/lib/signals/analysts.ts
   * for the licensing position, which matters more than the missing field.
   */
  async getAnalystView(symbol: string): Promise<AnalystView | null> {
    const res = await fetch(this.url("/stock/recommendation", { symbol }), {
      // Republished monthly, so a day is already far fresher than the data.
      next: { revalidate: 60 * 60 * 12 },
    });
    if (!res.ok) return null;

    return parseFinnhubRecommendations(await res.json());
  }

  async searchSymbols(query: string, limit = 10): Promise<SymbolSearchResult[]> {
    const res = await fetch(this.url("/search", { q: query }), {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      result?: { symbol: string; description: string; type: string }[];
    };
    return (json.result ?? [])
      .filter((r) => r.type === "Common Stock")
      .slice(0, limit)
      .map((r) => ({
        symbol: r.symbol,
        name: r.description,
        exchange: null,
        cik: null,
      }));
  }

  // ---- Not used from Finnhub ----

  /** Free-tier candles return 403; Twelve Data serves bars instead. */
  async getBars(_s: string, _tf: Timeframe, _from: Date, _to: Date): Promise<Bar[]> {
    return [];
  }

  /**
   * Real-time US quote.
   *
   * Finnhub's candles are paywalled, but `/quote` remains on the free tier at
   * 60 requests/minute — a far higher ceiling than Twelve Data's 8/minute, which
   * makes this the natural fallback when that limit is hit.
   */
  async getQuote(symbol: string): Promise<Quote | null> {
    const res = await fetch(this.url("/quote", { symbol }), { next: { revalidate: 30 } });
    if (!res.ok) {
      if (res.status === 429) throw new Error("Finnhub rate limit reached (60 requests/minute).");
      throw new Error(`Finnhub quote ${symbol}: HTTP ${res.status}`);
    }

    const q = (await res.json()) as {
      c?: number; d?: number; dp?: number; h?: number; l?: number; pc?: number; t?: number;
    };

    // Finnhub returns zeros rather than an error for an unknown symbol.
    if (!q.c) return null;

    return {
      symbol: symbol.toUpperCase(),
      price: q.c,
      change: q.d ?? null,
      // Reported as a percentage; stored as a ratio.
      changePercent: q.dp != null ? q.dp / 100 : null,
      previousClose: q.pc ?? null,
      dayHigh: q.h ?? null,
      dayLow: q.l ?? null,
      volume: null,
      freshness: "realtime-iex",
      asOf: q.t ? new Date(q.t * 1000).toISOString() : null,
    };
  }

  async getFundamentals(_symbol: string): Promise<NormalizedFundamentals | null> {
    return null;
  }

  async getFilings(_symbol: string, _limit?: number): Promise<Filing[]> {
    return [];
  }
}

export const finnhub = new FinnhubProvider();
