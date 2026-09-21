import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { FaqSection } from "@/components/faq-section";
import { StructuredData } from "@/components/structured-data";
import { pageLd } from "@/lib/structured-data";
import { listCoveredCompanies } from "@/lib/universe-directory";

export const metadata: Metadata = {
  title: "All companies covered by WylthIQ",
  description:
    "Every US and Canadian company WylthIQ scores, listed alphabetically with a link to " +
    "its filings, financial health and valuation.",
  alternates: { canonical: "/companies" },
};

/*
  A page whose whole job is to link to the others.

  An audit of the live site on 2026-09-21 found company pages with no internal
  links pointing at them at all — reachable only through the sitemap or a
  search box. Crawlers reach pages through links, and a page nothing links to
  accrues no authority however good it is. The screener lists a hundred rows
  at a time and the dashboard six, so most of the universe was unreachable by
  following links.

  Rendered from the ingest universe rather than the database, so it lists the
  same companies whether or not a deployment has run an ingest yet, and never
  turns into an empty page because a query failed.
*/
export const dynamic = "force-static";
export const revalidate = 86_400;

export default function CompaniesPage() {
  const groups = listCoveredCompanies();
  const total = groups.reduce((sum, g) => sum + g.symbols.length, 0);

  return (
    <div>
      <StructuredData
        data={[
          pageLd({
            type: "CollectionPage",
            name: "All companies covered by WylthIQ",
            description:
              `Every one of the ${total} US and Canadian companies WylthIQ scores, ` +
              "listed alphabetically.",
            path: "/companies",
          }),
        ]}
      />

      <PageHeader eyebrow="Directory" title="Every company covered">
        <p>
          All {total} companies scored here, in alphabetical order. Each page reads that
          company&apos;s own filings and answers the five questions that matter, with the
          figure behind every answer.
        </p>
      </PageHeader>

      <div className="mt-6 space-y-5">
        {groups.map((group) => (
          <Card key={group.letter} as="section" className="p-5">
            <h2 className="font-display mb-3 text-lg" id={`letter-${group.letter}`}>
              {group.letter}
            </h2>
            <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-x-4 gap-y-1.5">
              {group.symbols.map((symbol) => (
                <li key={symbol}>
                  <Link
                    href={`/stock/${encodeURIComponent(symbol)}`}
                    className="block truncate py-0.5 text-sm text-muted-strong transition-colors hover:text-accent"
                  >
                    {symbol}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <FaqSection
          id="companies-faq"
          heading="About this list"
          entries={[
            {
              question: "Which companies does WylthIQ cover?",
              answer:
                `The ${total} US and Canadian companies listed above — the S&P 500 and Nasdaq 100 ` +
                "constituents, plus Canadian companies that cross-list in New York and file with " +
                "the SEC. Any other SEC filer can be opened directly at /stock/ and its ticker.",
            },
            {
              question: "Why are some companies missing?",
              answer:
                "Scores are computed from filings held by SEC EDGAR. A company that files only " +
                "with a foreign regulator — a Toronto-only listing, say — has no filings to read, " +
                "so it is left out rather than scored from a worse source.",
            },
          ]}
        />
      </div>
    </div>
  );
}
