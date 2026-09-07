import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { faqLd } from "@/lib/structured-data";
import { StructuredData } from "@/components/structured-data";

export const metadata: Metadata = {
  title: "Learn — what the numbers actually mean",
  description:
    "Plain-English explanations of the financial terms and scores used across WylthIQ.",
  alternates: { canonical: "/learn" },
};

interface Entry {
  term: string;
  short: string;
  detail: string;
  example?: string;
}

const BASICS: Entry[] = [
  {
    term: "Revenue",
    short: "All the money coming in from selling things.",
    detail:
      "Also called sales or turnover. It is the top line — before any costs, wages, or taxes are taken out. A company can have enormous revenue and still lose money.",
    example: "A shop that sells $1M of goods has $1M in revenue, even if the goods cost it $1.2M.",
  },
  {
    term: "Net income (profit)",
    short: "What's left after every cost is paid.",
    detail:
      "The bottom line. Revenue minus all costs, interest and taxes. Negative net income means the company lost money over the period.",
  },
  {
    term: "Assets",
    short: "Everything the company owns.",
    detail:
      "Cash, buildings, equipment, inventory, and money owed to it by customers. Assets are what would be left to sell or collect if it stopped trading.",
  },
  {
    term: "Liabilities",
    short: "Everything the company owes.",
    detail:
      "Loans, unpaid supplier bills, and obligations to deliver things already paid for. Not all liabilities are borrowings — a large chunk is often just ordinary trade credit.",
  },
  {
    term: "Equity",
    short: "What would be left for shareholders.",
    detail:
      "Assets minus liabilities. If the company sold everything and paid off every debt, equity is what owners would share. Negative equity means debts exceed everything owned.",
  },
  {
    term: "Operating cash flow",
    short: "Actual cash the business generated.",
    detail:
      "Profit is an accounting figure and involves judgement calls; cash flow is harder to massage. When profit is healthy but cash flow is not, it is worth asking why.",
  },
];

const RATIOS: Entry[] = [
  {
    term: "P/E ratio (price to earnings)",
    short: "What you pay for each $1 of yearly profit.",
    detail:
      "A P/E of 20 means investors pay $20 for every $1 the company earns per year. Higher usually means the market expects growth. It cannot be calculated for a company that loses money.",
    example: "Two firms both earn $1/share. One trades at $10 (P/E 10), the other at $50 (P/E 50).",
  },
  {
    term: "Net profit margin",
    short: "Cents of profit kept from each dollar of sales.",
    detail:
      "A 25% margin means 25 cents of every sales dollar becomes profit. Supermarkets run on thin margins; software companies often run on very fat ones. Only compare within an industry.",
  },
  {
    term: "Return on assets",
    short: "How hard the company's assets work.",
    detail:
      "Profit divided by everything owned. Banks look low on this measure by nature, because they hold enormous asset bases relative to their earnings.",
  },
  {
    term: "Current ratio",
    short: "Can it pay the bills due this year?",
    detail:
      "Short-term assets divided by short-term bills. Below 1.0 means more due within a year than readily available to pay it — not automatically a problem, but worth understanding.",
  },
  {
    term: "Net debt",
    short: "Borrowings left after spending all its cash.",
    detail:
      "Total borrowings minus cash on hand. A company with more cash than debt has negative net debt, which is a position of strength. This is a better measure of debt burden than total liabilities, which include ordinary supplier bills.",
  },
];

const SCORES: Entry[] = [
  {
    term: "Piotroski F-Score (0–9)",
    short: "Nine checks of whether the finances are improving.",
    detail:
      "Devised by accounting professor Joseph Piotroski in 2000. It tests profitability, debt levels and operating efficiency, awarding one point per test passed. 8–9 indicates strong and improving financials; 0–2 indicates weak and deteriorating ones. When a company cannot report a figure a test needs, that test is skipped and the score is shown out of a smaller total rather than counting as a failure.",
  },
  {
    term: "Altman Z-Score",
    short: "How far the company is from financial distress.",
    detail:
      "Published by Edward Altman in 1968 to predict bankruptcy. Above 2.99 is the safe zone, 1.81–2.99 is grey, below 1.81 signals distress. WylthIQ uses the original five-factor model for manufacturers and the four-factor Z'' variant elsewhere, because the original was fitted on manufacturing companies. It is not shown at all for banks and insurers — see below.",
  },
  {
    term: "Beneish M-Score",
    short: "Screens for signs of manipulated earnings.",
    detail:
      "Built by Messod Beneish in 1999 from eight ratios comparing this year with last. Above −1.78 flags accounting patterns statistically similar to companies that later restated earnings. It is a prompt to read the filings carefully — never evidence of wrongdoing, and plenty of honest companies trip it.",
  },
  {
    term: "Health score (0–10)",
    short: "Our summary of the four health questions.",
    detail:
      "The average of the profitability, growth, debt and accounting ratings, scored 10 for good, 6 for mixed and 2 for weak. Anything that cannot be assessed is left out rather than guessed. Valuation is deliberately excluded: whether a share looks expensive says nothing about whether the business underneath is sound.",
  },
];

