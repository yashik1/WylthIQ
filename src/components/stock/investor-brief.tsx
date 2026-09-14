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

  const rated = health.areas.filter((area) => area.rating !== "unknown");
  const good = rated.filter((area) => area.rating === "good").map((area) => area.label.toLowerCase());
  const fair = rated.filter((area) => area.rating === "fair").map((area) => area.label.toLowerCase());
  const poor = rated.filter((area) => area.rating === "poor").map((area) => area.label.toLowerCase());

  const conclusion =
    good.length > 0
      ? `The financial picture is led by ${list(good)}${fair.length ? `, with ${list(fair)} worth watching` : ""}${poor.length ? `, while ${list(poor)} remain weak` : ""}.`
      : fair.length > 0
        ? `The financial picture is mixed, with ${list(fair)} needing attention${poor.length ? ` and ${list(poor)} weaker` : ""}.`
        : "The filing does not provide enough evidence for a clear financial conclusion.";

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

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2">
        <div className="space-y-5 p-5">
          {brief.business && (
            <Block title="Business">
              <p className="text-[0.9375rem] leading-relaxed">{brief.business}</p>
            </Block>
          )}

          <Block title="Conclusion">
            <p className="text-[0.9375rem] leading-relaxed">{conclusion}</p>
          </Block>
        </div>

        <div className="border-t border-border p-5 lg:border-l lg:border-t-0">
          <Block title="Research path">
            <p className="text-sm leading-relaxed text-muted-strong">
              Use the sections below for the evidence: risks, health scoring, what changed,
              price and expectations, five questions, key figures and financial statements.
            </p>
          </Block>
        </div>
      </div>

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
        A conclusion from the filings, not a recommendation. Detailed figures and supporting
        evidence appear in their dedicated sections below.
      </p>
    </Card>
  );
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow text-[0.625rem]">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  );
}
