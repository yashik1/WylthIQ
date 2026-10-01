import type { ChangeReport } from "@/lib/scoring/changes";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

export function SinceLastFiling({ report }: { report: ChangeReport }) {
  const changes = report.changes.slice(0, 4);
  if (changes.length === 0) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Since the last filing</h2>
          <p className="text-xs text-muted">Largest year-over-year changes in FY{report.toYear}</p>
        </div>
        <a href="#what-changed" className="text-xs text-accent hover:underline">View all</a>
      </div>
      <ul className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {changes.map((change) => (
          <li key={change.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{change.label}</p>
              <p className="tnum text-xs text-muted">{change.from} → {change.to}</p>
            </div>
            <span className={cn(
              "tnum text-sm font-semibold",
              change.direction === "better" && "text-good",
              change.direction === "worse" && "text-poor",
              change.direction === "neutral" && "text-muted",
            )}>
              {change.delta}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
