import { Badge } from "@/components/ui";
import type { DataCheck } from "@/lib/fundamentals/validate";

/**
 * The automated checks run on this company's figures, collapsed by default.
 *
 * Shown even when nothing was found, because "these figures were checked and
 * add up" is itself worth being able to see. A note is a reason to look at the
 * filing, never a correction: the figures above are the company's own.
 */
export function DataChecks({ checks }: { checks: DataCheck[] }) {
  const warnings = checks.filter((c) => c.severity === "warning").length;

  return (
    <details className="rounded-xl border border-border bg-surface px-5 py-3 text-sm">
      <summary className="cursor-pointer text-muted transition-colors hover:text-foreground">
        {checks.length === 0
          ? "Automated data checks: nothing unusual found in these figures"
          : `Automated data checks: ${checks.length} ${checks.length === 1 ? "item" : "items"} to be aware of${warnings > 0 ? `, ${warnings} worth checking against the filing` : ""}`}
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs leading-relaxed text-muted">
          Every company&apos;s figures are checked for internal consistency: the balance sheet adding
          up, figures sharing one currency, cash flow and share counts within plausible ranges, and
          how recent the latest annual report is. Nothing here changes a figure.
        </p>
        {checks.length > 0 && (
          <ul className="space-y-2">
            {checks.map((check, index) => (
              <li key={`${check.key}-${check.period}-${index}`} className="flex gap-2">
                <span className="shrink-0">
                  <Badge tone={check.severity === "warning" ? "fair" : "neutral"}>
                    {check.severity === "warning" ? "Check" : "Note"}
                  </Badge>
                </span>
                <span className="text-sm leading-relaxed text-muted-strong">{check.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
