import { Badge, Card, CardHeader } from "@/components/ui";
import { calendarDate } from "@/lib/format";
import type { MovementContext } from "@/lib/movement-context";
import { cn } from "@/lib/utils";

/**
 * Today's move beside its sector and the market, and what was published
 * around it — never why it happened.
 */
export function MovementContextCard({
  context,
  freshness,
}: {
  context: MovementContext;
  /** "delayed ~15 min", "at close" — how old the stock's own quote is. */
  freshness: string | null;
}) {
  return (
    <Card>
      <CardHeader
        title="Today's move in context"
        subtitle={`How the latest move compares${freshness ? ` (quote ${freshness})` : ""}, and what was published around it`}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 p-5 md:grid-cols-[16rem_minmax(0,1fr)] md:items-start">
        <dl className="space-y-2.5 text-sm">
          <Row label={context.stock.label} value={context.stock.change} />
          {context.sector && (
            <Row
              label={`${context.sector.label} average`}
              detail={`${context.sector.companies} companies, from stored quotes`}
              value={context.sector.change}
            />
          )}
          {context.market && <Row label={context.market.label} value={context.market.change} />}
        </dl>
        <p className="text-sm leading-relaxed text-muted-strong">{context.comparison}</p>
      </div>

      <section aria-labelledby="move-evidence-heading" className="border-t border-border px-5 py-4">
        <h3 id="move-evidence-heading" className="text-sm font-semibold">
          Published in the last {context.days} days
        </h3>
        {context.evidence.length === 0 ? (
          <p className="mt-1 text-sm text-muted">{context.quietNote}</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-border">
            {context.evidence.map((item, index) => (
              <li key={`${item.url}-${index}`} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 py-2">
                <time dateTime={item.date} className="tnum w-24 shrink-0 text-xs text-muted">
                  {calendarDate(item.date) ?? item.date}
                </time>
                <Badge tone={item.kind === "earnings" ? "accent" : "neutral"}>{item.label}</Badge>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 text-sm transition-colors hover:text-accent hover:underline"
                >
                  {item.title}
                </a>
                <span className="text-xs text-faint">{item.source}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        These coincide with the move in time. None is presented as its cause: a price can move on
        news that names no company, on the wider market, or on trading that no document records.
      </p>
    </Card>
  );
}

function Row({ label, detail, value }: { label: string; detail?: string; value: number }) {
  const up = value > 0;
  const down = value < 0;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0">
        <span className="font-medium">{label}</span>
        {detail && <span className="block text-xs text-faint">{detail}</span>}
      </dt>
      <dd className={cn("tnum shrink-0 font-semibold", up && "text-up", down && "text-down")}>
        <span aria-hidden>{up ? "▲ " : down ? "▼ " : ""}</span>
        {up ? "+" : down ? "−" : ""}
        {Math.abs(value * 100).toFixed(2)}%
      </dd>
    </div>
  );
}
