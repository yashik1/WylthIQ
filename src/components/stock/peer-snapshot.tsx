import Link from "next/link";
import { Card, CardHeader, RatingBadge } from "@/components/ui";
import { multiple, percent } from "@/lib/format";
import { describeAgainstPeers, median, type PeerFigures } from "@/lib/peer-context";
import type { PeerRow } from "@/lib/peers";
import { healthRating } from "@/lib/scoring/ratings";
import { cn } from "@/lib/utils";

/**
 * This company beside similar ones.
 *
 * Its own row comes from the filing on this page; the peers' rows come from
 * the nightly scores of their latest filings. A median row and a few plain
 * sentences say where this company sits, without ranking anybody.
 *
 * Falls back to a list of links when no peer has stored scores yet, which is
 * the ordinary state on a deployment with no database.
 */
export function PeerSnapshot({
  symbol,
  name,
  subject,
  subjectFScore,
  peers,
  peerSymbols,
}: {
  symbol: string;
  name: string;
  subject: PeerFigures | null;
  subjectFScore: { score: number; max: number } | null;
  peers: PeerRow[];
  peerSymbols: string[];
}) {
  const compareSymbols = [symbol, ...peerSymbols.filter((p) => p !== symbol)].slice(0, 4);
  const compareHref = `/compare?symbols=${encodeURIComponent(compareSymbols.join(","))}`;
  const action = (
    <Link href={compareHref} className="text-xs text-accent underline underline-offset-2">
      Compare side by side
    </Link>
  );

  const others = peers.filter((peer) => peer.symbol !== symbol);

  if (!subject || others.length === 0) {
    return (
      <Card>
        <CardHeader title="Similar companies" subtitle="Others in the same industry" action={action} />
        <div className="flex flex-wrap gap-2 p-5">
          {peerSymbols.map((peer) => (
            <Link
              key={peer}
              href={`/stock/${encodeURIComponent(peer)}`}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
            >
              {peer}
            </Link>
          ))}
        </div>
      </Card>
    );
  }

  const sentences = describeAgainstPeers(subject, others);
  const rows = [
    { ...subject, name, fScore: subjectFScore?.score ?? null, fScoreMax: subjectFScore?.max ?? null, isSubject: true },
    ...others.map((peer) => ({ ...peer, isSubject: false })),
  ];
  const peerMedian = (pick: (row: PeerFigures) => number | null) => median(others.map(pick));
  const medianHealth = peerMedian((row) => row.healthScore);

  return (
    <Card>
      <CardHeader
        title="Against similar companies"
        subtitle="This company's latest filing beside its peers' stored scores"
        action={action}
      />
      {sentences.length > 0 && (
        <ul className="space-y-1 border-b border-border px-5 py-3">
          {sentences.map((sentence) => (
            <li key={sentence} className="text-sm leading-relaxed text-muted-strong">
              {sentence}
            </li>
          ))}
        </ul>
      )}
      <div className="scroll-x">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">{name} compared with similar companies</caption>
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
              <th scope="col" className="px-5 py-2.5 font-medium">Company</th>
              <th scope="col" className="px-3 py-2 font-medium">Health</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">F-Score</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Revenue growth</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Profit margin</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">P/E</th>
              <th scope="col" className="px-5 py-2 text-right font-medium">Debt to equity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.symbol} className={cn(row.isSubject && "bg-accent-soft/50")}>
                <th scope="row" className="px-5 py-2.5 text-left font-normal">
                  {row.isSubject ? (
                    <span className="font-bold tracking-tight">{row.symbol}</span>
                  ) : (
                    <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="font-bold tracking-tight hover:text-accent">
                      {row.symbol}
                    </Link>
                  )}
                  <span className="block max-w-[14rem] truncate text-xs text-muted">
                    {row.isSubject ? `${row.name} · this page` : row.name}
                  </span>
                </th>
                <td className="px-3 py-2.5">
                  <RatingBadge
                    rating={healthRating(row.healthScore)}
                    label={row.healthScore != null ? `${row.healthScore.toFixed(1)}/10` : "no data"}
                  />
                </td>
                <td className="tnum px-3 py-2.5 text-right">
                  {row.fScore != null ? `${row.fScore}/${row.fScoreMax ?? 9}` : "—"}
                </td>
                <td className="tnum px-3 py-2.5 text-right">{percent(row.revenueGrowth)}</td>
                <td className="tnum px-3 py-2.5 text-right">{percent(row.netMargin)}</td>
                <td className="tnum px-3 py-2.5 text-right">{multiple(row.peRatio)}</td>
                <td className="tnum px-5 py-2.5 text-right">{multiple(row.debtToEquity)}</td>
              </tr>
            ))}
            <tr className="bg-surface-2/50 text-muted-strong">
              <th scope="row" className="px-5 py-2.5 text-left text-xs font-medium">
                Median of peers
              </th>
              <td className="tnum px-3 py-2.5 text-xs">{medianHealth != null ? `${medianHealth.toFixed(1)}/10` : "—"}</td>
              <td className="px-3 py-2.5 text-right text-xs">—</td>
              <td className="tnum px-3 py-2.5 text-right">{percent(peerMedian((r) => r.revenueGrowth))}</td>
              <td className="tnum px-3 py-2.5 text-right">{percent(peerMedian((r) => r.netMargin))}</td>
              <td className="tnum px-3 py-2.5 text-right">{multiple(peerMedian((r) => r.peRatio))}</td>
              <td className="tnum px-5 py-2.5 text-right">{multiple(peerMedian((r) => r.debtToEquity))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        Peers come from the company&apos;s industry classification. A difference describes the
        companies; it does not rank them.
      </p>
    </Card>
  );
}