export default function LearnPage() {
  return (
    /*
      Held to the same measure as /terms, the app's other long-form page.

      Left at the full content column its paragraphs ran to about 172
      characters a line, against roughly 104 on /terms — past the width where
      the eye reliably finds the start of the next line, on the one page whose
      entire job is being read.
    */
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {/*
        The glossary restated as questions.

        Every entry below is already a term with a plain-English answer, so
        this markup says what the page says — the line between structured
        data and cloaking is that a crawler and a reader get the same thing.
      */}
      <StructuredData
        data={faqLd(
          [...BASICS, ...RATIOS, ...SCORES].map((e) => ({
            question: `What is ${e.term}?`,
            answer: `${e.short} ${e.detail}`,
          })),
        )}
      />

      <PageHeader eyebrow="Reference" title="What the numbers mean">
        <p>
          Every term WylthIQ uses, explained without assuming you have read a
          balance sheet before. Nothing here is advice — it is just vocabulary.
        </p>
      </PageHeader>

      <Section
        title="The basics"
        subtitle="The handful of figures that appear on every company page"
        entries={BASICS}
      />
      <Section
        title="Ratios"
        subtitle="Comparisons that make companies of different sizes comparable"
        entries={RATIOS}
      />
      <Section
        title="The scores"
        subtitle="Published academic models, applied consistently"
        entries={SCORES}
      />

      {/* This section exists because it is the single most common way these
          models are misused. */}
      <Card>
        <CardHeader
          title="Why some scores say “not meaningful for banks”"
          subtitle="A deliberate omission, not missing data"
        />
        <div className="space-y-3 p-5 text-sm leading-relaxed text-muted-strong">
          <p>
            The Altman and Beneish models were built by studying industrial and retail
            companies. Banks and insurers are structurally different in two ways that
            break them.
          </p>
          <p>
            First, a bank&apos;s balance sheet has no split between short-term and
            long-term items, so there is no working capital to measure — several inputs
            simply do not exist. Second, banks are supposed to be highly leveraged:
            taking deposits and lending them out <em>is</em> the business. A model built
            to read heavy borrowing as a danger sign will label every healthy bank as
            distressed.
          </p>
          <p>
            Rather than print a confident number that is meaningless, WylthIQ omits
            those scores for financial companies and says so. The rest of the analysis —
            profitability, growth, accounting quality — still applies.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Where the figures come from" />
        <div className="space-y-3 p-5 text-sm leading-relaxed text-muted-strong">
          <p>
            All financial data is read from{" "}
            <a
              className="text-accent underline"
              href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces"
              target="_blank"
              rel="noreferrer noopener"
            >
              SEC EDGAR
            </a>
            , the US regulator&apos;s official filing system. These are the same documents
            the company&apos;s auditors signed off on. Every stock page links directly to
            the filing each figure was taken from, so you can always check.
          </p>
          <p>
            Canadian companies appear when they cross-list on a US exchange and file a
            40-F, which most large Canadian firms do. They report under IFRS rather than
            US accounting rules, and WylthIQ reads both.
          </p>
          <p>
            Figures come from annual reports, so they update once a year and can be
            several months old. Share prices are separate and much fresher — each page
            labels exactly how fresh.
          </p>
        </div>
      </Card>

      <p className="text-sm text-muted">
        Ready to look something up?{" "}
        <Link href="/screen" className="text-accent underline">
          Open the screener
        </Link>{" "}
        or search for a company above.
      </p>
    </div>
  );
}

function Section({
  title,
  subtitle,
  entries,
}: {
  title: string;
  subtitle: string;
  entries: Entry[];
}) {
  return (
    <Card as="section">
      <CardHeader title={title} subtitle={subtitle} />
      <dl className="divide-y divide-border">
        {entries.map((e) => (
          <div key={e.term} className="px-5 py-4">
            <dt className="text-sm font-semibold">{e.term}</dt>
            <dd className="mt-1 space-y-1.5">
              <p className="text-sm font-medium text-muted-strong">{e.short}</p>
              <p className="text-sm leading-relaxed text-muted">{e.detail}</p>
              {e.example && (
                <p className="text-sm italic leading-relaxed text-muted">
                  Example: {e.example}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
