import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { faqLd } from "@/lib/structured-data";
import { StructuredData } from "@/components/structured-data";
import { METRIC_GUIDES } from "@/lib/learn/metric-guide";
import { GUIDES } from "@/lib/guides/content";

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

/**
 * The terms the metric guide below does not cover.
 *
 * Revenue, the ratios and the scores were once defined here as well as in the
 * metric guide, in different words, so the same page explained ten terms
 * twice. Each is now defined once, in the guide, which is also what every
 * company page links to.
 */
const BASICS: Entry[] = [
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

/**
 * The newcomer's checklist: eight questions, each with where a company page
 * answers it and the guide that explains how to read the answer.
 */
const CHECKLIST: {
  question: string;
  answer: string;
  example: string;
  guide: { label: string; href: string };
}[] = [
  {
    question: "What does the company do?",
    answer: "Every figure means something different depending on the business. Start with what it sells, to whom, and whether sales recur.",
    example: "/stock/AAPL#overview",
    guide: { label: "How to analyze a company", href: "/how-to-analyze-a-company" },
  },
  {
    question: "Is it profitable?",
    answer: "Look at operating and net margins across several years rather than one.",
    example: "/stock/AAPL#questions",
    guide: { label: "How to read an income statement", href: "/how-to-read-an-income-statement" },
  },
  {
    question: "Is it growing?",
    answer: "Compare revenue with a year and three years earlier, and check whether acquisitions supplied the growth.",
    example: "/stock/AAPL#what-changed",
    guide: { label: "Revenue, explained", href: "/learn#revenue" },
  },
  {
    question: "Does it generate cash?",
    answer: "Operating cash flow should broadly keep pace with profit. Free cash flow is what remains after investment.",
    example: "/stock/AAPL#statements",
    guide: { label: "What is free cash flow?", href: "/what-is-free-cash-flow" },
  },
  {
    question: "How much debt does it have?",
    answer: "Net debt and interest cover say more than total liabilities, which include ordinary bills.",
    example: "/stock/AAPL#questions",
    guide: { label: "How to read a balance sheet", href: "/how-to-read-a-balance-sheet" },
  },
  {
    question: "How is it valued?",
    answer: "A multiple needs a comparison: the company's own history, or similar companies.",
    example: "/stock/AAPL#key-figures",
    guide: { label: "What is the P/E ratio?", href: "/what-is-price-to-earnings" },
  },
  {
    question: "What changed?",
    answer: "Set the latest year and quarter beside the ones before, then read the company's own explanation in its filing.",
    example: "/stock/AAPL#what-changed",
    guide: { label: "How to analyze a company", href: "/how-to-analyze-a-company" },
  },
  {
    question: "What risks should I investigate?",
    answer: "Warning signs, the accounting and distress models, and the filing's own risk factors all say where to look harder.",
    example: "/stock/AAPL#health",
    guide: { label: "What is the Beneish M-Score?", href: "/what-is-beneish-m-score" },
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
        The glossary and the metric guide restated as questions, each term
        once.

        Every entry below is already a term with a plain-English answer, so
        this markup says what the page says — the line between structured
        data and cloaking is that a crawler and a reader get the same thing.
      */}
      <StructuredData
        data={faqLd([
          ...BASICS.map((e) => ({
            question: `What is ${e.term}?`,
            answer: `${e.short} ${e.detail}`,
          })),
          ...METRIC_GUIDES.map((guide) => ({
            question: `What is ${guide.name}?`,
            answer: `${guide.what} ${guide.how}`,
          })),
        ])}
      />

      <PageHeader eyebrow="Reference" title="What the numbers mean">
        <p>
          Every term WylthIQ uses, explained without assuming you have read a
          balance sheet before. Nothing here is advice — it is just vocabulary.
        </p>
      </PageHeader>

      <Card as="section">
        <CardHeader
          title="Guides"
          subtitle="Longer walkthroughs, each with a worked example and links to real companies"
        />
        <ul className="divide-y divide-border">
          {GUIDES.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/${guide.slug}`}
                className="block px-5 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="text-sm font-semibold text-accent">{guide.title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted">
                  {guide.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {/* Company pages link here rather than carrying their own copy. */}
      <div id="checklist" className="scroll-mt-24">
      <Card as="section">
        <CardHeader
          title="New to financial analysis?"
          subtitle="Eight questions to work through on any company page, with where each one is answered"
        />
        <ol className="list-none divide-y divide-border">
          {CHECKLIST.map((item, index) => (
            <li key={item.question} className="flex gap-3 px-5 py-3">
              <span className="tnum w-5 shrink-0 text-sm text-faint">{index + 1}.</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{item.question}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{item.answer}</p>
                <p className="mt-1 text-xs">
                  <Link href={item.example} className="text-accent underline underline-offset-2">
                    See it on Apple&apos;s page
                  </Link>
                  <span className="text-faint"> · </span>
                  <Link href={item.guide.href} className="text-accent underline underline-offset-2">
                    {item.guide.label}
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      </div>

      <Section
        title="The basics"
        subtitle="The statement lines every other figure is built from"
        entries={BASICS}
      />

      {/*
        The guide every explanation on a company page links to.

        Each entry has its own anchor, so the "Learn" link under any figure
        lands on exactly that figure — and each carries the same five parts
        the explanation on the company page does, so nothing reads
        differently here from there.
      */}
      <Card as="section">
        <CardHeader
          title="Metric guide"
          subtitle="What each figure is, how it is worked out, why it matters, where it misleads, and where it comes from"
        />
        <dl className="divide-y divide-border">
          {METRIC_GUIDES.map((guide) => (
            <div key={guide.id} id={guide.id} className="scroll-mt-24 px-5 py-4">
              <dt className="text-sm font-semibold">{guide.name}</dt>
              <dd className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-muted">
                <p className="font-medium text-muted-strong">{guide.what}</p>
                <p>
                  <span className="font-medium text-muted-strong">How it is calculated. </span>
                  {guide.how}
                </p>
                <p>
                  <span className="font-medium text-muted-strong">Why it matters. </span>
                  {guide.why}
                </p>
                <p>
                  <span className="font-medium text-muted-strong">Limitations. </span>
                  {guide.limits}
                </p>
                <p>
                  <span className="font-medium text-muted-strong">Where it comes from. </span>
                  {guide.source}
                </p>
              </dd>
            </div>
          ))}
        </dl>
        {/* Learn, then apply: every figure above is on a real company page. */}
        <p className="border-t border-border px-5 py-3 text-sm leading-relaxed text-muted">
          See these figures on a real company —{" "}
          <Link href="/stock/AAPL" className="text-accent underline">
            Apple
          </Link>{" "}
          or{" "}
          <Link href="/stock/RY" className="text-accent underline">
            Royal Bank of Canada
          </Link>{" "}
          —{" "}
          <Link href="/compare" className="text-accent underline">
            compare two side by side
          </Link>
          , or{" "}
          <Link href="/screen" className="text-accent underline">
            screen for companies
          </Link>{" "}
          that pass them.
        </p>
      </Card>

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
            Figures come from annual reports, and from quarterly reports for companies
            that file them in the US, so they can be several months old. Share prices
            are separate and much fresher — each page labels exactly how fresh.
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
