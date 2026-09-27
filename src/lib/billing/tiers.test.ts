import { describe, expect, it } from "vitest";
import {
  FEATURES,
  canAccess,
  featuresAt,
  isSellable,
  levelFor,
  levelForTier,
  meets,
  requiredLevel,
  type Feature,
  type Tier,
} from "./tiers";

/**
 * What each feature costs, and what it is allowed to cost.
 *
 * The first half of this file is ordinary paywall arithmetic: a Pro feature
 * opens for a Pro subscriber and not for anyone else, a lapsed payer falls
 * back to what an account alone buys, and the development access mode opens
 * the paid tiers without touching who has actually paid.
 *
 * The second half is the part that matters more. Backtesting, the moving
 * averages and the price alerts are built on market data licensed for
 * personal, non-commercial use, so selling them would breach the terms the
 * data arrived under — a legal constraint that is completely invisible in the
 * code that draws a chart. Those tests exist to fail loudly if a later change
 * moves one of them behind a paid plan.
 */

const viewer = (over: Partial<Parameters<typeof levelFor>[0]> = {}) => ({
  signedIn: true,
  subscribed: false,
  tier: "free" as Tier,
  ...over,
});

const anonymous = viewer({ signedIn: false });
const member = viewer();
const pro = viewer({ subscribed: true, tier: "pro" });
const proPlus = viewer({ subscribed: true, tier: "pro-plus" });

/** Paid mode: what a real deployment taking payments enforces. */
const PAID = false;
/** The development mode, where an account alone opens the paid features. */
const OPEN = true;

describe("what a visitor has reached", () => {
  it("ranks the levels in order", () => {
    expect(meets("pro-plus", "pro")).toBe(true);
    expect(meets("pro", "pro-plus")).toBe(false);
    expect(meets("account", "account")).toBe(true);
    expect(meets("anyone", "account")).toBe(false);
  });

  it("gives a signed-out visitor the lowest level whatever their row says", () => {
    expect(levelFor({ signedIn: false, subscribed: true, tier: "pro-plus" })).toBe("anyone");
  });

  /*
    The case that decides what happens when a card expires. `subscribed`
    already folds in Stripe's status and the grace period, so a lapsed payer
    keeps the tier named on their row but drops to what an account alone buys.
  */
  it("drops a lapsed subscriber back to their account, not their old plan", () => {
    expect(levelFor({ signedIn: true, subscribed: false, tier: "pro-plus" })).toBe("account");
  });

  it("maps each plan to its level", () => {
    expect(levelForTier("pro-plus")).toBe("pro-plus");
    expect(levelForTier("pro")).toBe("pro");
    expect(levelForTier("free")).toBe("account");
  });
});

describe("who can use what, with payments enforced", () => {
  it("opens the research itself to anyone, signed in or not", () => {
    expect(canAccess(anonymous, "BASIC_STOCK_RESEARCH", PAID)).toBe(true);
    expect(canAccess(anonymous, "BASIC_SCREENER", PAID)).toBe(true);
  });

  it("keeps Pro features shut for a signed-in non-payer", () => {
    expect(canAccess(member, "ADVANCED_SCREENER", PAID)).toBe(false);
    expect(canAccess(member, "TRADE_JOURNAL", PAID)).toBe(false);
    expect(canAccess(member, "PDF_REPORTS", PAID)).toBe(false);
  });

  it("opens Pro features for a Pro subscriber", () => {
    expect(canAccess(pro, "ADVANCED_SCREENER", PAID)).toBe(true);
    expect(canAccess(pro, "SAVED_SCREENERS", PAID)).toBe(true);
    expect(canAccess(pro, "CSV_EXPORT", PAID)).toBe(true);
  });

  it("keeps Pro+ features shut for a Pro subscriber", () => {
    expect(canAccess(pro, "PORTFOLIO", PAID)).toBe(false);
    expect(canAccess(pro, "PORTFOLIO_ANALYTICS", PAID)).toBe(false);
  });

  it("gives a Pro+ subscriber everything Pro has as well", () => {
    expect(canAccess(proPlus, "PORTFOLIO", PAID)).toBe(true);
    expect(canAccess(proPlus, "ADVANCED_SCREENER", PAID)).toBe(true);
    expect(canAccess(proPlus, "TRADE_JOURNAL", PAID)).toBe(true);
  });

  it("shuts everything above the free line for a signed-out visitor", () => {
    for (const feature of Object.keys(FEATURES) as Feature[]) {
      if (FEATURES[feature].requires === "anyone") continue;
      expect(canAccess(anonymous, feature, PAID)).toBe(false);
    }
  });
});

