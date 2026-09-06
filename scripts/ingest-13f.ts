/**
 * Ingests one quarter of Form 13F institutional holdings from the SEC.
 *
 *   npm run 13f              # newest quarter published
 *   npm run 13f -- --dry-run # parse and report, write nothing
 *   npm run 13f -- --dry-run --symbol AAPL    # report on one company
 *   npm run 13f -- --url https://www.sec.gov/files/.../01dec2025-28feb2026_form13f.zip
 *
 * Why this is a script and not a route. The SEC publishes 13F as a quarterly
 * bundle whose INFOTABLE.tsv is roughly 380MB unzipped and several million
 * rows — every position of every manager over $100M, for every security. A
 * request handler cannot download and stream that, and asking EDGAR for each
 * manager's filing individually would be tens of thousands of requests to
 * answer one question about one company.
 *
 * So: one download, streamed line by line, discarding every row whose CUSIP is
 * not in our universe before it is ever parsed. That is the whole design, and
 * it is why memory stays flat while the file does not.
 *
 * Public domain. Unlike the price and short-interest feeds this carries no
 * licensing restriction at all.
 */
import "dotenv/config";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import yauzl from "yauzl-promise";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db";
import { companies, cusipSymbols, institutionalHoldings } from "../src/lib/db/schema";
import { getUniverse } from "../src/lib/universe";
import {
  isShareholding,
  normalizeQuarter,
  resolveManagerPosition,
  summarisePositions,
  type AggregatedPosition,
  type FilingPosition,
} from "../src/lib/signals/institutional";

const INDEX = "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets";
const FTD_INDEX = "https://www.sec.gov/data/foiadocsfailsdatahtm";

const UA = process.env.SEC_USER_AGENT ?? "WylthIQ (contact not configured)";

/** Rows written per insert. Postgres caps parameters per statement at 65535. */
const BATCH = 500;

/** How many Fails-to-Deliver files to merge for the CUSIP crosswalk. */
const FTD_FILES = 3;

function log(message: string) {
  console.log(message);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/**
 * The newest quarterly bundle the SEC has published.
 *
 * Scraped rather than constructed. The filenames are filing-period ranges
 * (`01mar2026-31may2026_form13f.zip`) rather than quarter labels, and the SEC
 * has moved these files between directories before — the Fails-to-Deliver
 * index below currently serves two different paths for adjacent months. A
 * guessed URL returns a 404 page with a 200-shaped body, so guessing is worse
 * than reading the index.
 */
async function latestDatasetUrl(): Promise<string> {
  const html = await fetchText(INDEX);
  const hrefs = [...html.matchAll(/href="([^"]*form-13f-data-sets\/[^"]*\.zip)"/g)].map((m) =>
    m[1].startsWith("http") ? m[1] : `https://www.sec.gov${m[1]}`,
  );

  if (hrefs.length === 0) throw new Error("No 13F dataset links found on the SEC index page.");
  // The index lists newest first, and has for as long as it has existed.
  return hrefs[0];
}

/** Downloads to a temp file; 100MB is too much to hold in memory as a Buffer. */
async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
}

/** Reads one file out of a zip, a line at a time, without unpacking the rest. */
async function* zipLines(zipPath: string, entryName: string): AsyncGenerator<string> {
  const zip = await yauzl.open(zipPath);
  try {
    for await (const entry of zip) {
      if (entry.filename !== entryName) continue;
      const stream = await entry.openReadStream();
      for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
        yield line;
      }
      return;
    }
    throw new Error(`${entryName} not found in ${zipPath}`);
  } finally {
    await zip.close();
  }
}

/** Splits a TSV line, given the header, into a keyed record. */
function rowReader(header: string) {
  const columns = header.split("\t");
  return (line: string): Record<string, string> => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]] = cells[i] ?? "";
    return row;
  };
}

