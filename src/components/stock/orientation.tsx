import { Card } from "@/components/ui";
import type { BusinessSummary } from "@/lib/scoring/business";

/**
 * The business description is deliberately qualitative. Financial scale
 * metrics belong to the Investor Brief or Five Questions, where they have a
 * clear analytical purpose. Repeating sales, profit and margin here made the
 * top of the stock page say the same thing multiple times.
 */
export function WhatItDoes({ summary }: { summary: BusinessSummary }) {
  return (
    <Card className="p-6">
      <p className="eyebrow mb-2">What this company does</p>
      <p className="font-display text-xl leading-snug sm:text-2xl">
        {summary.sentence}
      </p>
    </Card>
  );
}

/**
 * Compatibility export for older callers. The stock page now gets its
 * authoritative strengths and risks from the Investor Brief and Five
 * Questions, so rendering another copy here only duplicates data.
 */
export function StrengthsAndRisks() {
  return null;
}
