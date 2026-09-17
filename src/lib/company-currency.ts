/**
 * One company, with every figure in one currency.
 *
 * A filer's statements, the market's valuation of it and the price on its
 * ticker are three numbers from three places, and they are not always in the
 * same money. Royal Bank files in Canadian dollars and trades in New York in
 * US ones. SK hynix files in won, is valued in Seoul in won, and trades on
 * Nasdaq in dollars — where one depositary share is a fraction of an ordinary
 * one, so even the share price cannot be multiplied out.
 *
 * Mixing them does not fail loudly; it publishes a plausible wrong number. The
 * compare page put Royal Bank on 19 times earnings while the company page said
 * 27, and SK hynix's page reported a P/E of 39,478 and a market value of
 * "$1236.88T". Both pages now ask this one function instead of each doing its
 * own arithmetic.
 */

import { convertFundamentals } from "./fundamentals/convert";
import { fieldValue } from "./fundamentals/normalize";
import type { NormalizedFundamentals } from "./fundamentals/types";
import { currencyForExchange } from "./exchange-currency";
import { getRate, restate } from "./fx";
import { supportedCurrency } from "./currency-choice";
import { reportedIn } from "./providers";
import type { CompanyProfile, Quote } from "./providers/types";

/**
 * How far two valuations may disagree before the share count is the suspect.
 *
 * A price times a share count and a data vendor's market capitalisation should
 * describe the same company. When they are within a rounding of each other,
 * the arithmetic one wins: it uses the price actually being shown, and a
 * vendor's figure can be stale — Cameco's was 28% low against its own price on
 * 2026-09-16, while price times share count gave the right $39.6bn.
 *
 * A gap several times over means the share count is not counting the thing
 * being priced, and no price can repair that:
 *   - SK hynix, 7.3x, because Nasdaq prices a depositary share worth a
 *     fraction of the ordinary shares in the filing;
 *   - Booking, 22.9x, because the filing predates a share split while the
 *     price does not;
 *   - Brookfield Renewable, 68.8x, because only some of its units are tagged.
 * All three read as a company worth a fraction of its real size — Booking at
 * 1.04 times earnings — so there the vendor's figure is the honest one.
 */
const SHARE_COUNT_DISAGREEMENT = 3;

export function chooseMarketCap(
  derived: number | null,
  quoted: number | null,
): number | null {
  if (derived == null || derived <= 0) return quoted;
  if (quoted == null || quoted <= 0) return derived;

  const ratio = Math.max(derived, quoted) / Math.min(derived, quoted);
  return ratio > SHARE_COUNT_DISAGREEMENT ? quoted : derived;
}

export interface RestatedCompany {
  /** The filings, restated when that was possible and needed. */
  fundamentals: NormalizedFundamentals | null;
  /** The currency every figure here is in. */
  displayCurrency: string;
  /**
   * The currency the shares actually change hands in. A price is a thing
   * somebody transacts at, so it is never restated into a reader's chosen
   * currency the way the filings are — it is labelled with this instead.
   */
  listingCurrency: string;
  /** Set when the filings were restated, for the note a page shows about it. */
  converted: { from: string; rate: number } | null;
  /** In `displayCurrency`, so it can be divided by the figures above. */
  marketCap: number | null;
}

export async function restateCompany(input: {
  fundamentals: NormalizedFundamentals | null;
  quote: Quote | null;
  profile: CompanyProfile | null;
  /** The filing currency, when the caller already knows it. */
  reportingCurrency?: string | null;
  /**
   * A currency the reader asked for, which overrides the listing's own. Only
   * a code from CURRENCY_CHOICES reaches here; see currency-choice.ts.
   */
  target?: string | null;
}): Promise<RestatedCompany> {
  const { quote, profile } = input;
  const reportingCurrency =
    input.reportingCurrency ?? (input.fundamentals ? reportedIn(input.fundamentals) : null);

  /*
    Figures are shown in the currency the shares trade in.

    Reporting ₩42.92T is faithful to the filing and close to useless to
    somebody deciding whether to buy in dollars. One rate, today's, is used for
    every year — an accountant would use each year's own, but that mixes
    business performance with currency movement, and the comparison a reader is
    making is between the years.
  */
  const listingCurrency = quote?.currency ?? currencyForExchange(profile?.exchange) ?? "USD";

  // What the reader asked for, if anything, otherwise where it trades.
  const wanted = supportedCurrency(input.target) ?? listingCurrency;

  let fundamentals = input.fundamentals;
  let converted: { from: string; rate: number } | null = null;

  if (
    fundamentals &&
    reportingCurrency &&
    reportingCurrency.toUpperCase() !== wanted.toUpperCase()
  ) {
    const rate = await getRate(reportingCurrency, wanted).catch(() => null);
    // No rate means the figures stay as filed. A converted number at an
    // invented rate would be worse than an honest one in an unfamiliar
    // currency.
    if (rate) {
      fundamentals = convertFundamentals(fundamentals, rate, wanted);
      converted = { from: reportingCurrency, rate };
    }
  }

  /*
    What the figures are actually in now.

    Not simply what was asked for: a filer already reporting in the chosen
    currency needs no conversion, and one whose rate could not be had keeps its
    own. Everything below — and every label on the page — reads this rather
    than the request.
  */
  const displayCurrency = converted
    ? wanted
    : reportingCurrency && reportingCurrency.toUpperCase() === wanted.toUpperCase()
      ? wanted
      : (reportingCurrency ?? listingCurrency);

  /*
    The provider's market value, restated into the currency shown.

    One of two candidates; chooseMarketCap above decides between them and says
    why. This one prices the whole company, including share classes a filing
    may tag loosely and splits it predates, but it is a vendor's snapshot and
    can lag the price by a quarter.
  */
  let quoted: number | null = null;
  if (profile?.marketCap != null) {
    const capCurrency = profile.marketCapCurrency;
    const rate =
      capCurrency && capCurrency.toUpperCase() !== displayCurrency.toUpperCase()
        ? await getRate(capCurrency, displayCurrency).catch(() => null)
        : 1;
    quoted = restate(profile.marketCap, capCurrency, displayCurrency, rate);
  }

  /*
    The price on this page, times the shares behind it.

    Restated into the displayed currency like everything else, since the price
    is money too. The filing's share count is preferred over the provider's for
    the reason everything else here is: a reader can go and check it.
  */
  let derived: number | null = null;
  const shares =
    (fundamentals ? fieldValue(fundamentals.annual[0], "sharesOutstanding") : null) ??
    profile?.sharesOutstanding ??
    null;
  if (quote?.price && shares) {
    const priced = quote.price * shares;
    const rate =
      listingCurrency.toUpperCase() !== displayCurrency.toUpperCase()
        ? await getRate(listingCurrency, displayCurrency).catch(() => null)
        : 1;
    derived = restate(priced, listingCurrency, displayCurrency, rate);
  }

  return {
    fundamentals,
    displayCurrency,
    listingCurrency,
    converted,
    marketCap: chooseMarketCap(derived, quoted),
  };
}
