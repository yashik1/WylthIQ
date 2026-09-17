import { convertFundamentals } from "./fundamentals/convert";
import { fieldValue } from "./fundamentals/normalize";
import type { NormalizedFundamentals } from "./fundamentals/types";
import { currencyForExchange } from "./exchange-currency";
import { getRate, restate } from "./fx";
import { reportedIn } from "./providers";
import type { CompanyProfile, Quote } from "./providers/types";

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
export interface RestatedCompany {
  /** The filings, restated when that was possible and needed. */
  fundamentals: NormalizedFundamentals | null;
  /** The currency every figure here is in. */
  displayCurrency: string;
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

  let fundamentals = input.fundamentals;
  let converted: { from: string; rate: number } | null = null;

  if (
    fundamentals &&
    reportingCurrency &&
    reportingCurrency.toUpperCase() !== listingCurrency.toUpperCase()
  ) {
    const rate = await getRate(reportingCurrency, listingCurrency).catch(() => null);
    // No rate means the figures stay as filed. A converted number at an
    // invented rate would be worse than an honest one in an unfamiliar
    // currency.
    if (rate) {
      fundamentals = convertFundamentals(fundamentals, rate, listingCurrency);
      converted = { from: reportingCurrency, rate };
    }
  }

  const displayCurrency = converted ? listingCurrency : (reportingCurrency ?? listingCurrency);

  /*
    Prefer the provider's market value, restated into the currency shown.

    It prices the whole company, which a share price cannot always do: SK hynix
    trades in Seoul at ₩1.76M and on Nasdaq at $175 because a depositary share
    is a fraction of an ordinary one, so multiplying the Nasdaq price by the
    share count in the filing understates it sevenfold. Seoul's own ₩1,234T,
    converted, is right.

    The price fallback stands in only when the quote's currency is the one
    being displayed — otherwise it reintroduces the same mixture one layer
    down.
  */
  let marketCap: number | null = null;
  let quoted = false;
  if (profile?.marketCap != null) {
    quoted = true;
    const capCurrency = profile.marketCapCurrency;
    const rate =
      capCurrency && capCurrency.toUpperCase() !== displayCurrency.toUpperCase()
        ? await getRate(capCurrency, displayCurrency).catch(() => null)
        : 1;
    marketCap = restate(profile.marketCap, capCurrency, displayCurrency, rate);
  }

  /*
    A valuation that could not be restated leaves no valuation at all.

    Falling through to the price here would substitute an estimate precisely
    where it is least trustworthy: a company whose valuation is quoted in
    another currency is a foreign issuer, and a foreign issuer's US ticker is
    usually a depositary share worth a fraction of the shares in its filing.
    A missing market value is visibly missing; a sevenfold understatement is
    not.
  */
  if (
    marketCap == null &&
    !quoted &&
    quote?.price &&
    listingCurrency.toUpperCase() === displayCurrency.toUpperCase()
  ) {
    const shares =
      (fundamentals ? fieldValue(fundamentals.annual[0], "sharesOutstanding") : null) ??
      profile?.sharesOutstanding ??
      null;
    if (shares) marketCap = quote.price * shares;
  }

  return { fundamentals, displayCurrency, converted, marketCap };
}
