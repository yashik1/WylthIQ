import Link from "next/link";
import { MeterBar } from "@/components/ui";
import { percent } from "@/lib/format";

/** One position, from whichever source described the fund. */
export interface HoldingRow {
  name: string;
  /** This site's symbol for it, when it has a page here. */
  symbol: string | null;
  /** The second column: a country for a filed portfolio, a sector for a manager's file. */
  where: string | null;
  /** A fraction of the fund: 0.07 is 7%. Null where the source gave none. */
  weight: number | null;
  /** A bond's coupon and maturity, or nothing. */
  detail: string | null;
  isShort: boolean;
}

/**
 * Fixed widths, shared by the visible rows and the folded ones, so the two
 * tables line up as one.
 */
function Columns() {
  return (
    <colgroup>
      <col />
      <col className="w-36" />
      <col className="w-24" />
      <col className="w-[24%]" />
    </colgroup>
  );
}

/** Rows shown before the rest fold away behind "Show all". */
export const ROWS_SHOWN = 25;

/**
 * A fund's positions, largest first: the same table whether they came from an
 * N-PORT filing or the manager's own holdings file.
 *
 * The first rows are what a reader asks about — what is this fund mostly — so
 * they show; the rest fold into a disclosure, there for anyone checking
 * whether a particular company is in it. A holding this site has a page for
 * links to it, so a fund of funds leads to each underlying fund's own list.
 */
export function HoldingsTable({ rows, whereLabel }: { rows: HoldingRow[]; whereLabel: string }) {
  if (rows.length === 0) return null;

  // Bars are scaled to the largest position rather than to 100%, or every row
  // in a five-hundred-stock index fund renders as an empty track.
  const largest = Math.max(...rows.map((r) => Math.abs(r.weight ?? 0)), 0.000001);
  const shown = rows.slice(0, ROWS_SHOWN);
  const rest = rows.slice(ROWS_SHOWN);

  return (
    <div className="scroll-x">
      <table className="w-full min-w-[34rem] table-fixed text-sm">
        <Columns />
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
            <th scope="col" className="px-5 py-2.5 font-medium">
              Holding
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              {whereLabel}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Weight
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Relative size</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shown.map((row, i) => (
            <Row key={`${row.symbol ?? row.name}-${i}`} row={row} largest={largest} />
          ))}
        </tbody>
      </table>
      {rest.length > 0 && (
        <details className="group border-t border-border">
          <summary className="cursor-pointer list-none px-5 py-2.5 text-xs font-medium text-accent hover:underline">
            <span className="group-open:hidden">Show all {rows.length} largest</span>
            <span className="hidden group-open:inline">Show the {ROWS_SHOWN} largest only</span>
          </summary>
          <table className="w-full min-w-[34rem] table-fixed text-sm">
            <Columns />
            <tbody className="divide-y divide-border border-t border-border">
              {rest.map((row, i) => (
                <Row key={`${row.symbol ?? row.name}-rest-${i}`} row={row} largest={largest} />
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Row({ row, largest }: { row: HoldingRow; largest: number }) {
  const weight = row.weight == null ? null : percent(row.weight, 2);
  return (
    <tr className="hover:bg-surface-2">
      <td className="px-5 py-2.5 break-words">
        {row.symbol ? (
          <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="font-medium hover:text-accent">
            {row.name}
          </Link>
        ) : (
          <span className="font-medium">{row.name}</span>
        )}
        {/* A short is the opposite bet at the same weight, so it cannot be
            left to a minus sign three columns away. */}
        {row.isShort && <span className="ml-2 text-xs font-medium text-down">short</span>}
        {/* Without this a bond fund renders twenty rows all reading "United
            States Treasury Note/Bond" — accurate, and indistinguishable. */}
        {row.detail && <span className="tnum block text-xs text-faint">{row.detail}</span>}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted">{row.where ?? "—"}</td>
      <td className="tnum px-3 py-2.5 text-right font-medium">{weight ?? "—"}</td>
      <td className="px-3 py-2.5">
        <MeterBar
          value={Math.abs(row.weight ?? 0)}
          max={largest}
          rating={row.isShort ? "poor" : "good"}
          label={`${row.name}, ${weight ?? "an unreported share"} of the fund`}
        />
      </td>
    </tr>
  );
}
