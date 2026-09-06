import type { ReactNode } from "react";
import { SectionHeading } from "@/components/ui";
import { ImpliedGrowth } from "./expectations";
import { ShortInterestPanel } from "./short-interest";
import { InstitutionalOwners } from "./institutional";
import { AnalystRatings } from "./analysts";
import type { ImpliedExpectations } from "@/lib/scoring/expectations";
import type { ShortInterest } from "@/lib/signals/short-interest";
import type { InstitutionalOwnership } from "@/lib/signals/institutional";
import type { AnalystView } from "@/lib/signals/analysts";

/**
 * The one place on the page that is not derived from a filing.
 *
 * Everything above this section reports what a company told a regulator.
 * Everything inside it reports what somebody expects — the growth the price is
 * paying for, and, as they are added, what analysts have published, what short
 * sellers have bet and what large funds held at the last count.
 *
 * They are gathered into a single labelled section rather than sprinkled among
 * the filing-derived panels, and that is the whole design. A reader who has
 * been told, correctly, that every figure on this page traces to a document
 * would otherwise have no way to tell the two kinds apart — and an expectation
 * sitting in the same visual register as a reported number reads as a reported
 * number. One heading and one framing line draw the boundary once, in a place
 * it cannot be scrolled past, instead of repeating a caveat on each panel.
 *
 * Placed after the price chart and before the five questions: this is material
 * about the price, so it belongs with the price, and the questions stay a run
 * of purely filing-derived answers.
 *
 * Renders nothing at all when none of its children has anything to say, which
 * for a small or recently listed company is the ordinary case.
 */
/**
 * Whether the section will render anything at all.
 *
 * Exported because the page needs the same answer before the component runs —
 * to decide whether to offer a jump link to a section that may not exist. The
 * alternative is the page restating this condition, which is how two copies of
 * one rule drift apart.
 */
export function hasMarketExpectations(input: {
  expectations: ImpliedExpectations | null;
  analysts: AnalystView | null;
  shortInterest: ShortInterest | null;
  ownership: InstitutionalOwnership | null;
}): boolean {
  return Boolean(
    input.expectations ||
      input.analysts ||
      input.shortInterest ||
      (input.ownership && input.ownership.holders.length > 0),
  );
}

export function MarketExpects({
  expectations,
  analysts,
  shortInterest,
  ownership,
  currentPrice,
  currency,
}: {
  expectations: ImpliedExpectations | null;
  analysts: AnalystView | null;
  shortInterest: ShortInterest | null;
  ownership: InstitutionalOwnership | null;
  currentPrice: number | null;
  currency: string;
}) {
  const panels: ReactNode[] = [];

  if (expectations) {
    panels.push(
      <ImpliedGrowth key="implied-growth" expectations={expectations} currency={currency} />,
    );
  }

  if (analysts) {
    panels.push(
      <AnalystRatings
        key="analysts"
        view={analysts}
        currentPrice={currentPrice}
        currency={currency}
      />,
    );
  }

  if (shortInterest) {
    panels.push(<ShortInterestPanel key="short-interest" shortInterest={shortInterest} />);
  }

  // Last in the section, because it is the oldest thing in it — a quarterly
  // position disclosed up to 45 days late, where everything above is current.
  if (ownership && ownership.holders.length > 0) {
    panels.push(<InstitutionalOwners key="ownership" ownership={ownership} />);
  }

  if (panels.length === 0) return null;

  return (
    <section aria-labelledby="expectations-heading">
      <SectionHeading
        eyebrow="Expectations"
        title="What the market expects"
        description="Not from the filings — what other people are betting on, and what the price already assumes."
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {panels}

        {/*
          The register the whole section depends on, stated once. This is the
          block a reader is most likely to mistake for a recommendation, which
          is the same reasoning that puts a closing line under the warning-signs
          panel.
        */}
        <p className="text-xs leading-relaxed text-faint">
          Nothing in this section is a figure this company reported about itself. These are
          expectations and positions — what the price implies, what analysts have
          published, what short sellers are betting, and what large funds held at the last count. WylthIQ reports them; it does not endorse
          them, does not forecast prices, and takes no view on whether any of them will turn out
          to be right.
        </p>
      </div>
    </section>
  );
}
