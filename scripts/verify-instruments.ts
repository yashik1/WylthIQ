/**
 * Checks every catalogue instrument still returns real price history.
 *
 * Symbols rot. Coins get delisted, ticker conventions change (MATIC became
 * POL), and contracts are retired — and the failure is quiet, because the
 * quote endpoint keeps answering with a number long after the history behind
 * it has gone. That produces the worst outcome available: a page that looks
 * fine and charts nothing.
 *
 * Several well-known tickers were dropped from the catalogue for exactly this
 * reason when it was first built. This script is how that check stays cheap
 * enough to repeat.
 *
 *   npm run instruments:verify
 *
 * Exits non-zero if anything is dead, so it can gate a deploy if wanted.
 */
import { ALL_INSTRUMENTS } from "../src/lib/instruments";

const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";

/** Below this many daily bars in a year, a symbol is not chartable. */
const MIN_BARS = 100;

interface Check {
  symbol: string;
  name: string;
  ok: boolean;
  bars: number;
  currency: string | null;
  price: number | null;
  note: string;
}

async function check(symbol: string, name: string): Promise<Check> {
  const url = `${CHART}/${encodeURIComponent(symbol)}?range=1y&interval=1d`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WylthIQ/1.0)" },
    });

    if (!res.ok) {
      return { symbol, name, ok: false, bars: 0, currency: null, price: null, note: `HTTP ${res.status}` };
    }

    const json = (await res.json()) as {
      chart?: {
        result?: {
          meta?: { currency?: string; regularMarketPrice?: number };
          timestamp?: number[];
        }[];
      };
    };

    const result = json.chart?.result?.[0];
    if (!result) {
      return { symbol, name, ok: false, bars: 0, currency: null, price: null, note: "no result" };
    }

    const bars = result.timestamp?.length ?? 0;
    const currency = result.meta?.currency ?? null;
    const price = result.meta?.regularMarketPrice ?? null;

    if (bars < MIN_BARS) {
      return { symbol, name, ok: false, bars, currency, price, note: `only ${bars} bars in a year` };
    }

    return { symbol, name, ok: true, bars, currency, price, note: "" };
  } catch (err) {
    return {
      symbol, name, ok: false, bars: 0, currency: null, price: null,
      note: err instanceof Error ? err.message.slice(0, 60) : "request failed",
    };
  }
}

async function main() {
  console.log(`Checking ${ALL_INSTRUMENTS.length} instruments against Yahoo Finance…\n`);

  const results: Check[] = [];

  // Sequential rather than parallel. There is no published rate limit to
  // respect exactly, and firing sixty simultaneous requests at a free endpoint
  // is the kind of thing that gets an IP blocked — which would look identical
  // to every symbol being dead.
  for (const instrument of ALL_INSTRUMENTS) {
    const result = await check(instrument.symbol, instrument.name);
    results.push(result);
    const mark = result.ok ? "ok  " : "DEAD";
    const detail = result.ok
      ? `${String(result.bars).padStart(4)} bars  ${result.currency ?? "?"}`
      : result.note;
    console.log(`  ${mark} ${instrument.symbol.padEnd(10)} ${instrument.name.padEnd(22)} ${detail}`);
  }

  const dead = results.filter((r) => !r.ok);

  /*
    Cents-quoted contracts are cross-checked against their stated unit.

    Yahoo reports these as `USX`, and the catalogue's `unit` string is what the
    page shows a reader. If the two ever disagree, a price is being rendered in
    the wrong denomination by a factor of a hundred — the exact failure this
    catalogue was built to avoid — and it would not otherwise surface.
  */
  const centsMismatch = results.filter((r) => {
    if (!r.ok || !r.currency) return false;
    const instrument = ALL_INSTRUMENTS.find((i) => i.symbol === r.symbol);
    const saysCents = /cents/i.test(instrument?.unit ?? "");
    const isCents = r.currency.toUpperCase() === "USX";
    return saysCents !== isCents;
  });

  console.log(`\n${results.length - dead.length} of ${results.length} returned usable history.`);

  if (centsMismatch.length > 0) {
    console.error("\nUnit mismatch — the price would render in the wrong denomination:");
    for (const r of centsMismatch) {
      const instrument = ALL_INSTRUMENTS.find((i) => i.symbol === r.symbol);
      console.error(`  ${r.symbol.padEnd(10)} provider says ${r.currency}, catalogue says "${instrument?.unit}"`);
    }
  }

  if (dead.length > 0) {
    console.error("\nRemove or replace these in src/lib/instruments.ts:");
    for (const r of dead) console.error(`  ${r.symbol.padEnd(10)} ${r.name.padEnd(22)} ${r.note}`);
  }

  if (dead.length > 0 || centsMismatch.length > 0) process.exitCode = 1;
  else console.log("Every instrument checks out.");
}

main().catch((err) => {
  console.error("Verification failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
