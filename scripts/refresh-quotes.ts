/**
 * Refreshes stored quotes for the screening universe.
 *
 * Separate from the fundamentals ingest because the two change at completely
 * different rates: filings quarterly, prices constantly. Run this as often as
 * your price plan allows — Finnhub's free tier permits 60 requests a minute, so
 * the full universe takes roughly ten minutes.
 *
 * Then works out each company's price trends — moving averages, the last
 * 50/200-day cross, the 52-week range, RSI — for the screener's price-trend
 * filter, from daily bars (see src/lib/technicals-refresh.ts).
 *
 *   npm run quotes
 *   npm run quotes -- --limit 50
 *   npm run quotes -- AAPL MSFT RY
 *   npm run quotes -- --skip-technicals     quotes only
 *   npm run technicals                      price trends only
 */
import "dotenv/config";
import { closeDb } from "../src/lib/db";
import { refreshQuotes } from "../src/lib/ingest";
import { refreshTechnicals } from "../src/lib/technicals-refresh";
import { hasAnyPriceProvider } from "../src/lib/providers";
import { getUniverse } from "../src/lib/universe";

/** Comfortably inside Finnhub's free limit of 60 a minute. */
const DEFAULT_PER_MINUTE = 55;
/** Half of Alpaca's free 200 a minute, which serves the US listings' daily bars. */
const DEFAULT_TECHNICALS_PER_MINUTE = 100;

/** A tally, largest first. */
function printCounts(title: string, counts: Record<string, number>): void {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return;
  console.log();
  console.log(`${title}:`);
  for (const [key, count] of entries.slice(0, 12)) console.log(`  ${key.padEnd(36)} ${count}`);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    console.error("DATABASE_URL is not set — there is nowhere to store quotes.");
    process.exit(1);
  }

  // An internal hostname only resolves inside Railway's own network — this
  // workflow runs on a GitHub-hosted runner, outside it. Without this check the
  // connection just fails deep inside the postgres driver with a raw network
  // error; this turns that into an immediate, actionable explanation. Mirrors
  // the same guard in scripts/ingest.ts.
  if (/\.railway\.internal/.test(dbUrl) && !process.env.RAILWAY_ENVIRONMENT) {
    console.error(
      "DATABASE_URL points at railway.internal, which only resolves inside Railway.\n" +
        "Use the Postgres service's PUBLIC connection string instead (Railway ->\n" +
        "Postgres service -> Connect -> Public Network).\n",
    );
    process.exit(1);
  }

  /*
    A quote request degrades a total provider failure to `null` rather than
    throwing — right for a stock page, wrong for this script. With every
    source unconfigured, every one of hundreds of symbols would resolve to
    "no quote" just as fast as if it had actually been checked: no error, a
    suspiciously quick run, and a final tally of 0 updated / 0 failed that
    explains nothing. Catching it here instead of discovering it symbol 544.
  */
  if (!hasAnyPriceProvider()) {
    console.error(
      "No price provider is configured — nothing here would ever return a quote.\n" +
        "Set at least one of FINNHUB_API_KEY, TWELVEDATA_API_KEY, TIINGO_API_KEY or\n" +
        "EODHD_API_KEY (or ENABLE_YAHOO_FALLBACK=true).\n",
    );
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const symbols: string[] = [];
  let limit: number | null = null;
  const technicalsOnly = argv.includes("--technicals-only");
  const skipTechnicals = argv.includes("--skip-technicals");

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") {
      limit = Number(argv[++i]);
    } else if (!argv[i].startsWith("--")) {
      symbols.push(argv[i].toUpperCase());
    }
  }

  let targets = symbols.length > 0 ? symbols : getUniverse();
  if (limit && limit > 0) targets = targets.slice(0, limit);

  /*
    Paced, because the free price tiers count requests per minute.

    Twelve Data's free plan allows 8 a minute and Finnhub's 60, and this used
    to send as fast as two workers could go — several hundred a minute. At
    that rate both refuse almost at once and the chain falls through to
    whatever answers last. The comment at the top of this file budgets the
    universe at about ten minutes; the scheduled runs were finishing in under
    two, and one that ran at a real pace took nineteen.
  */
  const perMinute = Number(process.env.QUOTE_REQUESTS_PER_MINUTE) || DEFAULT_PER_MINUTE;

  const started = Date.now();

  try {
    let working = true;

    if (!technicalsOnly) {
      working = await runQuotes(targets, perMinute, started);
    }

    if (!skipTechnicals) {
      const trendsWorking = await runTechnicals(targets);
      working = working && trendsWorking;
    }

    await closeDb();
    process.exit(working ? 0 : 1);
  } catch (err) {
    console.log();
    console.error(err instanceof Error ? err.message : String(err));
    await closeDb();
    process.exit(1);
  }
}

