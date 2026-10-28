import type { Metadata } from "next";
import Link from "next/link";
import { AllocationChart } from "@/components/portfolio/allocation-chart";
import { BrokerBreakdown } from "@/components/portfolio/broker-breakdown";
import { HoldingForm, RemoveHoldingButton } from "@/components/portfolio/holding-form";
import { HoldingsMap } from "@/components/portfolio/holdings-map";
import { LocalTime } from "@/components/local-time";
import { Badge, Card, CardHeader, EmptyState, MeterBar, PageHeader, RatingBadge } from "@/components/ui";
import { canAccess, getEntitlement } from "@/lib/billing/entitlement";
import { listBrokerHoldings } from "@/lib/brokers/queries";
import { calendarDate, percent, price as fmtPrice } from "@/lib/format";
import { accountTypeLabel } from "@/lib/portfolio/account-types";
import { listHoldings } from "@/lib/portfolio/actions";
import { mapCompanies, type PortfolioChart } from "@/lib/portfolio/charts";
import type { PortfolioIntelligence } from "@/lib/portfolio/intelligence";
import { loadPortfolio } from "@/lib/portfolio/load";
import type { CurrencyTotal, ValuedHolding } from "@/lib/portfolio/math";
import { toPortfolioInputs } from "@/lib/portfolio/sources";
import { healthRating } from "@/lib/scoring/ratings";
import { listTheses } from "@/lib/thesis/actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "What you hold, what it is worth, and what it is exposed to — described from company filings.",
  robots: { index: false, follow: false },
};

function signedAmount(value: number, currency: string): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmtPrice(Math.abs(value), currency)}`;
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
}

export default async function PortfolioPage() {
  const entitlement = await getEntitlement();

  const header = (
    <PageHeader eyebrow="Your holdings" title="Portfolio">
      <p>
        What you hold, what it is worth on the latest available prices, and what it is exposed to —
        described with the same figures the company pages use. Holdings come from what you enter
        here and, if you connect your broker on your{" "}
        <Link href="/account" className="text-accent underline underline-offset-2">
          account page
        </Link>
        , from what it reports — read-only, it can never trade. Nothing here is a recommendation.
      </p>
    </PageHeader>
  );

  if (!entitlement.userId) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="p-5">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-strong">
            Sign in to record what you hold. The portfolio is kept on your account and only you can
            see it.
          </p>
          <Link
            href="/signin?next=/portfolio"
            className="mt-3 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
          >
            Sign in
          </Link>
        </Card>
      </div>
    );
  }

  const [saved, synced, theses] = await Promise.all([
    listHoldings(),
    canAccess(entitlement, "BROKER_SYNC") ? listBrokerHoldings(entitlement.userId) : Promise.resolve([]),
    listTheses(),
  ]);
  const { inputs, overlaps } = toPortfolioInputs(saved, synced);
  const view = await loadPortfolio(
    inputs,
    theses.map((thesis) => ({ symbol: thesis.symbol, status: thesis.status })),
  );

  return (
    <div className="space-y-5">
      {header}

      <Card>
        <CardHeader title="Add or update a holding" subtitle="Kept on your account. Only you can see it." />
        <HoldingForm />
      </Card>

      {view.holdings.length > 0 && view.intelligence && (
        <PortfolioPulse intelligence={view.intelligence} holdings={view.holdings.length} />
      )}

      {view.holdings.length === 0 ? (
        <Card>
          <EmptyState
            title="No holdings yet"
            description="Add a holding above, or connect a broker on your account page (read-only), to see value, gain, allocation and exposure."
            action={
              <Link href="/screen" className="text-sm font-medium text-accent underline underline-offset-2">
                Find companies in the screener
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="p-5">
          <p className="text-sm text-muted">
            You have {view.holdings.length} holdings. Open this page on a deployment with the full
            portfolio table to review them, or remove holdings and re-add if this branch was mid-restore.
          </p>
        </Card>
      )}
    </div>
  );
}

function PortfolioPulse({
  intelligence,
  holdings,
}: {
  intelligence: PortfolioIntelligence;
  holdings: number;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">Portfolio pulse</p>
      <p className="mt-1 text-sm text-muted-strong">
        {holdings} {holdings === 1 ? "holding" : "holdings"}
        {intelligence.averageHealth != null &&
          ` · average health ${intelligence.averageHealth.toFixed(1)}/10`}
      </p>
    </Card>
  );
}
