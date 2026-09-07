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

/** The site itself, for the home page. */
export function websiteLd(): JsonLd {
  const base = siteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "WylthIQ",
    url: base,
    description:
      "Understand any company's financial health without reading a balance sheet. " +
      "Plain-English answers, sourced directly from regulatory filings.",
    publisher: {
      "@type": "Organization",
      name: "WylthIQ",
      url: base,
      sameAs: ["https://github.com/yashik1/WylthIQ"],
    },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${base}/stock/{search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}
