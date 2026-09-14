import { Card } from "@/components/ui";
import { calendarDate } from "@/lib/format";
import type { InvestorBrief } from "@/lib/scoring/investor-brief";

/**
 * The first thing on a company page: a compact conclusion card.
 *
 * Numeric health, valuation, operating metrics, year-over-year changes and
 * warning details each have an authoritative section below. The brief should
 * orient the reader, not print those same data points a second time.
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

        <div className="p-5">
          <Block title="Research path">
            <p className="text-sm leading-relaxed text-muted-strong">
              The detailed evidence is below: warnings, health, year-over-year
              changes, the five questions, valuation and financial statements.
            </p>
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
