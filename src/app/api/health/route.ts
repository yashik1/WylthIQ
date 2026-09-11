import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import {
  finnhub,
  getNewsWithSource,
  getProvider,
  providerStatus,
  twelveData,
  yahoo,
} from "@/lib/providers";
import { classifyProviderError } from "@/lib/providers/errors";

export const dynamic = "force-dynamic";

const TABLES = ["companies", "financials", "scores", "price_cache", "ingest_runs"];

/** When this process started — a deploy that never restarted never picked up new code. */
const STARTED_AT = new Date().toISOString();

/**
 * Which commit is actually serving this request.
 *
 * "Is the deployment running the code I just pushed?" has cost this project
 * several debugging rounds in both directions — time spent hunting a bug that
 * was already fixed, and time spent trusting a fix that was never live. Nothing
 * in the app could answer it from the outside, so it stayed a guess.
 *
 * Railway injects the commit it built from; other hosts use their own name for
 * it, so several are read before giving up. Only the short SHA is exposed,
 * which is what a public repository already shows.
 */
function buildInfo(): Record<string, unknown> {
  const sha =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.GIT_COMMIT ||
    null;

  return {
    commit: sha ? sha.slice(0, 7) : "unknown",
    branch: process.env.RAILWAY_GIT_BRANCH || process.env.VERCEL_GIT_COMMIT_REF || null,
    startedAt: STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    note:
      "Compare `commit` against the newest commit on the repository. If it is " +
      "behind, the deployment has not rebuilt and any recent fix is not live yet.",
  };
}

/**
 * Reports what the *running application* can actually see.
 *
 * Diagnosing an empty screener from the outside is guesswork, because the app
 * and any admin shell may be on different networks with different environments.
 * Hitting this on the deployment that renders the page answers it directly.
 *
 * Deliberately exposes no credentials: the connection string is reduced to a
 * host and database name.
 */
/**
 * Whether this caller may see the diagnostics.
 *
 * The detail below is genuinely useful — it has diagnosed a stale deployment,
 * an internal-only database hostname and a refused provider key — but it is
 * also a map of the deployment: the database host, which tables exist, how
 * many rows they hold, which providers are configured, the running commit and
 * how long the process has been up. None of that helps an anonymous visitor
 * and all of it helps somebody deciding what to try.
 *
 * So the shape of the answer depends on who is asking. HEALTH_SECRET if it is
 * set, otherwise CRON_SECRET, so a deployment does not need a second secret to
 * keep its own diagnostics — but can have one.
 */
function isInternalCaller(request: Request): boolean {
  const secret = process.env.HEALTH_SECRET || process.env.CRON_SECRET;
  if (!secret) return false;

  const header = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (header.length !== expected.length) return false;
  return timingSafeEqual(header, expected);
}

