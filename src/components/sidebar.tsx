"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bookmark,
  Briefcase,
  CandlestickChart,
  ChevronsLeft,
  GitCompare,
  GraduationCap,
  History,
  LayoutDashboard,
  Menu,
  Microscope,
  NotebookPen,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string };

/** "/" would otherwise prefix-match every route in the app. */
function isActive(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/*
  Keyed by href rather than threaded through NavItem: the NAV array lives in
  the server-rendered layout.tsx, and a React component reference cannot cross
  the server/client boundary as a prop the way a plain string can. Both the
  rail and the mobile drawer live in this one client file, so one map covers
  both — which is the reason they were merged into a single file when the
  horizontal tabs became a sidebar.
*/
const NAV_ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/research": Microscope,
  "/watchlist": Bookmark,
  "/portfolio": Briefcase,
  "/screen": SlidersHorizontal,
  "/compare": GitCompare,
  "/markets": CandlestickChart,
  "/backtest": History,
  "/journal": NotebookPen,
  "/learn": GraduationCap,
};

const STORAGE_KEY = "sidebar";

/**
 * The primary navigation, as a left rail.
 *
 * A vertical rail rather than the horizontal tabs this replaces. Seven links
 * across the top of a page compete with the search box for the same row and
 * cap what the navigation can ever grow to; down the side they have room, they
 * read as a list rather than as chrome, and the current section stays visible
 * while the reader scrolls a long stock page.
 *
 * Collapsing is stamped on `<html data-sidebar>` rather than held in React
 * state alone, for the same reason the theme is: the width has to be right
 * before first paint, and `--sidebar-w` in globals.css — which the full-bleed
 * bands measure themselves against — has to resolve against the same value.
 * State here only mirrors it.
 */
export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "collapsed" : "expanded");
    } catch {
      // Private browsing can block storage; the rail still collapses for now.
    }
  }

  return (
    <nav
      aria-label="Sections"
      /*
        Sticky under the header rather than fixed, so it participates in the
        page's own layout and cannot overlap the footer. Its own scroll is for
        the case where the list outgrows a short window.
      */
      className="sticky top-[var(--header-h)] hidden h-[calc(100dvh-var(--header-h))] w-[var(--sidebar-w)] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/40 py-3 transition-[width] duration-200 lg:flex"
    >
      <ul className="grid list-none gap-0.5 px-2.5">
        {items.map((item) => (
          <li key={item.href}>
            <RailLink
              item={item}
              active={isActive(item.href, pathname)}
              collapsed={collapsed}
            />
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        className="mx-2.5 mt-auto flex items-center gap-2.5 rounded-lg border-l-2 border-transparent px-2.5 py-2 text-[0.8125rem] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        <ChevronsLeft
          aria-hidden
          className={cn("size-[18px] shrink-0 transition-transform", collapsed && "rotate-180")}
          strokeWidth={2}
        />
        <span className={cn("truncate", collapsed && "sr-only")}>Collapse</span>
      </button>
    </nav>
  );
}

function RailLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = NAV_ICONS[item.href];

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      /*
        Collapsed, the label is the accessible name and must survive — so it
        goes to `sr-only` rather than being dropped, and the anchor carries a
        `title` so a mouse user gets the same word on hover.
      */
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-[0.875rem] font-medium transition-colors",
        // Two signals for the current page, not one: an accent rule and full
        // ink against the muted rest, so it is still findable if the accent
        // hue is hard to separate.
        active
          ? "border-accent bg-accent-soft text-foreground"
          : "border-transparent text-muted hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {Icon && <Icon aria-hidden className="size-[18px] shrink-0" strokeWidth={2} />}
      <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
    </Link>
  );
}

/**
 * The same navigation below `lg`, where there is no room for a rail.
 *
 * A dropdown rather than a full-screen drawer: this app reaches for an overlay
 * nowhere else, and seven links do not need one. Closing behaviour follows the
 * pattern SearchBox already uses, so the popovers in this header behave alike
 * rather than each inventing their own rules.
 */
export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [renderedFor, setRenderedFor] = useState(pathname);
  const containerRef = useRef<HTMLDivElement>(null);

  /*
    Closes on navigation — a link click, or the back/forward buttons — so the
    panel never stays open over the page it was just used to leave.

    Adjusted during render rather than in an effect: React discards the
    in-progress output and re-renders immediately on a state change made
    during render, so the panel is never painted open-over-new-page even for
    one frame, which a `useEffect` here would do.
  */
  if (renderedFor !== pathname) {
    setRenderedFor(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="flex lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Close menu" : "Open menu"}
        className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-border bg-transparent text-muted-strong transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent"
      >
        {open ? <X aria-hidden className="size-4" /> : <Menu aria-hidden className="size-4" />}
      </button>

      {open && (
        <ul
          id="mobile-nav-panel"
          /*
            Anchored to the header rather than to this wrapper: sticky
            positioning establishes a containing block exactly as relative
            does, and the header is where the width should come from.
            Anchored here it would inherit this wrapper's own 34px box.
          */
          className="absolute inset-x-4 top-full z-50 mt-2 list-none rounded-xl border border-border bg-surface py-1 shadow-[var(--shadow-lg)] sm:inset-x-7"
        >
          {items.map((item) => {
            const active = isActive(item.href, pathname);
            const Icon = NAV_ICONS[item.href];

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  // Closes on tap rather than only once the route changes.
                  // Tapping the link for the page already open changes no
                  // pathname for the render-time check above to react to.
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 border-l-2 px-4 py-3 text-[0.90625rem] font-medium transition-colors",
                    active
                      ? "border-accent bg-surface-2 text-foreground"
                      : "border-transparent text-muted hover:bg-surface-2 hover:text-foreground",
                  )}
                >
                  {Icon && <Icon aria-hidden className="size-[18px]" strokeWidth={2} />}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
