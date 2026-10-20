"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeTab, sectionFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { TAB_ICONS } from "./nav-icons";

/**
 * The pages of the section the reader is in, as tabs above the page.
 *
 * Rendered once, by the layout, rather than by each page: it then sits above
 * every page of a section in every state the page has — signed in or out,
 * empty or full — and a page joins a section by being listed in lib/nav.ts,
 * with nothing to add to the page itself. Outside a section with pages of its
 * own (a company page, the account) it draws nothing.
 *
 * The current tab has two signals, an accent rule and full ink against the
 * muted rest, like the sidebar's current section. On a phone the row scrolls
 * sideways inside itself rather than widening the page.
 */
export function SectionTabs() {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  if (!section?.tabs) return null;
  const current = activeTab(section, pathname);

  return (
    <nav aria-label={`${section.label} pages`} className="section-tabs mb-3 border-b border-border">
      <ul className="flex list-none gap-1 overflow-x-auto [scrollbar-width:none]">
        {section.tabs.map((tab) => {
          const active = current?.href === tab.href;
          const Icon = TAB_ICONS[tab.href];
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2 text-[0.875rem] font-medium whitespace-nowrap transition-colors",
                  active
                    ? "border-accent text-foreground"
                    : "border-transparent text-muted hover:border-border hover:text-foreground",
                )}
              >
                {Icon && <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2} />}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
