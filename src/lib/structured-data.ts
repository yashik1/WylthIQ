import { siteUrl } from "./site-url";

/**
 * JSON-LD for search engines.
 *
 * The app had none, which meant a crawler reading a company page saw a wall
 * of prose and had to infer that it was about a corporation with a ticker.
 * Structured data states it, and is what lets a result carry more than a blue
 * link.
 *
 * Everything emitted here is either a fact from a public filing or a
 * description of this site. Nothing asserts a rating, a review or a price:
 * marking a health score up as an `AggregateRating` would be both a schema
 * abuse and a claim this app is careful never to make.
 */

export type JsonLd = Record<string, unknown>;

/** The company itself, as schema.org understands one. */
export function corporationLd(input: {
  symbol: string;
  name: string;
  exchange?: string | null;
  website?: string | null;
  cik?: string | null;
  industry?: string | null;
}): JsonLd {
  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Corporation",
    name: input.name,
    tickerSymbol: input.symbol,
    url: `${siteUrl()}/stock/${encodeURIComponent(input.symbol)}`,
  };

  if (input.website) ld.sameAs = [input.website];

  if (input.cik) {
    ld.identifier = {
      "@type": "PropertyValue",
      propertyID: "SEC Central Index Key",
      value: input.cik,
    };
  }

  /*
    The exchange and the industry go into `description` rather than into
    properties of their own.

    Schema.org has no property for either on an Organization. An earlier
    version reached for `subjectOf: ExchangeRateSpecification`, which is the
    type for currency conversion rates and says nothing about a listing venue,
    and for a bare `industry`, which is not a defined property at all. Both
    would have been exactly the abuse this module's own header warns against —
    invented markup is worse than absent markup, because a crawler cannot tell
    that it is wrong.
  */
  const facts = [
    input.exchange ? `listed on ${input.exchange}` : null,
    input.industry ? `in ${input.industry}` : null,
  ].filter(Boolean);

  if (facts.length > 0) {
    ld.description = `${input.name} (${input.symbol}), ${facts.join(", ")}.`;
  }

  return ld;
}

/**
 * A fund, which is not a company.
 *
 * The fund pages emitted `Corporation` because they share a route with the
 * company pages, and it is wrong in the way this module's header warns about:
 * confident, machine-readable and false. A fund runs no business, employs
 * nobody and has no revenue — a crawler told it is a corporation has been
 * given a worse answer than one told nothing, because it cannot tell that it
 * is wrong.
 *
 * `InvestmentFund` is schema.org's own type for this, under FinancialProduct.
 * Deliberately fewer properties than the corporation above: `tickerSymbol` is
 * defined on Organization and not on this type, so the ticker goes in the
 * name where it is true rather than into a property that does not exist here.
 *
 * `feesAndCommissionsSpecification` is the one place the expense ratio has a
 * defined home, and it is only emitted when the figure is actually known.
 */
export function investmentFundLd(input: {
  symbol: string;
  name: string;
  /** Net expense ratio as a fraction, when known. */
  expenseRatio?: number | null;
  holdingCount?: number | null;
}): JsonLd {
  const ld: JsonLd = {
    "@context": "https://schema.org",
    "@type": "InvestmentFund",
    name: `${input.name} (${input.symbol})`,
    url: `${siteUrl()}/stock/${encodeURIComponent(input.symbol)}`,
  };

  if (typeof input.expenseRatio === "number" && Number.isFinite(input.expenseRatio)) {
    // Written as a percentage because that is how a fee is quoted everywhere
    // a reader will have seen one.
    ld.feesAndCommissionsSpecification = `Net expense ratio ${(input.expenseRatio * 100).toFixed(2)}% a year`;
  }

  if (typeof input.holdingCount === "number" && input.holdingCount > 0) {
    ld.description =
      `${input.name} (${input.symbol}) is an exchange-traded fund holding ` +
      `${input.holdingCount.toLocaleString("en-US")} positions, listed here from its own ` +
      `Form N-PORT filing with the SEC.`;
  }

  return ld;
}

/** Where this page sits, so a result can show a path rather than a bare URL. */
export function breadcrumbLd(trail: { name: string; path: string }[]): JsonLd {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: `${base}${step.path}`,
    })),
  };
}

/**
 * The glossary as a set of questions.
 *
 * /learn is already a list of terms with plain-English answers — exactly the
 * shape FAQPage describes — so this is a restatement of what the page says
 * rather than markup written for a crawler's benefit, which is the line
 * between structured data and cloaking.
 */
