/**
 * What each feature costs, and what it is *allowed* to cost.
 *
 * One table, consulted by every gate in the app — pages, API routes and
 * server actions alike — so "what does this cost" is answered in exactly one
 * place. The previous version of this had a single boolean, paid or not, and
 * seven call sites asking it; the reason that worked is that there was only
 * ever one thing to sell.
 *
 * ---------------------------------------------------------------------------
 * THE PART THAT IS NOT ABOUT PRICING
 *
 * Some of this app's most attractive features cannot legally be sold, and the
 * reason is invisible in the code that implements them.
 *
 * Price history and quotes come from Twelve Data, Tiingo and Finnhub on their
 * free tiers, which licence the data for personal, non-commercial use. That
 * is a contractual limit rather than a technical one: no amount of caching,
 * proxying or attribution makes charging a subscriber for access to that data
 * permitted. It is the provider's call, not ours. So backtesting, the moving
 * averages, and any alert that watches a price are free-with-an-account
 * permanently — not as a generosity, and not as a launch promotion, but
 * because selling them would breach the terms the data arrived under.
 *
 * Everything sellable here rests on SEC EDGAR, which is public domain and
 * carries no such restriction, or on data the reader typed in themselves.
 *
 * The `kind` field below makes that distinction structural instead of a
 * comment somebody has to notice. A feature marked `personal-use-data` is
 * typed so that its `requires` can only be "anyone" or "account" — writing
 * `requires: "pro"` against one is a compile error, not a code review
 * question. That is deliberate: this constraint is exactly the kind that gets
 * quietly undone months later by someone reorganising a pricing page, and a
 * type is the only form of it that survives that.
 */

/**
 * What a visitor has to be to use something, in increasing order.
 *
 * One ordered axis rather than separate "needs an account" and "needs a plan"
 * flags, because every real question is a comparison — is this visitor at
 * least this far along — and two independent booleans cannot be compared.
 */
export type AccessLevel = "anyone" | "account" | "pro" | "pro-plus";

/** Ascending. Index order is the comparison, so this must stay sorted. */
const LEVEL_ORDER: readonly AccessLevel[] = ["anyone", "account", "pro", "pro-plus"];

/** The paid plans, as stored on a subscription row. */
export type Tier = "free" | "pro" | "pro-plus";

export type Feature =
  | "BASIC_STOCK_RESEARCH"
  | "BASIC_SCREENER"
  | "ADVANCED_SCREENER"
  | "SAVED_SCREENERS"
  | "CSV_EXPORT"
  | "PDF_REPORTS"
  | "TRADE_JOURNAL"
  | "FILING_ALERTS"
  | "PORTFOLIO"
  | "PORTFOLIO_ANALYTICS"
  | "BROKER_SYNC"
  | "AI_EXPLANATIONS"
  | "BACKTESTING"
  | "ADVANCED_CHARTS"
  | "PRICE_ALERTS";

/**
 * Why a feature is where it is.
 *
 * `sellable` covers anything built on SEC filings or on what the reader typed
 * in themselves, and may sit at any level. `personal-use-data` covers anything
 * built on the licensed price feeds, and the type permits only the two free
 * levels — see the header.
 */
export type FeaturePolicy =
  | { readonly kind: "sellable"; readonly requires: AccessLevel }
  | {
      readonly kind: "personal-use-data";
      readonly requires: Extract<AccessLevel, "anyone" | "account">;
      /** Shown to a reader who asks why this is not part of a paid plan. */
      readonly why: string;
    };

/** The price feeds' terms, stated once so every blocked feature cites the same thing. */
const PERSONAL_USE =
  "Built on market data licensed for personal, non-commercial use, so it cannot be sold — it stays free with an account.";

