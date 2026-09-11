import type {
  AsReportedSnapshot,
  CanonicalField,
  Fact,
  FinancialPeriod,
  NormalizedFundamentals,
} from "./types";

/**
 * Reading as-reported snapshots back as ordinary periods.
 *
 * A snapshot stores numbers only, to keep the fundamentals cache small; the
 * scoring functions expect facts. This rebuilds the minimum a fact needs,
 * and marks every one with the snapshot's own date, so nothing downstream can
 * mistake a reconstruction for the live figures.
 */

const COUNT_FIELDS: ReadonlySet<CanonicalField> = new Set(["sharesOutstanding"]);

/** A snapshot's years as periods, newest first. */
export function snapshotPeriods(snapshot: AsReportedSnapshot): FinancialPeriod[] {
  return snapshot.periods.map((period) => {
    const facts: Partial<Record<CanonicalField, Fact>> = {};

    for (const [field, value] of Object.entries(period.values) as [
      CanonicalField,
      number | undefined,
    ][]) {
      if (value == null || !Number.isFinite(value)) continue;
      facts[field] = {
        value,
        unit: COUNT_FIELDS.has(field) ? "shares" : period.currency,
        end: period.end,
        fiscalYear: period.fiscalYear,
        fiscalPeriod: "FY",
        form: snapshot.form,
        sourceConcept: "as-reported",
        sourceFilingUrl: null,
        filed: snapshot.asOf,
      };
    }

    return {
      fiscalYear: period.fiscalYear,
      fiscalPeriod: "FY",
      end: period.end,
      form: snapshot.form,
      facts,
      filedAt: snapshot.asOf,
    };
  });
}

/** A snapshot as fundamentals a scoring function can read. */
export function snapshotFundamentals(
  snapshot: AsReportedSnapshot,
  identity: Pick<NormalizedFundamentals, "cik" | "entityName" | "taxonomy">,
): NormalizedFundamentals {
  return {
    cik: identity.cik,
    entityName: identity.entityName,
    taxonomy: identity.taxonomy,
    annual: snapshotPeriods(snapshot),
    missingFields: [],
  };
}

/** The most recent snapshot that was already public on an ISO date, or null. */
export function snapshotAsOf(
  fundamentals: NormalizedFundamentals,
  isoDate: string,
): AsReportedSnapshot | null {
  return (
    [...(fundamentals.asReported ?? [])]
      .sort((a, b) => b.asOf.localeCompare(a.asOf))
      .find((snapshot) => snapshot.asOf <= isoDate) ?? null
  );
}
