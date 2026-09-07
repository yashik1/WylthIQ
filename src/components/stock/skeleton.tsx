import { Card } from "@/components/ui";

/**
 * Shown while a stock page fetches its filings.
 *
 * That request takes a couple of seconds against SEC EDGAR, and a blank screen
 * for that long reads as a broken page rather than a loading one. The skeleton
 * mirrors the real layout so nothing jumps when the content lands.
 *
 * Deliberately a component rather than a route-level loading.tsx. A loading
 * file wraps the whole route in a Suspense boundary, which commits the HTTP
 * response before the page runs — so an unknown ticker rendered the correct
 * 404 page under a 200 status. Placing the boundary inside the page keeps the
 * skeleton while leaving the status code correct.
 */
export function StockSkeleton({ label = "Loading company financials…" }: { label?: string } = {}) {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      {/* Read aloud, so it has to be true — Bitcoin has no financials to load. */}
      <span className="sr-only">{label}</span>

      {/*
        Header, sized to the header it stands in for.

        This carried `pt-1` and no rule while the real stock header — and now
        every other page header, through `PageHeader` — carries `pt-10
        pb-[22px]` and a bottom rule. A placeholder that does not reserve the
        space its content will take is worse than none: everything below it
        jumped roughly 40px the moment the real header arrived.
      */}
      <header className="border-b border-border pt-10 pb-[22px]">
        <Shimmer className="h-3 w-full max-w-32" />
        <Shimmer className="mt-2 h-9 w-40 max-w-full" />
        <Shimmer className="mt-2 h-4 w-full max-w-64" />
      </header>

      {/* verdict */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center">
          {/*
            The bars are capped rather than fixed, and the block that holds
            them can shrink.

            At 375px this row is a 96px dial, a 20px gap and a 256px bar
            inside 271px of space — and a flex item defaults to a minimum size
            of its content, so the bar could not give way and pushed 22px past
            the card. The real verdict card never had this because its text
            wraps; a skeleton made of fixed widths cannot. It is the one piece
            of the page a first-time visitor on a phone is guaranteed to see,
            so it has to survive the narrowest screen.
          */}
          <div className="flex items-center gap-5">
            <Shimmer className="size-24 shrink-0 rounded-full sm:size-28" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <Shimmer className="h-2.5 w-28 max-w-full" />
              <Shimmer className="h-6 w-full max-w-64" />
              <Shimmer className="h-3 w-full max-w-48" />
            </div>
          </div>
          <div className="min-w-0 space-y-2 lg:ml-auto">
            <Shimmer className="h-2.5 w-24 max-w-full" />
            <Shimmer className="h-8 w-32 max-w-full" />
          </div>
          {/* Wraps rather than overflowing: three 64px blocks and two 24px
              gaps need 240px, and a 320px phone leaves 216px inside the card. */}
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="min-w-0 space-y-2">
                <Shimmer className="h-2.5 w-16 max-w-full" />
                <Shimmer className="h-5 w-12 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* chart */}
      <Card>
        <div className="border-b border-border px-5 py-3.5">
          <Shimmer className="h-4 w-32" />
        </div>
        <div className="p-5">
          <Shimmer className="h-[420px] w-full rounded-[var(--radius)]" />
        </div>
      </Card>

      {/* questions */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="p-5">
            <div className="flex items-center justify-between gap-3">
              <Shimmer className="h-4 w-40 min-w-0 flex-1" />
              <Shimmer className="h-6 w-16 shrink-0 rounded-full" />
            </div>
            <Shimmer className="mt-3 h-3 w-full" />
            <Shimmer className="mt-2 h-3 w-4/5" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * A placeholder block. Uses a pulse rather than a sweeping highlight — the
 * sweep is heavier to paint and this sits behind a network wait, not a
 * decorative one. Honours reduced motion via the global rule.
 */
function Shimmer({ className }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}