export const FEATURES: Readonly<Record<Feature, FeaturePolicy>> = {
  // --- open to anyone, signed in or not -----------------------------------
  // The research itself is the product's reason to exist and its entire
  // route to being found. Gating it would be gating the thing that brings
  // people here.
  BASIC_STOCK_RESEARCH: { kind: "sellable", requires: "anyone" },
  BASIC_SCREENER: { kind: "sellable", requires: "anyone" },

  // --- free, but need somewhere to put the reader's own data ---------------
  BACKTESTING: { kind: "personal-use-data", requires: "account", why: PERSONAL_USE },
  ADVANCED_CHARTS: { kind: "personal-use-data", requires: "account", why: PERSONAL_USE },
  PRICE_ALERTS: { kind: "personal-use-data", requires: "account", why: PERSONAL_USE },

  // --- Pro ----------------------------------------------------------------
  // All filings-derived or reader-authored, which is what makes them
  // chargeable at all.
  ADVANCED_SCREENER: { kind: "sellable", requires: "pro" },
  SAVED_SCREENERS: { kind: "sellable", requires: "pro" },
  CSV_EXPORT: { kind: "sellable", requires: "pro" },
  PDF_REPORTS: { kind: "sellable", requires: "pro" },
  TRADE_JOURNAL: { kind: "sellable", requires: "pro" },
  FILING_ALERTS: { kind: "sellable", requires: "pro" },

  // --- Pro+ ---------------------------------------------------------------
  // Holdings are the reader's own; the analysis over them is filings-derived.
  // Note what is absent: a live valuation of those holdings would need quotes,
  // which lands it under PERSONAL_USE above rather than here.
  PORTFOLIO: { kind: "sellable", requires: "pro-plus" },
  PORTFOLIO_ANALYTICS: { kind: "sellable", requires: "pro-plus" },
  // The reader's own positions and fills, read from their own broker with a
  // token they supplied — their data, like a holding typed in by hand. The
  // broker's marks are deliberately not stored, so the positions are valued
  // on the same quote path as everything else rather than on a price feed
  // this app would be reselling.
  BROKER_SYNC: { kind: "sellable", requires: "pro-plus" },

  // Available to everyone with an account and metered by tier instead of
  // being locked — see `src/lib/billing/quota.ts`. A hard gate here would
  // make the cheapest tier's allowance unreachable.
  AI_EXPLANATIONS: { kind: "sellable", requires: "account" },
};

/** The level a subscription tier grants. */
export function levelForTier(tier: Tier): AccessLevel {
  return tier === "pro-plus" ? "pro-plus" : tier === "pro" ? "pro" : "account";
}

/** Whether `have` reaches `need`. */
export function meets(have: AccessLevel, need: AccessLevel): boolean {
  return LEVEL_ORDER.indexOf(have) >= LEVEL_ORDER.indexOf(need);
}

/**
 * The level this visitor currently has.
 *
 * A subscription only counts when it is actually entitling — `subscribed`
 * already folds in Stripe's status and the grace period, so a lapsed payer
 * lands back on "account" rather than keeping their plan's level.
 */
export function levelFor(viewer: {
  signedIn: boolean;
  subscribed: boolean;
  tier: Tier;
}): AccessLevel {
  if (!viewer.signedIn) return "anyone";
  return viewer.subscribed ? levelForTier(viewer.tier) : "account";
}

/**
 * What a feature requires, once the deployment's access mode is applied.
 *
 * `accountIsEnough` is the existing switch that runs the whole app without
 * Stripe — in that mode every paid level collapses to "account", so the paid
 * features are open to anyone signed in and the billing machinery keeps
 * recording who paid without anything depending on it. Softening here rather
 * than at each gate is what keeps the two modes from disagreeing.
 */
export function requiredLevel(feature: Feature, accountIsEnough: boolean): AccessLevel {
  const required = FEATURES[feature].requires;
  if (!accountIsEnough) return required;
  return meets(required, "pro") ? "account" : required;
}

/**
 * The one question every gate asks.
 *
 * Takes the booleans it needs rather than a full Entitlement so this module
 * stays free of Drizzle, Auth.js and the database client — several callers are
 * client components that need to know which call to action to show, and
 * importing this must not drag a database driver into the browser bundle.
 */
export function canAccess(
  viewer: { signedIn: boolean; subscribed: boolean; tier: Tier },
  feature: Feature,
  accountIsEnough: boolean,
): boolean {
  return meets(levelFor(viewer), requiredLevel(feature, accountIsEnough));
}

/**
 * Whether a feature could ever sit behind a paid plan.
 *
 * Exported so the pricing page and the paywall cards can be built from this
 * table rather than from a second hand-maintained list — a marketing page
 * promising a feature the licence forbids selling is the exact failure this
 * module exists to make impossible.
 */
export function isSellable(feature: Feature): boolean {
  return FEATURES[feature].kind === "sellable";
}

/** Every feature a tier unlocks, for building pricing copy from the source of truth. */
export function featuresAt(level: AccessLevel): Feature[] {
  return (Object.keys(FEATURES) as Feature[]).filter(
    (f) => FEATURES[f].requires === level,
  );
}
