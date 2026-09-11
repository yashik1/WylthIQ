import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import type { Filing, NewsItem } from "@/lib/providers/types";
import type { StockPageData } from "@/lib/stock-data";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { LocalTime } from "@/components/local-time";
import { classifyFiling } from "@/lib/filings/timeline";

/**
 * A filing in plain English, in the same words the filing timeline uses.
 *
 * This table had its own label map, which called every 8-K a "Major event
 * announcement" while the timeline called the same filing "Earnings" or
 * "Executive change". One classifier now names a filing wherever it appears.
 */
function formLabel(filing: Filing): string | null {
  const label = classifyFiling(filing).label;
  if (label === filing.form) return null;
  return /\/A$/.test(filing.form) ? `${label} (amended)` : label;
}

export function FilingsList({ filings }: { filings: Filing[] }) {
  return (
    <Card>
      <CardHeader
        title="Official filings"
        subtitle="Straight from SEC EDGAR — the original source for every figure above"
      />
      {filings.length === 0 ? (
        <EmptyState
          title="No filings found"
          description="This company has no recent filings indexed on EDGAR."
        />
      ) : (
        /*
          A table, because this is tabular: the same three facts about each of
          a dozen filings. As a list the date lived in the secondary line under
          the title, so "what has been filed lately" meant reading every row;
          in a column it can be scanned straight down.
        */
        <div className="scroll-x">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="eyebrow px-5 py-2 text-left text-[0.6875rem]">
                  Filing
                </th>
                <th scope="col" className="eyebrow px-3 py-2 text-left text-[0.6875rem]">
                  Filed
                </th>
                <th scope="col" className="eyebrow px-5 py-2 text-left text-[0.6875rem]">
                  Covers to
                </th>
              </tr>
            </thead>
            <tbody>
              {filings.map((f, i) => (
                <tr
                  key={`${f.form}-${f.filedAt}-${i}`}
                  className="border-b border-border transition-colors last:border-0 hover:bg-surface-2"
                >
                  <td className="px-5 py-2.5">
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="group inline-flex items-center gap-2"
                    >
                      <FileText aria-hidden className="size-4 shrink-0 text-muted" />
                      <span className="font-medium group-hover:underline">
                        {formLabel(f) ?? f.form}
                      </span>
                      {formLabel(f) && <span className="text-muted">({f.form})</span>}
                      <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted" />
                    </a>
                  </td>
                  <td className="tnum px-3 py-2.5 whitespace-nowrap text-muted">{f.filedAt}</td>
                  <td className="tnum px-5 py-2.5 whitespace-nowrap text-muted">
                    {f.periodOfReport || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function NewsList({
  news,
  symbol,
  status = { state: "ok", message: null },
  source = null,
  filingsShownAbove = false,
}: {
  news: NewsItem[];
  symbol: string;
  status?: StockPageData["newsStatus"];
  source?: string | null;
  /** True when the page already lists the company's filings in its timeline. */
  filingsShownAbove?: boolean;
}) {
  // When the chain falls through to EDGAR these are the company's own filings,
  // not press coverage. Saying so matters: "the company reported a major event"
  // is a legally required announcement, which carries quite different weight
  // from somebody's write-up of it, and a newcomer would not guess that.
  const fromFilings = source === "SEC EDGAR";
  // And when the filing timeline is already on the page, listing those same
  // filings again here as "news" is a duplicate, so the panel says there was
  // no coverage instead.
  const repeatsFilings = fromFilings && filingsShownAbove;
  const items = repeatsFilings ? [] : news;
  const subtitle =
    fromFilings && !repeatsFilings
      ? "Announcements the company filed itself, from the last 30 days"
      : "Coverage from the last 30 days";
  // Telling a reader who has already set a key to go and set a key sends them
  // to fix something that is not broken. Each case gets its own wording, and
  // the quiet one — a company simply not in the news this month — is stated as
  // the unremarkable thing it is rather than dressed up as a setup problem.
  const empty = repeatsFilings
    ? {
        title: "No news coverage in the last 30 days",
        description: `No articles about ${symbol} were found this month. The company's own announcements are in the filing timeline above.`,
      }
    : status.state === "not-configured"
      ? {
          title: "News needs a key",
          description:
            "Headlines come from Finnhub. A free key is an email signup — set FINNHUB_API_KEY to turn this on. Everything else on this page works without one.",
        }
      : status.state === "failed"
        ? {
            title: "News could not be loaded",
            description: `${status.message ?? "The news provider did not respond."} Every other figure on this page comes from SEC EDGAR and is unaffected.`,
          }
        : {
            title: "Nothing in the last 30 days",
            description: `No articles have been published about ${symbol} in the past month. Its filings are listed alongside, and they are the more reliable record anyway.`,
          };

  return (
    <Card>
      <CardHeader title="Recent news" subtitle={subtitle} />
      {items.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((n) => (
            <li key={n.id}>
              <a
                href={n.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <p className="text-sm font-medium leading-snug">{n.headline}</p>
                <p className="mt-1 text-xs text-muted">
                  {n.source} · <LocalTime value={n.publishedAt} mode="relative" />
                </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function PeersList({ peers }: { peers: string[] }) {
  if (peers.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Similar companies" subtitle="Others in the same industry" />
      <div className="flex flex-wrap gap-2 p-5">
        {peers.map((p) => (
          <Link
            key={p}
            href={`/stock/${encodeURIComponent(p)}`}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
          >
            {p}
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** External research destinations, for anyone who wants to go deeper. */
export function ResearchLinks({
  symbol,
  cik,
  website,
}: {
  symbol: string;
  cik: string | null;
  website: string | null;
}) {
  const links = [
    website && { label: "Company website", href: website },
    cik && {
      label: "All EDGAR filings",
      href: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=&dateb=&owner=include&count=40`,
    },
    {
      label: "EDGAR full-text search",
      href: `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(symbol)}%22`,
    },
    { label: "Yahoo Finance", href: `https://finance.yahoo.com/quote/${symbol}` },
    { label: "Google Finance", href: `https://www.google.com/finance/quote/${symbol}:NASDAQ` },
    {
      label: "Earnings call transcripts",
      href: `https://www.google.com/search?q=${encodeURIComponent(`${symbol} earnings call transcript`)}`,
    },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <Card>
      <CardHeader title="Dig deeper" subtitle="Primary sources and further research" />
      <ul className="divide-y divide-border">
        {links.map((l) => (
          <li key={l.label}>
            <a
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-surface-2"
            >
              <span>{l.label}</span>
              <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted" />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
