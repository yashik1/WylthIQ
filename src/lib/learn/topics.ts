import { GUIDES } from "../guides/content";
import { METRIC_GUIDES, learnHref, type MetricGuideId } from "./metric-guide";

/**
 * Educational topics, findable from the same search box as companies.
 *
 * A reader who types "free cash flow" or "f-score" wants the explanation, and
 * until now the search box could only offer a company whose name happened to
 * contain the words. Guides lead metric explanations at equal strength of
 * match, because a guide covers the idea and an explanation covers one figure.
 */

export interface LearnTopic {
  title: string;
  kind: "Guide" | "Learn";
  href: string;
  aliases: readonly string[];
}

const ALIASES: Partial<Record<MetricGuideId, string[]>> = {
  revenue: ["sales", "turnover", "top line"],
  "gross-margin": ["gross profit"],
  "operating-margin": ["operating income", "ebit margin"],
  "net-margin": ["profit margin", "net income"],
  "free-cash-flow": ["fcf", "free cash flow", "cash flow"],
  "fcf-margin": ["fcf margin", "free cash flow margin"],
  eps: ["earnings per share"],
  "net-debt": ["debt", "net debt"],
  "debt-to-equity": ["d/e", "leverage", "debt to equity"],
  "current-ratio": ["liquidity", "current ratio"],
  "interest-cover": ["interest coverage", "times interest earned"],
  pe: ["pe", "p/e", "pe ratio", "price to earnings"],
  ps: ["ps", "p/s", "price to sales"],
  pb: ["pb", "p/b", "price to book", "book value"],
  "price-to-fcf": ["p/fcf", "price to free cash flow"],
  roe: ["roe", "return on equity"],
  roa: ["roa", "return on assets"],
  "share-count": ["shares outstanding", "dilution", "share repurchases"],
  piotroski: ["f-score", "fscore", "f score"],
  altman: ["z-score", "zscore", "z score", "bankruptcy risk"],
  beneish: ["m-score", "mscore", "m score", "earnings manipulation"],
  "dividend-yield": ["dividend", "yield"],
  "health-score": ["financial health", "health score"],
};

export const LEARN_TOPICS: readonly LearnTopic[] = [
  ...GUIDES.map((guide) => ({
    title: guide.title,
    kind: "Guide" as const,
    href: `/${guide.slug}`,
    aliases: guide.keywords,
  })),
  ...METRIC_GUIDES.map((guide) => ({
    title: guide.name,
    kind: "Learn" as const,
    href: learnHref(guide.id),
    aliases: ALIASES[guide.id] ?? [],
  })),
];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9/&]+/g, " ")
    .trim();
}

/** How well a query matches one title or alias: exact, prefix, word prefix, then substring. */
function strength(query: string, candidate: string): number {
  if (!candidate) return 0;
  if (candidate === query) return 100;
  // Two characters are a ticker as often as a term — "MS", "KO" — so they
  // only ever match exactly.
  if (query.length < 3) return 0;
  if (candidate.startsWith(query)) return 80;
  if (candidate.split(" ").some((word) => word.startsWith(query))) return 60;
  if (query.length >= 4 && candidate.includes(query)) return 40;
  return 0;
}

export function searchTopics(query: string, limit = 3): LearnTopic[] {
  const needle = normalise(query);
  if (needle.length < 2) return [];

  return LEARN_TOPICS.map((topic, order) => ({
    topic,
    order,
    score: Math.max(
      strength(needle, normalise(topic.title)),
      ...topic.aliases.map((alias) => strength(needle, normalise(alias))),
    ),
  }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.topic.kind === b.topic.kind ? 0 : a.topic.kind === "Guide" ? -1 : 1) ||
        a.order - b.order,
    )
    .slice(0, limit)
    .map((entry) => entry.topic);
}
