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
 * Seven steps in the order the research loop runs — understand, check health,
 * see what changed, compare, read the filing, save, write a thesis — each a
 * link to the part of the page that answers it. Saving and a thesis show as
 * done when they are, since those are the two a reader does rather than reads.
 *
 * The newcomer's eight-question checklist is not repeated here. It lives on
 * the Learn page, and a single link points there, rather than a second copy
 * sitting beside the section strip and these steps.
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

  return (
    <nav aria-label="Research steps" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      <ol className="flex list-none flex-wrap items-center gap-x-1 gap-y-1.5">
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
      <Link href="/learn#checklist" className="text-muted underline-offset-2 hover:text-accent hover:underline">
        New to financial analysis?
      </Link>
    </nav>
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