/** The quotes half of the run. True when it brought in current prices. */
async function runQuotes(targets: string[], perMinute: number, started: number): Promise<boolean> {
  console.log(`Refreshing quotes for ${targets.length} symbols, at most ${perMinute} a minute...`);
  console.log();

  const result = await refreshQuotes(
    targets,
    (done, total) => {
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`\r  [${String(pct).padStart(3)}%] ${done}/${total}   `);
    },
    { perMinute },
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log();
  console.log();
  console.log(
    `Done in ${seconds}s — ${result.updated} current, ${result.stale} too old to be current, ` +
      `${result.unavailable} with no price at all, ${result.failed} failed.`,
  );

  printCounts("Current prices came from", result.answeredBy);
  printCounts("Provider failures, by category", result.providerFailures);

  if (result.errors.length > 0) {
    console.log();
    console.log("First failures:");
    for (const e of result.errors.slice(0, 10)) console.log(`  ${e}`);
  }

  /*
    A run only counts as working when it brought in current prices.

    This used to pass whenever a single row was written. So a run in which
    every provider fell back to a month-old close wrote those closes, exited
    0, and showed green in the Actions tab — while the dashboard displayed
    August's prices under September's date.
  */
  const working = result.updated > 0 && result.updated >= result.stale;
  if (!working) {
    console.error();
    console.error(
      "This run did not bring in current prices" +
        (result.newestStale ? ` — the newest any provider offered was from ${result.newestStale}` : "") +
        ".",
    );
    console.error("The dashboard's movers and sectors cannot show today until a provider answers;");
    console.error("the failure counts above say which providers did not, and why.");
  }
  return working;
}

/**
 * The price-trend half: moving averages, crosses, the 52-week range and RSI.
 * True when it updated any company — a run that updated none leaves the
 * screener's trend filter on old figures, and should say so by failing.
 */
async function runTechnicals(targets: string[]): Promise<boolean> {
  const perMinute = Number(process.env.TECHNICALS_REQUESTS_PER_MINUTE) || DEFAULT_TECHNICALS_PER_MINUTE;
  const started = Date.now();
  console.log();
  console.log(`Working out price trends for ${targets.length} symbols, at most ${perMinute} bar requests a minute...`);
  console.log();

  const result = await refreshTechnicals(
    targets,
    (done, total) => {
      const pct = Math.round((done / total) * 100);
      process.stdout.write(`\r  [${String(pct).padStart(3)}%] ${done}/${total}   `);
    },
    { perMinute },
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log();
  console.log();
  console.log(
    `Done in ${seconds}s — ${result.updated} updated${result.newestAsOf ? ` (as of ${result.newestAsOf})` : ""}, ` +
      `${result.noHistory} with no daily history, ${result.failed} failed.`,
  );
  printCounts("Daily bars came from", result.answeredBy);
  if (result.errors.length > 0) {
    console.log();
    console.log("First failures:");
    for (const e of result.errors.slice(0, 10)) console.log(`  ${e}`);
  }

  const working = targets.length === 0 || result.updated > 0;
  if (!working) {
    console.error();
    console.error("No company's price trends were updated, so the screener's trend filter is on old figures.");
    console.error("The failures above say which providers did not answer; Alpaca's keys serve the US listings.");
  }
  return working;
}

main();