export async function GET(request: Request) {
  const started = Date.now();

  /*
    Answered before any work is done, not after.

    The probes below open a database connection, introspect the schema, count
    two tables and make four live calls to metered price and news providers.
    Running all of that for an anonymous caller — and then discarding it to
    return one word — would turn this endpoint into a way to spend somebody
    else's API quota at one request per hit. So the cheap answer returns
    first, and nothing expensive runs for a caller who could not read it
    anyway.
  */
  if (!isInternalCaller(request)) {
    const limited = refuseIfRateLimited(request, "marketData");
    if (limited) return limited;

    return NextResponse.json(
      { status: isDatabaseConfigured() ? "ok" : "degraded" },
      {
        status: isDatabaseConfigured() ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const url = process.env.DATABASE_URL;
  const database: Record<string, unknown> = {
    configured: isDatabaseConfigured(),
    host: url ? describeUrl(url) : null,
    // The single most common misconfiguration: an internal-only hostname used
    // from a deployment that sits outside that private network.
    internalHostname: url ? /\.railway\.internal|\.internal\b/.test(url) : false,
  };

  if (isDatabaseConfigured()) {
    try {
      const db = getDb();

      const present = await db.execute<{ table_name: string }>(sql`
        SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      `);
      const names = new Set(present.map((r) => r.table_name));
      database.tables = Object.fromEntries(TABLES.map((t) => [t, names.has(t)]));
      database.missingTables = TABLES.filter((t) => !names.has(t));

      if (names.has("companies")) {
        const counts = await db.execute<{ companies: number; scores: number }>(sql`
          SELECT
            (SELECT count(*)::int FROM companies) AS companies,
            (SELECT count(*)::int FROM scores) AS scores
        `);
        database.companies = counts[0]?.companies ?? 0;
        database.scores = counts[0]?.scores ?? 0;
      }

      database.reachable = true;
    } catch (err) {
      database.reachable = false;
      database.error = redact(err);
    }
  }

  const status = summarize(database);
  const httpStatus = status.state === "ok" ? 200 : 503;

  return NextResponse.json(
    {
      status: status.state,
      message: status.message,
      build: buildInfo(),
      database,
      providers: providerStatus(),
      priceData: await probePriceProvider(),
      news: await probeNews(),
      search: await probeSearch(),
      yahooFallback: await yahoo.probe(),
      checkedInMs: Date.now() - started,
    },
    { status: httpStatus, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Whether the reader gets headlines, and which source supplied them.
 *
 * Reports the chain and Finnhub separately, because they can disagree and both
 * answers matter. The chain is what a reader actually sees; Finnhub alone is
 * what needs fixing. Reporting only the first would call news healthy while a
 * refused key sat unnoticed behind a fallback, and reporting only the second
 * would call it broken while the panel was full — this endpoint has been read
 * as the truth about the deployment often enough to be worth stating precisely.
 *
 * AMAT is the canary: heavily covered, so an empty result points at the
 * plumbing rather than at the company.
 */
async function probeNews(): Promise<Record<string, unknown>> {
  if (!finnhub.isConfigured()) {
    return {
      configured: false,
      note: "FINNHUB_API_KEY is not set, so the news panel stays empty.",
    };
  }

  // What the reader actually gets, which is the chain rather than any one link.
  const chain = await getNewsWithSource("AMAT", 5).catch((err: unknown) => ({
    news: [],
    source: null,
    error: err instanceof Error ? err.message : String(err),
  }));

  // Finnhub separately, because the chain succeeding through a fallback would
  // otherwise hide a key that needs replacing.
  const finnhubNote = await finnhub
    .getNews("AMAT", 5)
    .then((items) =>
      items.length > 0
        ? "working"
        : "accepted the key but returned no articles for AMAT, which is unusual for a " +
          "company this size — the key may be on a plan that excludes company news",
    )
    .catch((err: unknown) => (err instanceof Error ? err.message : String(err)));

  return {
    configured: true,
    working: chain.news.length > 0,
    articlesReturned: chain.news.length,
    servedBy: chain.source,
    finnhub: finnhubNote,
    note:
      chain.news.length > 0
        ? `News is working, served by ${chain.source}.` +
          (chain.source === "Finnhub" ? "" : " Finnhub is not answering — see `finnhub`.")
        : "No source in the chain returned anything, which should not happen for a " +
          "US filer while SEC EDGAR is reachable.",
  };
}

/**
 * Checks that search can find a company outside SEC coverage.
 *
 * Worth its own probe because it is the one capability that depends on no API
 * key at all, so "it returns nothing" almost always means the deployment is
 * running code from before worldwide search existed, rather than a
 * misconfiguration. ATZ is used as the canary: a real TSX-only ticker that SEC
 * EDGAR will never have.
 */
async function probeSearch(): Promise<Record<string, unknown>> {
  try {
    const results = await getProvider().searchSymbols("ATZ", 8);
    const foreign = results.find((r) => r.symbol.toUpperCase() === "ATZ");

    return {
      worldwideSearch: foreign ? "working" : "not working",
      results: results.length,
      foundForeignListing: Boolean(foreign),
      example: foreign
        ? `${foreign.symbol} — ${foreign.name} (${foreign.exchange ?? "?"})`
        : null,
      note: foreign
        ? "Worldwide search is live; foreign tickers resolve."
        : "ATZ did not resolve. This deployment is most likely running a build " +
          "from before worldwide search was added — redeploy from main.",
    };
  } catch (err) {
    return {
      worldwideSearch: "error",
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  }
}

/**
 * Makes one real call to the price provider and reports what came back.
 *
 * A key can be present and still not work — invalid, out of quota, or on a plan
 * that excludes the endpoint. Only an actual request distinguishes those, and
 * the provider's own message is the thing worth reading.
 */
async function probePriceProvider(): Promise<Record<string, unknown>> {
  if (!twelveData.isConfigured()) {
    return {
      configured: false,
      note: "TWELVEDATA_API_KEY is not set, so charts and quotes are unavailable.",
    };
  }

  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);

  try {
    const bars = await twelveData.getBars("AAPL", "1Day", from, to);
    return {
      configured: true,
      working: bars.length > 0,
      barsReturned: bars.length,
      note:
        bars.length > 0
          ? "Price data is working."
          : "The request succeeded but returned no bars for AAPL over the last week.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      working: false,
      category: classifyProviderError(err),
      // The provider's own wording usually names the cause outright.
      error: message.slice(0, 300),
      note: /api key|apikey|unauthor/i.test(message)
        ? "The API key appears to be invalid."
        : /limit|credit|quota|run out/i.test(message)
          ? "The plan's request limit has been reached. The free plan allows 8 requests/minute and 800/day."
          : "The provider rejected the request.",
    };
  }
}

function describeUrl(url: string): string {
  try {
    const { hostname, port, pathname } = new URL(url);
    return `${hostname}:${port || 5432}${pathname}`;
  } catch {
    return "unparseable";
  }
}

function redact(err: unknown): string {
  let current: unknown = err;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: string }).code;
    if (code) return `${code}: ${(current as Error).message?.split("\n")[0] ?? ""}`.slice(0, 200);
    current = (current as { cause?: unknown }).cause;
  }
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]").slice(0, 200);
}

function summarize(database: Record<string, unknown>): { state: string; message: string } {
  if (!database.configured) {
    return {
      state: "no-database",
      message:
        "DATABASE_URL is not set on this deployment. Stock pages work; the screener needs it.",
    };
  }
  if (database.reachable === false) {
    return {
      state: "unreachable",
      message: database.internalHostname
        ? "DATABASE_URL uses an internal-only hostname, which cannot be reached from this " +
          "deployment. Enable public access on the database and use its public URL here."
        : `Could not connect to the database. ${database.error ?? ""}`,
    };
  }
  const missing = (database.missingTables as string[]) ?? [];
  if (missing.length > 0) {
    return {
      state: "no-tables",
      message: `Connected, but ${missing.length} table(s) are missing. Run: npm run db:migrate`,
    };
  }
  if ((database.companies as number) === 0) {
    return {
      state: "empty",
      message: "Connected with tables present but no companies. Run: npm run ingest",
    };
  }
  return {
    state: "ok",
    message: `Healthy — ${database.companies} companies loaded.`,
  };
}
