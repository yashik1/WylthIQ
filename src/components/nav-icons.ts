import {
  Bell,
  Bookmark,
  Briefcase,
  CandlestickChart,
  Compass,
  GitCompare,
  GraduationCap,
  History,
  LayoutDashboard,
  LayoutList,
  Microscope,
  NotebookPen,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/*
  Icons for the sections and their tabs, keyed by href.

  Kept apart from the list in lib/nav.ts because a component cannot travel
  from the server layout to a client component the way a plain string can.
  Every href in that list must have an entry here; nav.test.ts checks, since
  a missing one is silently drawn without an icon.
*/
export const SECTION_ICONS: Readonly<Record<string, LucideIcon>> = {
  "/": LayoutDashboard,
  "/research": Microscope,
  "/portfolio": Briefcase,
  "/screen": Compass,
  "/learn": GraduationCap,
};

/** A tab can share its href with its section, and still want an icon of its own. */
export const TAB_ICONS: Readonly<Record<string, LucideIcon>> = {
  "/research": LayoutList,
  "/alerts": Bell,
  "/watchlist": Bookmark,
  "/portfolio": Wallet,
  "/journal": NotebookPen,
  "/screen": SlidersHorizontal,
  "/compare": GitCompare,
  "/markets": CandlestickChart,
  "/backtest": History,
};
