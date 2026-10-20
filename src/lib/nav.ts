/**
 * The site's sections, and the pages inside each.
 *
 * Eleven pages used to sit in the sidebar side by side, though several are
 * views of the same thing: Research, Alerts and Watchlist all follow the
 * saved companies; Portfolio and Journal both hold what the reader owns and
 * trades; Screener, Compare, Markets and Backtest are all ways of exploring
 * an idea. So the sidebar lists the five sections, and a section's own pages
 * are tabs across the top of each of them. Every page keeps its address.
 *
 * Plain strings only: this list is read by the server layout and handed to
 * client components, and nothing but plain data crosses that boundary. Icons
 * are looked up by href on the client side (see nav-icons.ts).
 */

export interface NavTab {
  href: string;
  label: string;
}

export interface NavSection {
  /** Where the sidebar item goes: the section's first page. */
  href: string;
  label: string;
  /** The section's pages, shown as tabs. Absent for a section that is one page. */
  tabs?: NavTab[];
}

export const NAV_SECTIONS: NavSection[] = [
  { href: "/", label: "Dashboard" },
  {
    href: "/research",
    label: "Research",
    tabs: [
      { href: "/research", label: "Overview" },
      { href: "/alerts", label: "Alerts" },
      { href: "/watchlist", label: "Watchlist" },
    ],
  },
  {
    href: "/portfolio",
    label: "Portfolio",
    tabs: [
      { href: "/portfolio", label: "Holdings" },
      { href: "/journal", label: "Journal" },
    ],
  },
  {
    href: "/screen",
    label: "Explore",
    tabs: [
      { href: "/screen", label: "Screener" },
      { href: "/compare", label: "Compare" },
      { href: "/markets", label: "Markets" },
      { href: "/backtest", label: "Backtest" },
    ],
  },
  { href: "/learn", label: "Learn" },
];

/**
 * Whether `pathname` is the page at `href` or one below it. On a segment
 * boundary, so /research-notes is not /research; and "/" only ever matches
 * itself, or it would match every page.
 */
function within(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Every page a section covers: its own href and its tabs'. */
function pagesOf(section: NavSection): string[] {
  return [section.href, ...(section.tabs ?? []).map((tab) => tab.href)];
}

/** The section a page belongs to, or null for one outside them all (a company page, the account). */
export function sectionFor(pathname: string, sections: NavSection[] = NAV_SECTIONS): NavSection | null {
  return sections.find((section) => pagesOf(section).some((href) => within(href, pathname))) ?? null;
}

/** The tab a page is on: the most specific one that contains it. */
export function activeTab(section: NavSection, pathname: string): NavTab | null {
  const matching = (section.tabs ?? []).filter((tab) => within(tab.href, pathname));
  return matching.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}
