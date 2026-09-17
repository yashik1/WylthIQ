/**
 * Audits the fields the stock/ETF pages actually depend on.
 *
 * Usage:
 *   npm run audit:data
 *   DATA_AUDIT_SYMBOLS="SPY,QQQ,XEQT.TO" npm run audit:data
 *
 * The report is written to data-audit.json (ignored by git). It distinguishes
 * missing data from metrics that are genuinely not meaningful.
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { getUniverse } from "../src/lib/universe";
import { getCompanyProfile, getEtfProfile, getFundamentalsWithSource, getProvider } from "../src/lib/providers";
import { buildValuationMetrics, type MetricStatus } from "../src/lib/scoring/valuation";
import { fieldValue } from "../src/lib/fundamentals/normalize";
import { sectorFromSic } from "../src/lib/scoring/applicability";

interface MetricAudit {
  status: MetricStatus;
  value: number | null;
  basis: string;
}

interface Row {
  symbol: string;
  kind: "stock" | "etf" | "unknown";
  source: string;
  priceAvailable: boolean;
  marketCapAvailable: boolean;
  latestAnnual: string | null;
  missingFinancialFields: string[];
  valuation: Record<string, MetricAudit> | null;
  etf: {
    expenseRatio: number | null;
    holdingCount: number | null;
    netAssets: number | null;
    inceptionDate: string | null;
    source: string | null;
  } | null;
  errors: string[];
}

const requested = (process.env.DATA_AUDIT_SYMBOLS ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

const symbols = [...new Set([...getUniverse(), ...requested])];
const provider = getProvider();
const concurrency = 5;

async function audit(symbol: string): Promise<Row> {
  const errors: string[] = [];
  const [data, profile, quote] = await Promise.all([
    getFundamentalsWithSource(symbol).catch((err) => {
      errors.push(`fundamentals: ${err instanceof Error ? err.message : String(err)}`);
      return { fundamentals: null, currency: null, source: "none" };
    }),
    getCompanyProfile(symbol).catch((err) => {
      errors.push(`profile: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }),
    provider.getQuote(symbol).catch((err) => {
      errors.push(`quote: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }),
  ]);

  if (data.fundamentals?.annual.length) {
    const latest = data.fundamentals.annual[0];
    const shares = fieldValue(latest, "sharesOutstanding");
    const derivedMarketCap = quote?.price != null && shares != null ? quote.price * shares : null;
    const marketCap = profile?.marketCap ?? derivedMarketCap;
    const valuation = buildValuationMetrics(
      data.fundamentals,
      marketCap,
      sectorFromSic(profile?.sicCode),
    );

    return {
      symbol,
      kind: "stock",
      source: data.source,
      priceAvailable: quote?.price != null,
      marketCapAvailable: marketCap != null,
      latestAnnual: latest.end,
      missingFinancialFields: data.fundamentals.missingFields,
      valuation: Object.fromEntries(
        Object.entries(valuation).map(([key, item]) => [key, {
          status: item.status,
          value: item.value,
          basis: item.basis,
        }]),
      ),
      etf: null,
      errors,
    };
  }

  const etf = await getEtfProfile(symbol).catch((err) => {
    errors.push(`etf profile: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  });

  return {
    symbol,
    kind: etf ? "etf" : "unknown",
    source: data.source,
    priceAvailable: quote?.price != null,
    marketCapAvailable: profile?.marketCap != null,
    latestAnnual: null,
    missingFinancialFields: [],
    valuation: null,
    etf: etf
      ? {
          expenseRatio: etf.expenseRatio ?? null,
          holdingCount: etf.holdingCount ?? null,
          netAssets: etf.netAssets ?? null,
          inceptionDate: etf.inceptionDate ?? null,
          source: etf.source?.name ?? null,
        }
      : null,
    errors,
  };
}

async function main() {
  const rows: Row[] = [];
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    rows.push(...(await Promise.all(batch.map(audit))));
    console.log(`Audited ${Math.min(i + concurrency, symbols.length)}/${symbols.length}`);
  }

  const stockRows = rows.filter((r) => r.kind === "stock");
  const etfRows = rows.filter((r) => r.kind === "etf");
  const unknownRows = rows.filter((r) => r.kind === "unknown");

  const countStatus = (status: MetricStatus) =>
    stockRows.reduce(
      (n, row) => n + Object.values(row.valuation ?? {}).filter((m) => m.status === status).length,
      0,
    );

  const report = {
    generatedAt: new Date().toISOString(),
    provider: provider.name,
    symbolsRequested: symbols.length,
    summary: {
      stocks: stockRows.length,
      etfs: etfRows.length,
      unknown: unknownRows.length,
      valuation: {
        calculated: countStatus("calculated"),
        stale: countStatus("stale"),
        unavailable: countStatus("unavailable"),
        notMeaningful: countStatus("not_meaningful"),
      },
      stocksMissingPrice: stockRows.filter((r) => !r.priceAvailable).length,
      stocksMissingMarketCap: stockRows.filter((r) => !r.marketCapAvailable).length,
      etfsMissingExpenseRatio: etfRows.filter((r) => r.etf?.expenseRatio == null).length,
    },
    rows: rows.sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };

  await writeFile("data-audit.json", JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(JSON.stringify(report.summary, null, 2));
  console.log("\nWrote data-audit.json");

  const failures = rows.filter(
    (r) =>
      (r.kind === "stock" && (!r.priceAvailable || !r.marketCapAvailable)) ||
      (r.kind === "unknown" && requested.includes(r.symbol)),
  );

  if (failures.length > 0) {
    console.error(`\nData audit found ${failures.length} core coverage issue(s).`);
    for (const row of failures.slice(0, 30)) {
      console.error(
        ` - ${row.symbol}: price=${row.priceAvailable}, marketCap=${row.marketCapAvailable}, kind=${row.kind}`,
      );
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Data audit failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
