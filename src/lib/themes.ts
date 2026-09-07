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

/** What the picker offers, including the option to follow the operating system. */
export type ThemeChoice = ThemeId | "system";

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
  return value === "system" || THEME_IDS.includes(value as ThemeId);
}

export function themeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}
