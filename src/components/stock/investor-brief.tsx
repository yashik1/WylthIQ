import { Card } from "@/components/ui";
import { calendarDate } from "@/lib/format";
import { SEVERITY_LABEL } from "@/lib/scoring/change-thresholds";
import type { BriefMove, InvestorBrief } from "@/lib/scoring/investor-brief";
import { cn } from "@/lib/utils";

/**
 * The first thing on a company page: what the filings say, in one compact
 * conclusion card.
 *
 * This card is deliberately conclusion-only. Numeric health, valuation and
 * operating metrics have authoritative homes lower on the page (Financial
 * Health, Five Questions and Standard Figures). Repeating those numbers here
 * made the same evidence appear in several different cards.
 */
export function InvestorBriefCard({
  brief,
  companyName,
}: {
  brief: InvestorBrief;
  companyName: string;
}) {
  const { source, health } = brief;
  const filed = calendarDate(source.filedAt);
  const filing = `${companyName}'s FY${source.fiscalYear} ${source.form}${filed ? `, filed ${filed}` : ""}`;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3.5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Investor brief</h2>
        <p className="text-xs text-muted">
          From {filing}
          {source.url && (
            <>
              {" · "}
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                read the filing
              </a>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
        <div className="space-y-5 p-5">
          {brief.business && (
            <Block title="Business">
              <p className="text-[0.9375rem] leading-relaxed">{brief.business}</p>
            </Block>
          )}

          <Block title="Financial health">
            <p className="text-sm font-medium text-muted-strong">{health.headline}</p>
            <p className="mt-2 text-sm leading-relaxed">
              {health.summary}{" "}
              <a href="#health" className="text-accent hover:underline">
                See the health breakdown
              </a>
            </p>
          </Block>

          <Block title="Bottom line">
            <p className="text-[0.9375rem] leading-relaxed">{brief.bottomLine}</p>
          </Block>
        </div>

        <div className="space-y-5 p-5">
          <Block title="What's improving">
            <Moves
              moves={brief.improving}
              direction="better"
              empty={
                brief.compared
                  ? "No measure improved by a notable amount."
                  : "There is no earlier filing to compare against."
              }
            />
          </Block>

          <Block title="What's deteriorating">
            <Moves
              moves={brief.deteriorating}
              direction="worse"
              empty={
                brief.compared
                  ? "No measure deteriorated by a notable amount."
                  : "There is no earlier filing to compare against."
              }
            />
          </Block>

          <Block title="Biggest thing to watch">
            {brief.watch ? (
              <>
                <p className="text-sm leading-relaxed">{brief.watch.text}</p>
                <p className="tnum mt-1 text-xs text-faint">
                  {brief.watch.evidence}
                  {brief.watch.url && (
                    <>
                      {" · "}
                      {brief.watch.url.startsWith("#") ? (
                        <a href={brief.watch.url} className="text-accent hover:underline">
                          see the warning signs
                        </a>
                      ) : (
                        <a
                          href={brief.watch.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-accent hover:underline"
                        >
                          read the filing
                        </a>
                      )}
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Nothing in the filings stands out as a concern.</p>
            )}
          </Block>
        </div>
      </div>

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
        A summary of what the filings show, not a recommendation. The detailed
        evidence appears in the sections below.
      </p>
    </Card>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow text-[0.625rem]">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Moves({
  moves,
  direction,
  empty,
}: {
  moves: BriefMove[];
  direction: "better" | "worse";
  empty: string;
}) {
  if (moves.length === 0) return <p className="text-sm text-muted">{empty}</p>;

  return (
    <ul className="space-y-2.5">
      {moves.map((move) => (
        <li key={`${move.period}-${move.key}`} className="text-sm">
          <span className="font-medium">{move.label}</span>{" "}
          <span className={cn("tnum font-semibold", direction === "better" ? "text-good" : "text-poor")}>
            <span className="sr-only">{direction === "better" ? "improved" : "deteriorated"}: </span>
            {move.delta}
          </span>
          <span className="tnum mt-0.5 block text-xs text-muted">
            {move.from} → {move.to} · {move.period} · {SEVERITY_LABEL[move.severity]}
          </span>
        </li>
      ))}
    </ul>
  );
}
