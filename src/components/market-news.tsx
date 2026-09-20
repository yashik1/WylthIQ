import Link from "next/link";
import { Card, EmptyState, SectionHeading } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import type { DashboardNews } from "@/lib/market-news";

/**
 * What is being written about the companies on this page.
 *
 * The dashboard is otherwise entirely figures — movers, sectors, health
 * scores — and a figure rarely says why. A 9% fall and the story behind it
 * belong on the same screen, which is what this column is for.
 *
 * Every headline names its company and links out to the publisher rather than
 * reproducing the article: this site summarises filings, not journalism. The
 * ticker beside it opens the company's own page, because the reason somebody
 * clicks a headline here is usually to go and look at the company.
 */
export function MarketNews({ news }: { news: DashboardNews }) {
  // Nothing to ask about at all — a signed-out reader on a deployment with no
  // companies loaded. The dashboard already explains that above; a second
  // empty panel underneath it would only repeat the point.
  if (news.state === "no-symbols") return null;

  return (
    <section aria-labelledby="news-heading">
      <SectionHeading
        eyebrow="In the news"
        title="What is being written"
        description={describe(news)}
      />

      {news.items.length === 0 ? (
        <Card>
          <EmptyState
            title={
              news.state === "unavailable"
                ? "No headlines available"
                : "Nothing in the last 30 days"
            }
            description={
              news.state === "unavailable"
                ? "Headlines come from Finnhub, whose free key is an email signup — set FINNHUB_API_KEY to turn this on. Every figure on this page comes from the filings and is unaffected."
                : `Nothing has been published about ${news.symbols.slice(0, 3).join(", ")} in the past 30 days. Quiet is the ordinary state for most companies most weeks.`
            }
          />
        </Card>
      ) : (
        <Card>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
            {news.items.map((item) => (
              <li key={item.id} className="border-b border-border last:border-b-0">
                <div className="px-5 py-3">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block text-sm font-medium leading-snug transition-colors hover:text-accent"
                  >
                    {item.headline}
                  </a>
                  <p className="mt-1 text-xs text-muted">
                    <Link
                      href={`/stock/${encodeURIComponent(item.symbol)}`}
                      className="font-semibold tracking-[0.04em] hover:text-accent"
                    >
                      {item.symbol}
                    </Link>{" "}
                    · {item.source} ·{" "}
                    {/* Formatted in the browser: this renders on a server whose
                        clock is UTC, and "3 hours ago" is wrong elsewhere. */}
                    <LocalTime value={item.publishedAt} mode="relative" />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

/**
 * Where these headlines came from, said plainly.
 *
 * Which companies were asked about is the part a reader cannot guess, and it
 * changes what the column means: headlines about a watchlist are a
 * personalised feed, headlines about the movers are an explanation of the
 * numbers above.
 */
function describe(news: DashboardNews): string {
  const companies = news.symbols.slice(0, 5).join(", ");
  const from = news.source ? ` From ${news.source}.` : "";
  return `Coverage of ${companies} in the last 30 days.${from}`;
}