/**
 * CUSIP to ticker, merged from the SEC's Fails-to-Deliver files.
 *
 * 13F names securities by CUSIP and this app names them by ticker, and the SEC
 * publishes no crosswalk between the two. These files are the way across: they
 * carry CUSIP, symbol and issuer name together, they are public domain, and
 * any actively traded security shows up in one within a month. A single
 * half-month file already carries about 13,500 securities; three are merged so
 * that a company with a quiet fortnight is not missed.
 */
async function buildCusipMap(dir: string, wanted: Set<string>): Promise<Map<string, string>> {
  const html = await fetchText(FTD_INDEX);
  const hrefs = [...html.matchAll(/href="([^"]*cnsfails\d+[ab]\.zip)"/g)]
    .map((m) => (m[1].startsWith("http") ? m[1] : `https://www.sec.gov${m[1]}`))
    .slice(0, FTD_FILES);

  const map = new Map<string, string>();

  for (const [i, url] of hrefs.entries()) {
    const path = join(dir, `ftd${i}.zip`);
    await download(url, path);

    const zip = await yauzl.open(path);
    try {
      for await (const entry of zip) {
        const stream = await entry.openReadStream();
        for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
          // SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY|DESCRIPTION|PRICE
          const parts = line.split("|");
          if (parts.length < 3) continue;
          const cusip = parts[1]?.trim();
          const symbol = parts[2]?.trim().toUpperCase();
          if (!cusip || !symbol || !wanted.has(symbol)) continue;
          map.set(cusip, symbol);
        }
      }
    } finally {
      await zip.close();
    }
    log(`  ${url.split("/").pop()} — ${map.size} of our symbols matched so far`);
  }

  return map;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const urlArg = argv.indexOf("--url");
  const explicitUrl = urlArg >= 0 ? argv[urlArg + 1] : null;
  const symbolArg = argv.indexOf("--symbol");
  const only = symbolArg >= 0 ? argv[symbolArg + 1]?.toUpperCase() : null;

  // A dry run parses and reports without touching the database, so the whole
  // download-and-aggregate path can be exercised on a machine that has no
  // DATABASE_URL — which is most of them, and all of the ones where this was
  // developed.
  if (!dryRun && !process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — there is nowhere to store holdings.");
    process.exit(1);
  }

  const dir = await mkdtemp(join(tmpdir(), "sf13f-"));

  try {
    /*
      Only the companies this app actually shows are worth keeping. The dataset
      covers every US-listed security and our universe is a few hundred of
      them, so filtering on the way in is what keeps memory flat against a file
      that does not fit in it.

      Taken from the static universe rather than the companies table so the
      parse needs no database — the row ids are only wanted at the point of
      writing, and are looked up then.
    */
    const wanted = new Set(getUniverse().map((s) => s.toUpperCase()));
    log(`Universe: ${wanted.size} symbols.`);

    log("Building the CUSIP crosswalk from Fails-to-Deliver files...");
    const cusipToSymbol = await buildCusipMap(dir, wanted);
    log(`Crosswalk: ${cusipToSymbol.size} CUSIPs map into the universe.`);

    const url = explicitUrl ?? (await latestDatasetUrl());
    log(`Dataset: ${url}`);

    const zipPath = join(dir, "form13f.zip");
    await download(url, zipPath);
    log("Downloaded.");

    /*
      Pass one: the cover pages, which carry the manager's name and the quarter
      the report is for. Small enough to hold — about 12,000 filings — and the
      only way to know which quarter an INFOTABLE row belongs to, since the
      bundle contains stragglers filed late for several earlier quarters.
    */
    const filings = new Map<
      string,
      { manager: string; quarter: string; isRestatement: boolean }
    >();
    const quarterCounts = new Map<string, number>();
    let coverHeader: ((line: string) => Record<string, string>) | null = null;

    for await (const line of zipLines(zipPath, "COVERPAGE.tsv")) {
      if (!coverHeader) {
        coverHeader = rowReader(line);
        continue;
      }
      const row = coverHeader(line);
      const quarter = normalizeQuarter(row.REPORTCALENDARORQUARTER);
      if (!quarter) continue;

      filings.set(row.ACCESSION_NUMBER, {
        manager: row.FILINGMANAGER_NAME?.trim(),
        quarter,
        // A restatement replaces the filing it amends. See
        // resolveManagerPosition for why getting this wrong doubles the
        // largest holder of every large company.
        isRestatement:
          row.ISAMENDMENT?.trim().toUpperCase() === "Y" &&
          row.AMENDMENTTYPE?.trim().toUpperCase() === "RESTATEMENT",
      });
      quarterCounts.set(quarter, (quarterCounts.get(quarter) ?? 0) + 1);
    }

    // The bundle is grouped by filing date, so it holds one dominant quarter
    // plus late filings for several earlier ones. Only the dominant one is
    // complete enough to report.
    const target = [...quarterCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!target) throw new Error("No cover pages parsed — the dataset format may have changed.");
    const [quarter, filingCount] = target;
    log(`Quarter: ${quarter} (${filingCount} filings; ${filings.size} cover pages in total).`);

    /*
      Pass two: the accession number to filer CIK, so a manager is identified
      by something stable. Names are typed by hand into the filing and drift
      between quarters, which would make the same manager look like a new
      holder every time it changed its own capitalisation.
    */
    const submissions = new Map<string, { cik: string; filedAt: string }>();
    let subHeader: ((line: string) => Record<string, string>) | null = null;

    for await (const line of zipLines(zipPath, "SUBMISSION.tsv")) {
      if (!subHeader) {
        subHeader = rowReader(line);
        continue;
      }
      const row = subHeader(line);
      submissions.set(row.ACCESSION_NUMBER, {
        cik: row.CIK?.trim(),
        // Same 31-MAR-2026 shape as the quarter, so the same parser reads it.
        // Only used to order one restatement against another.
        filedAt: normalizeQuarter(row.FILING_DATE) ?? "",
      });
    }

    /*
      Pass three: the holdings themselves, streamed. Everything not in the
      target quarter, not a shareholding, or not a CUSIP we care about is
      dropped before any number is parsed.

      Positions are keyed by manager CIK rather than accession, so an amended
      filing overwrites the original instead of being added to it. Without
      that, Vanguard appears twice on Apple with two different valuations and
      the totals are quietly wrong.
    */
    /*
      symbol -> manager CIK -> that manager's filings for the quarter.

      Kept per filing rather than summed straight into a running total,
      because an amendment that restates a position has to replace the
      original rather than be added to it — see resolveManagerPosition.
    */
    const bySymbol = new Map<
      string,
      Map<string, { name: string; filings: Map<string, FilingPosition> }>
    >();
    let infoHeader: ((line: string) => Record<string, string>) | null = null;
    let scanned = 0;
    let kept = 0;

    for await (const line of zipLines(zipPath, "INFOTABLE.tsv")) {
      if (!infoHeader) {
        infoHeader = rowReader(line);
        continue;
      }

      scanned++;
      if (scanned % 1_000_000 === 0) log(`  scanned ${(scanned / 1e6).toFixed(0)}M rows...`);

      const row = infoHeader(line);
      const symbol = cusipToSymbol.get(row.CUSIP?.trim());
      if (!symbol) continue;

      const filing = filings.get(row.ACCESSION_NUMBER);
      if (!filing || filing.quarter !== quarter) continue;
      if (!isShareholding(row)) continue;

      const submission = submissions.get(row.ACCESSION_NUMBER);
      if (!submission?.cik) continue;

      const shares = Number(row.SSHPRNAMT);
      const value = Number(row.VALUE);
      if (!Number.isFinite(shares) || shares <= 0) continue;

      let managers = bySymbol.get(symbol);
      if (!managers) bySymbol.set(symbol, (managers = new Map()));

      let manager = managers.get(submission.cik);
      if (!manager) {
        managers.set(
          submission.cik,
          (manager = { name: filing.manager || "Unnamed filer", filings: new Map() }),
        );
      }

      // Within one filing, lines accumulate: a manager legitimately reports
      // the same security several times when it holds it under different
      // discretion categories or through several sub-advisers.
      const existing = manager.filings.get(row.ACCESSION_NUMBER);
      if (existing) {
        existing.shares += shares;
        existing.value += Number.isFinite(value) ? value : 0;
      } else {
        manager.filings.set(row.ACCESSION_NUMBER, {
          accession: row.ACCESSION_NUMBER,
          shares,
          value: Number.isFinite(value) ? value : 0,
          isRestatement: filing.isRestatement,
          filedAt: submission.filedAt,
        });
      }
      kept++;
    }

    log(`Scanned ${scanned.toLocaleString()} holdings rows; kept ${kept.toLocaleString()}.`);
    log(`Companies with holders: ${bySymbol.size}.`);

    const summaries = [...bySymbol.entries()].map(([symbol, managers]) => {
      const positions: AggregatedPosition[] = [];

      for (const [cik, manager] of managers) {
        const { shares, value } = resolveManagerPosition([...manager.filings.values()]);
        if (shares > 0) positions.push({ cik, name: manager.name, shares, value });
      }

      return [symbol, summarisePositions(positions)] as const;
    });

    if (dryRun) {
      const wouldWrite = summaries.reduce((n, [, s]) => n + s.top.length, 0);
      log(`Dry run — ${wouldWrite} rows would be written. Nothing was.`);

      // --symbol narrows the report to one company, so a run can be checked
      // against the SEC's own filing viewer rather than eyeballed.
      const focus = summaries.filter(([s]) => !only || s === only);
      for (const [symbol, s] of (only ? focus : summaries).slice(0, 3)) {
        log(`  ${symbol}: ${s.holderCount.toLocaleString()} holders, ` +
          `${s.totalShares.toLocaleString()} shares between them. Largest:`);
        for (const p of s.top.slice(0, 5)) {
          log(`    ${p.name.slice(0, 38).padEnd(40)} ${p.shares.toLocaleString().padStart(15)}`);
        }
      }
      return;
    }

    const db = getDb();
    const universe = await db
      .select({ id: companies.id, symbol: companies.symbol })
      .from(companies);
    const idBySymbol = new Map(universe.map((c) => [c.symbol.toUpperCase(), c.id]));

    const rows = summaries.flatMap(([symbol, { holderCount, totalShares, top }]) => {
      const companyId = idBySymbol.get(symbol);
      // A symbol in the universe but not yet ingested into `companies` has no
      // row to hang holdings off. Skipped rather than invented.
      if (companyId == null) return [];

      return top.map((p) => ({
        companyId,
        quarter,
        managerCik: p.cik,
        managerName: p.name,
        shares: p.shares,
        value: p.value,
        holderCount,
        totalShares,
      }));
    });

    for (let i = 0; i < rows.length; i += BATCH) {
      await db
        .insert(institutionalHoldings)
        .values(rows.slice(i, i + BATCH))
        // Re-running the same quarter refreshes it rather than failing, which
        // matters because a scheduled run may fire before every late filing
        // has landed.
        .onConflictDoUpdate({
          target: [
            institutionalHoldings.companyId,
            institutionalHoldings.quarter,
            institutionalHoldings.managerCik,
          ],
          set: {
            managerName: sql`excluded.manager_name`,
            shares: sql`excluded.shares`,
            value: sql`excluded.value`,
            holderCount: sql`excluded.holder_count`,
            totalShares: sql`excluded.total_shares`,
          },
        });
    }

    // The crosswalk is worth keeping so the read path and any later run can
    // resolve a CUSIP without rebuilding it from scratch.
    const cusipRows = [...cusipToSymbol.entries()].map(([cusip, symbol]) => ({ cusip, symbol }));
    for (let i = 0; i < cusipRows.length; i += BATCH) {
      await db
        .insert(cusipSymbols)
        .values(cusipRows.slice(i, i + BATCH))
        .onConflictDoUpdate({
          target: cusipSymbols.cusip,
          set: { symbol: sql`excluded.symbol`, updatedAt: new Date() },
        });
    }

    log(`Wrote ${rows.length} holdings rows for ${quarter}.`);
    await closeDb();
    process.exit(rows.length === 0 ? 1 : 0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    await closeDb();
    process.exit(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main();