export function faqLd(entries: { question: string; answer: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entries.map((e) => ({
      "@type": "Question",
      name: e.question,
      acceptedAnswer: { "@type": "Answer", text: e.answer },
    })),
  };
}

/**
 * A page, as one identifiable, dated, attributable thing.
 *
 * An audit of the live site on 2026-09-21 found twelve pages carrying no
 * structured data at all, no author or organisation signal, and no date an
 * engine could confirm. A crawler reading them had prose and nothing else:
 * nothing saying what the page is, who publishes it, or whether it is
 * current. Answer engines weight sources they can identify and date, so the
 * absence costs citations rather than rankings.
 *
 * `isPartOf` and `publisher` point at the `@id`s minted by `websiteLd` and
 * `organisationLd` rather than repeating their fields, which is what makes
 * every page part of one site published by one organisation instead of
 * twenty unrelated documents.
 *
 * Dates are real or absent. `dateModified` defaults to the deploy's own build
 * time, which is the last moment the page's wording could have changed; a
 * page whose figures refresh on their own passes its own date instead. An
 * invented date is the kind of claim a crawler checks.
 */
export function pageLd(input: {
  /** "WebPage" unless the page is principally a list of other pages. */
  type?: "WebPage" | "CollectionPage" | "AboutPage" | "ContactPage";
  name: string;
  description: string;
  /** Rooted path, e.g. "/screen". */
  path: string;
  datePublished?: string;
  dateModified?: string;
}): JsonLd {
  const base = siteUrl();
  const url = `${base}${input.path}`;

  return {
    "@context": "https://schema.org",
    "@type": input.type ?? "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: input.name,
    description: input.description,
    isPartOf: { "@id": `${base}/#website` },
    publisher: { "@id": `${base}/#organisation` },
    inLanguage: "en",
    datePublished: input.datePublished ?? SITE_PUBLISHED,
    dateModified: input.dateModified ?? BUILD_DATE,
  };
}

/**
 * When this site first published anything, and when it last changed.
 *
 * The build date is read from an environment variable Railway sets on every
 * deployment, falling back to today — so a page's `dateModified` moves when
 * the deployment does, which is the honest claim: the wording on these pages
 * changes when the app is deployed and at no other time.
 */
const SITE_PUBLISHED = "2026-06-01";
const BUILD_DATE = (
  process.env.RAILWAY_DEPLOYMENT_CREATED_AT ??
  process.env.BUILD_DATE ??
  new Date().toISOString()
).slice(0, 10);

/**
 * The publisher, as one identified thing.
 *
 * This is what a search for the product's own name resolves against. Without
 * it a crawler reading the home page knows there is a website called WylthIQ
 * but has nothing to attach the name, the mark and the description to, so the
 * brand has no entity to rank — which is why a query for the app itself could
 * return a company page from inside it, or nothing at all.
 *
 * `@id` is the load-bearing part rather than decoration: it gives the
 * organisation a stable identifier that `websiteLd` and every future type can
 * point at, so the two blocks describe one publisher instead of two unrelated
 * things that happen to share a name.
 *
 * `sameAs` is deliberately absent until there are profiles to name. It exists
 * to corroborate an entity against places that already know it, and inventing
 * a link to an account that does not exist is worse than omitting the
 * property — it is a claim a crawler will check.
 */
export function organisationLd(): JsonLd {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${base}/#organisation`,
    name: "WylthIQ",
    // The spellings a reader actually types. A brand written as one word gets
    // searched as two, and a query that never matches the name matches nothing.
    alternateName: ["Wylth IQ", "Wylth"],
    url: base,
    logo: `${base}/icon.svg`,
    description:
      "WylthIQ reads company financial filings and explains them in plain English — " +
      "profitability, growth, debt and valuation, with every figure traced to its source.",
    slogan: "Understand before you invest.",
  };
}

/** The site itself, for the home page. */
export function websiteLd(): JsonLd {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${base}/#website`,
    name: "WylthIQ",
    alternateName: ["Wylth IQ", "Wylth"],
    url: base,
    // Points at the organisation above rather than repeating its fields, which
    // is what makes the two blocks one entity to a crawler.
    publisher: { "@id": `${base}/#organisation` },
    description:
      "Understand any company's financial health without reading a balance sheet. " +
      "Plain-English answers, sourced directly from regulatory filings.",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${base}/stock/{search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}
