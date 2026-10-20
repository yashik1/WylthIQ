import { describe, expect, it } from "vitest";
import { SECTION_ICONS, TAB_ICONS } from "@/components/nav-icons";
import { activeTab, NAV_SECTIONS, sectionFor } from "./nav";

/** The eleven pages the sidebar listed before it was grouped. */
const EVERY_PAGE = [
  "/",
  "/research",
  "/alerts",
  "/watchlist",
  "/portfolio",
  "/screen",
  "/compare",
  "/markets",
  "/backtest",
  "/journal",
  "/learn",
];

describe("the sections of the site", () => {
  it("still reaches every page the sidebar used to list, from five items", () => {
    expect(NAV_SECTIONS).toHaveLength(5);
    const reachable = NAV_SECTIONS.flatMap((s) => [s.href, ...(s.tabs ?? []).map((t) => t.href)]);
    for (const page of EVERY_PAGE) expect(reachable, page).toContain(page);
  });

  it("puts each page in its section", () => {
    const sectionOf = (path: string) => sectionFor(path)?.label ?? null;
    expect(sectionOf("/")).toBe("Dashboard");
    expect(["/research", "/alerts", "/watchlist"].map(sectionOf)).toEqual(["Research", "Research", "Research"]);
    expect(["/portfolio", "/journal"].map(sectionOf)).toEqual(["Portfolio", "Portfolio"]);
    expect(["/screen", "/compare", "/markets", "/backtest", "/backtest/screener"].map(sectionOf)).toEqual(
      Array(5).fill("Explore"),
    );
    expect(sectionOf("/learn")).toBe("Learn");
  });

  it("leaves pages outside the sections out, and does not match on a shared prefix", () => {
    for (const path of ["/stock/AAPL", "/account", "/companies", "/research-notes", "/screener-guide"]) {
      expect(sectionFor(path), path).toBeNull();
    }
  });

  it("marks the tab a page is on, below it too", () => {
    const explore = sectionFor("/compare")!;
    expect(activeTab(explore, "/compare")?.label).toBe("Compare");
    expect(activeTab(explore, "/backtest/screener")?.label).toBe("Backtest");
    expect(activeTab(sectionFor("/research")!, "/research")?.label).toBe("Overview");
    expect(activeTab(sectionFor("/journal")!, "/journal")?.label).toBe("Journal");
  });

  it("has an icon for every section and every tab, so none is drawn without one", () => {
    for (const section of NAV_SECTIONS) {
      expect(SECTION_ICONS[section.href], section.label).toBeDefined();
      for (const tab of section.tabs ?? []) expect(TAB_ICONS[tab.href], tab.label).toBeDefined();
    }
  });
});
