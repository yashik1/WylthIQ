/**
 * The themes a reader can choose between.
 *
 * This module owns the *names*; `globals.css` owns the colours. Keeping them
 * apart matters because the CSS is what the browser needs before first paint —
 * a theme cannot be defined in JavaScript without the page flashing the wrong
 * one on every load — while the picker needs labels, descriptions and an order,
 * which have no business in a stylesheet.
 *
 * The pairing is checked rather than trusted: `themes.test.ts` reads
 * `globals.css` and fails if any id here has no block there, if any block
 * defines a different set of tokens from the others, or if a theme is missing
 * from the pre-paint script in `layout.tsx`.
 */

/** A theme id, as stamped on `<html data-theme>`. */
export type ThemeId =
  | "light"
  | "dark"
  | "midnight"
  | "nature"
  | "sunset"
  | "minimal"
  | "contrast";

/**
 * What the picker offers.
 *
 * Two of these are not themes but rules for choosing one. `system` follows the
 * device's appearance setting; `daynight` follows the reader's own clock,
 * which is what somebody means when they say a dark page on a bright morning
 * looks wrong — no browser reports the time of day, so nothing else can
 * answer that.
 */
export type ThemeChoice = ThemeId | "system" | "daynight";

export interface Theme {
  id: ThemeId;
  label: string;
  /** One line, shown under the label in the picker. */
  description: string;
  /**
   * Whether the theme paints light text on a dark ground.
   *
   * Drives the swatch the picker draws and the `color-scheme` the stylesheet
   * declares, which is what stops a native scrollbar or date picker rendering
   * a light control on a dark page.
   */
  dark: boolean;
}

export const THEMES: Theme[] = [
  {
    id: "light",
    label: "Light",
    description: "Clean, modern, focused.",
    dark: false,
  },
  {
    id: "dark",
    label: "Dark",
    description: "Easy on the eyes. Built for focus.",
    dark: true,
  },
  {
    id: "midnight",
    label: "Midnight Blue",
    description: "Modern, premium, professional.",
    dark: true,
  },
  {
    id: "nature",
    label: "Nature",
    description: "Calm, balanced, easy to read.",
    dark: true,
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm, unique, distinctive.",
    dark: true,
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Simple and distraction-free.",
    dark: false,
  },
  {
    id: "contrast",
    label: "High Contrast",
    description: "Maximum clarity, built for accessibility.",
    dark: true,
  },
];

export const THEME_IDS = THEMES.map((t) => t.id);

/** The localStorage key. Shared with the pre-paint script in `layout.tsx`. */
export const THEME_STORAGE_KEY = "theme";

/** Narrows an unknown stored value to a choice we can actually apply. */
export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "daynight" || THEME_IDS.includes(value as ThemeId);
}

/*
  When the day starts and ends, for the `daynight` choice.

  Six and eighteen, which is the convention every operating system that offers
  this uses, and close enough to sunrise and sunset for most of the year in
  most places. Deliberately not tied to real sunrise: that needs a location,
  and asking a reader for one to pick a colour scheme would be an absurd
  trade. These two numbers are repeated inside the pre-paint script in
  layout.tsx, which cannot import them — themes.test.ts fails if they drift.
*/
export const DAY_STARTS_AT = 6;
export const NIGHT_STARTS_AT = 18;

/** Which theme the reader's own clock asks for. */
export function themeForHour(hour: number): "light" | "dark" {
  return hour >= DAY_STARTS_AT && hour < NIGHT_STARTS_AT ? "light" : "dark";
}

/**
 * How long until the page should change itself, in milliseconds.
 *
 * A reader who leaves a tab open across six in the evening should watch it go
 * dark rather than find it light the next morning. Always positive, and never
 * more than the twelve hours between one boundary and the next.
 */
export function msUntilThemeSwitch(now: Date = new Date()): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(now.getHours() < DAY_STARTS_AT
    ? DAY_STARTS_AT
    : now.getHours() < NIGHT_STARTS_AT
      ? NIGHT_STARTS_AT
      : DAY_STARTS_AT + 24);
  return next.getTime() - now.getTime();
}

export function themeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}
