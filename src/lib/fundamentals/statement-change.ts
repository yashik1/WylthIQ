/**
 * The change column of the statement explorer.
 *
 * Kept apart from the builder so the client component that renders the
 * tables imports these few lines rather than the normaliser.
 */

export type StatementRowKind = "money" | "percent" | "multiple" | "perShare" | "shares";

/**
 * The move from one figure to another, or null when either is missing.
 *
 * Ratios move in points or turns, never in per cent of themselves. An amount
 * that changes sign, or starts from zero, has no meaningful percentage and
 * says so rather than printing one.
 */
export function describeChange(
  latest: number | null,
  base: number | null,
  kind: StatementRowKind,
): string | null {
  if (latest == null || base == null || !Number.isFinite(latest) || !Number.isFinite(base)) {
    return null;
  }

  const diff = latest - base;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";

  if (kind === "percent") return `${sign}${Math.abs(diff * 100).toFixed(1)} pts`;
  if (kind === "multiple") return `${sign}${Math.abs(diff).toFixed(2)}x`;

  if (base === 0 || (latest !== 0 && Math.sign(latest) !== Math.sign(base))) return "n/m";
  return `${sign}${Math.abs((diff / Math.abs(base)) * 100).toFixed(1)}%`;
}