describe("the development access mode", () => {
  /*
    The switch that runs the whole app without Stripe. Every paid level
    collapses to "account", so the paid features open to anyone signed in —
    while the billing machinery carries on recording who actually paid.
  */
  it("opens the paid features to any account", () => {
    expect(canAccess(member, "ADVANCED_SCREENER", OPEN)).toBe(true);
    expect(canAccess(member, "PORTFOLIO", OPEN)).toBe(true);
    expect(canAccess(member, "TRADE_JOURNAL", OPEN)).toBe(true);
  });

  it("still asks for an account", () => {
    expect(canAccess(anonymous, "ADVANCED_SCREENER", OPEN)).toBe(false);
    expect(canAccess(anonymous, "PORTFOLIO", OPEN)).toBe(false);
  });

  it("leaves the genuinely public pages public", () => {
    expect(canAccess(anonymous, "BASIC_STOCK_RESEARCH", OPEN)).toBe(true);
  });

  it("softens only the paid levels, never the free ones", () => {
    expect(requiredLevel("PORTFOLIO", OPEN)).toBe("account");
    expect(requiredLevel("BASIC_STOCK_RESEARCH", OPEN)).toBe("anyone");
    expect(requiredLevel("PORTFOLIO", PAID)).toBe("pro-plus");
  });

  /*
    Connecting a broker is free to anyone signed in for now and meant to be
    paid later. Sitting at Pro+ while the mode is open gives exactly that,
    with nothing to change at the gate when billing is switched on.
  */
  it("opens broker sync to any account now, and to Pro+ once billing is on", () => {
    expect(canAccess(member, "BROKER_SYNC", OPEN)).toBe(true);
    expect(canAccess(anonymous, "BROKER_SYNC", OPEN)).toBe(false);
    expect(canAccess(member, "BROKER_SYNC", PAID)).toBe(false);
    expect(canAccess(pro, "BROKER_SYNC", PAID)).toBe(false);
    expect(canAccess(proPlus, "BROKER_SYNC", PAID)).toBe(true);
  });
});

describe("the features that may never be sold", () => {
  /*
    Price history and quotes come from Twelve Data, Tiingo and Finnhub on free
    tiers licensed for personal, non-commercial use. Charging a subscriber for
    access to them would breach that, and no amount of caching or attribution
    changes it — it is the provider's call.

    The type in tiers.ts already makes `requires: "pro"` a compile error on
    these. This is the belt to that braces: it fails at test time too, and it
    names the reason, so somebody reorganising the pricing page a year from now
    finds out why rather than just that.
  */
  const BLOCKED: Feature[] = ["BACKTESTING", "ADVANCED_CHARTS", "PRICE_ALERTS"];

  it.each(BLOCKED)("%s is never behind a paid plan", (feature) => {
    expect(isSellable(feature)).toBe(false);
    expect(meets(FEATURES[feature].requires, "pro")).toBe(false);
  });

  it.each(BLOCKED)("%s is open to any signed-in reader, payments or not", (feature) => {
    expect(canAccess(member, feature, PAID)).toBe(true);
    expect(canAccess(member, feature, OPEN)).toBe(true);
  });

  it("says why, so a paywall can explain itself honestly", () => {
    for (const feature of BLOCKED) {
      const policy = FEATURES[feature];
      expect(policy.kind).toBe("personal-use-data");
      if (policy.kind === "personal-use-data") {
        expect(policy.why).toMatch(/personal, non-commercial/i);
      }
    }
  });

  /*
    The inverse, and the reason this one is worth writing: everything that IS
    sold has to be something we are allowed to sell. If a future feature built
    on price data gets marked sellable and priced, this catches it.
  */
  it("sells nothing that is built on the licensed price feeds", () => {
    const sold = (Object.keys(FEATURES) as Feature[]).filter((f) =>
      meets(FEATURES[f].requires, "pro"),
    );

    expect(sold.length).toBeGreaterThan(0);
    for (const feature of sold) expect(isSellable(feature)).toBe(true);
  });
});

describe("building pricing copy from the table", () => {
  /*
    The pricing page reads these rather than keeping its own list, so a plan
    can never advertise a feature the table does not actually grant.
  */
  it("lists what each level unlocks", () => {
    expect(featuresAt("pro")).toContain("ADVANCED_SCREENER");
    expect(featuresAt("pro-plus")).toContain("PORTFOLIO");
    expect(featuresAt("pro")).not.toContain("PORTFOLIO");
  });

  it("covers every feature exactly once across the levels", () => {
    const all = (["anyone", "account", "pro", "pro-plus"] as const).flatMap(featuresAt);
    expect(all.sort()).toEqual((Object.keys(FEATURES) as Feature[]).sort());
  });
});
