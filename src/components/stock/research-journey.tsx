import Link from "next/link";
import { cn } from "@/lib/utils";

interface Step {
  label: string;
  href: string;
  external?: boolean;
  done?: boolean;
}

/**
 * A quiet guide through a company page.
 *
 * Seven steps in the order the roadmap's research loop runs — understand,
 * check health, see what changed, compare, read the filing, save, write a
 * thesis — each a link to the part of the page that answers it. Saving and a
 * thesis show as done when they are, since those are the two a reader does
 * rather than reads.
 *
 * Beneath it, collapsed, the eight questions a newcomer can work through, each
 * pointing at the section that answers it and at the guide that explains how.
 */
export function ResearchJourney({
  symbol,
  hasOverview,
  hasChanges,
  hasPeers,
  latestFiling,
  saved,
  hasThesis,
}: {
  symbol: string;
  hasOverview: boolean;
  hasChanges: boolean;
  hasPeers: boolean;
  latestFiling: { form: string; url: string } | null;
  saved: boolean;
  hasThesis: boolean;
}) {
  const steps: Step[] = [
    { label: "Understand the business", href: hasOverview ? "#overview" : "#what-it-does" },
    { label: "Review financial health", href: "#health" },
    ...(hasChanges ? [{ label: "See what changed", href: "#what-changed" }] : []),
    { label: "Compare peers", href: hasPeers ? "#peers" : `/compare?symbols=${encodeURIComponent(symbol)}` },
    ...(latestFiling
      ? [{ label: `Read the latest ${latestFiling.form}`, href: latestFiling.url, external: true }]
      : []),
    { label: saved ? "Saved to your watchlist" : "Save to your watchlist", href: "#company-header", done: saved },
    { label: hasThesis ? "Review your thesis" : "Build a thesis", href: "#thesis", done: hasThesis },
  ];

  const questions: { question: string; section: string; guide: { label: string; href: string } }[] = [
    { question: "What does the company do?", section: hasOverview ? "#overview" : "#what-it-does", guide: { label: "How to analyze a company", href: "/how-to-analyze-a-company" } },
    { question: "Is it profitable?", section: "#questions", guide: { label: "Reading an income statement", href: "/how-to-read-an-income-statement" } },
    { question: "Is it growing?", section: hasChanges ? "#what-changed" : "#questions", guide: { label: "Revenue", href: "/learn#revenue" } },
    { question: "Does it generate cash?", section: "#statements", guide: { label: "What is free cash flow?", href: "/what-is-free-cash-flow" } },
    { question: "How much debt does it have?", section: "#questions", guide: { label: "Reading a balance sheet", href: "/how-to-read-a-balance-sheet" } },
    { question: "How is it valued?", section: "#key-figures", guide: { label: "What is the P/E ratio?", href: "/what-is-price-to-earnings" } },
    { question: "What changed?", section: hasChanges ? "#what-changed" : "#timeline", guide: { label: "Financial health score", href: "/learn#health-score" } },
    { question: "What risks should I investigate?", section: "#warning-signs", guide: { label: "What is the Beneish M-Score?", href: "/what-is-beneish-m-score" } },
  ];

  return (
    <div className="space-y-2">
      <nav aria-label="Research steps">
        <ol className="flex list-none flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-center gap-1">
              {index > 0 && (
                <span aria-hidden className="px-0.5 text-faint">
                  ›
                </span>
              )}
              <StepLink step={step} number={index + 1} />
            </li>
          ))}
        </ol>
      </nav>

      <details className="group text-xs">
        <summary className="cursor-pointer text-muted transition-colors hover:text-foreground">
          New to financial analysis? Eight questions to work through
        </summary>
        <ol className="mt-2 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-x-6 gap-y-1.5">
          {questions.map((item, index) => (
            <li key={item.question} className="flex gap-2">
              <span className="tnum w-4 shrink-0 text-faint">{index + 1}.</span>
              <span className="min-w-0">
                <a href={item.section} className="font-medium text-foreground hover:text-accent hover:underline">
                  {item.question}
                </a>{" "}
                <Link href={item.guide.href} className="text-muted underline-offset-2 hover:text-accent hover:underline">
                  {item.guide.label}
                </Link>
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function StepLink({ step, number }: { step: Step; number: number }) {
  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "tnum inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold",
          step.done ? "bg-good-soft text-good-fg" : "bg-surface-2 text-muted",
        )}
      >
        {step.done ? "✓" : number}
      </span>
      <span>{step.label}</span>
      {step.done && <span className="sr-only"> (done)</span>}
    </>
  );

  const className =
    "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground";

  if (step.external) {
    return (
      <a href={step.href} target="_blank" rel="noreferrer noopener" className={className}>
        {content}
      </a>
    );
  }
  return step.href.startsWith("#") ? (
    <a href={step.href} className={className}>
      {content}
    </a>
  ) : (
    <Link href={step.href} className={className}>
      {content}
    </Link>
  );
}
