import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const { SectionTabs } = await import("./section-tabs");

/** The opening tag of the link to `href`, whatever order its attributes come in. */
function linkTo(html: string, href: string): string {
  return html.match(new RegExp(`<a[^>]*href="${href}"[^>]*>`))?.[0] ?? "";
}

function render(pathname: string): string {
  route.pathname = pathname;
  return renderToStaticMarkup(<SectionTabs />);
}

describe("the tabs above a section's pages", () => {
  it("lists the section's pages and marks the one open", () => {
    const html = render("/alerts");
    expect(html).toContain('aria-label="Research pages"');
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(linkTo(html, "/alerts")).toContain('aria-current="page"');
    expect(linkTo(html, "/watchlist")).not.toContain("aria-current");
    // Every tab carries its icon, Alerts included.
    expect(html.match(/<svg/g)).toHaveLength(3);
  });

  it("keeps the tab lit on a page below it", () => {
    expect(linkTo(render("/backtest/screener"), "/backtest")).toContain('aria-current="page"');
  });

  it("draws nothing outside a section with pages of its own", () => {
    for (const path of ["/", "/learn", "/stock/AAPL", "/account"]) expect(render(path), path).toBe("");
  });
});
