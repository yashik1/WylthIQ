import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAY_STARTS_AT,
  NIGHT_STARTS_AT,
  THEMES,
  THEME_IDS,
  isThemeChoice,
  msUntilThemeSwitch,
  themeForHour,
} from "./themes";

/**
 * The three places a theme has to exist, kept in agreement.
 *
 * A theme is not one thing. It is a token block in `globals.css`, an entry in
 * `themes.ts` so the picker can offer it, and an id in the inline pre-paint
 * script in `layout.tsx` — which cannot import anything, because it runs before
 * any bundle, so it carries its own copy of the list. Three copies is two too
 * many to hold by hand, and every failure mode is quiet:
 *
 *  - missing from the CSS: the picker offers a theme that does nothing
 *  - missing from `themes.ts`: the theme exists but nobody can reach it
 *  - missing from the script: the theme applies, then vanishes on reload
 *  - a token missing from one block: that value falls through to the block
 *    above, so a light border survives onto a dark page
 *
 * None of those throws, and none shows up in a typecheck.
 */

const root = join(import.meta.dirname, "..", "..");
const css = readFileSync(join(root, "src", "app", "globals.css"), "utf8");
const layout = readFileSync(join(root, "src", "app", "layout.tsx"), "utf8");

/** The declarations inside one `[data-theme="id"] { ... }` block. */
function themeBlock(id: string): string {
  const marker = `[data-theme="${id}"] {`;
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`no block for theme "${id}"`);
  const end = css.indexOf("\n}", start);
  return css.slice(start + marker.length, end);
}

function tokensIn(block: string): string[] {
  return [...block.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]).sort();
}

describe("every theme is defined everywhere it has to be", () => {
  it("has a token block in globals.css", () => {
    for (const id of THEME_IDS) {
      expect(css, id).toContain(`[data-theme="${id}"] {`);
    }
  });

  it("is listed in the pre-paint script, or it would not survive a reload", () => {
    const list = layout.match(/var ids = \[([^\]]*)\]/);
    expect(list, "pre-paint script id list not found in layout.tsx").not.toBeNull();

    const inScript = list![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(inScript).toEqual([...THEME_IDS].sort());
  });

  it("defines the identical token set in every theme", () => {
    // The reference is whichever theme comes first; what matters is that all
    // seven agree, not which one is right.
    const reference = tokensIn(themeBlock(THEME_IDS[0]));
    expect(reference.length).toBeGreaterThan(30);

    for (const id of THEME_IDS.slice(1)) {
      expect(tokensIn(themeBlock(id)), `theme "${id}"`).toEqual(reference);
    }
  });

  it("declares a color-scheme, so native controls match the page", () => {
    // Without this a date picker and a scrollbar render light on a dark ground.
    for (const theme of THEMES) {
      const block = themeBlock(theme.id);
      expect(block, theme.id).toContain(`color-scheme: ${theme.dark ? "dark" : "light"}`);
    }
  });
});

/**
 * The "Day / night" choice, which follows the reader's clock.
 *
 * It exists because "System" follows a device setting most people set once
 * and forget, so a machine on dark shows a dark page on a bright morning and
 * the setting looks broken. No browser reports the time of day, so this is
 * the only thing that can answer it.
 */
describe("day and night, by the clock", () => {
  it("is light through the working day and dark either side", () => {
    expect(themeForHour(6)).toBe("light");
    expect(themeForHour(12)).toBe("light");
    expect(themeForHour(17)).toBe("light");

    expect(themeForHour(18)).toBe("dark");
    expect(themeForHour(23)).toBe("dark");
    expect(themeForHour(0)).toBe("dark");
    expect(themeForHour(5)).toBe("dark");
  });

  /*
    The hours are written out again inside the pre-paint script, which runs
    before any bundle and so cannot import them. Two copies of a number is one
    too many to hold by hand, and the failure is quiet: the page would load in
    one theme and switch to the other a moment later.
  */
  it("uses the same two hours as the pre-paint script", () => {
    const script = layout.match(/h >= (\d+) && h < (\d+) \? 'light' : 'dark'/);
    expect(script, "day/night hours not found in the pre-paint script").not.toBeNull();
    expect(Number(script![1])).toBe(DAY_STARTS_AT);
    expect(Number(script![2])).toBe(NIGHT_STARTS_AT);
  });

  it("is a choice the app will accept back out of storage", () => {
    expect(isThemeChoice("daynight")).toBe(true);
  });

  describe("when it next changes itself", () => {
    const at = (h: number, m = 0) => new Date(2026, 8, 20, h, m, 0, 0);
    const hours = (ms: number) => ms / 3_600_000;

    it("waits for the evening while it is still day", () => {
      expect(hours(msUntilThemeSwitch(at(17, 30)))).toBeCloseTo(0.5, 5);
    });

    it("waits for the morning once it is night", () => {
      expect(hours(msUntilThemeSwitch(at(18, 0)))).toBeCloseTo(12, 5);
      expect(hours(msUntilThemeSwitch(at(23, 0)))).toBeCloseTo(7, 5);
    });

    it("waits for six from the small hours", () => {
      expect(hours(msUntilThemeSwitch(at(2, 0)))).toBeCloseTo(4, 5);
    });

    // A wait of zero would spin: the timer would fire, find the same hour and
    // set itself again immediately.
    it("always waits for something", () => {
      for (let h = 0; h < 24; h++) {
        expect(msUntilThemeSwitch(at(h, 0)), `${h}:00`).toBeGreaterThan(0);
      }
    });
  });
});

describe("what each palette promises", () => {
  const value = (id: string, token: string) => {
    const m = themeBlock(id).match(new RegExp(`^\\s*${token}:\\s*(.+);$`, "m"));
    return m?.[1].trim() ?? null;
  };

  it("never paints a rising price in the brand colour", () => {
    /*
      The app's own rule, from the top of globals.css: "a rising price and a
      brand colour must never be the same signal". It is easy to break by
      accident — the Nature palette is built on green, and reaching for the
      obvious emerald for both the accent and `--up` would make a link and a
      gain indistinguishable.
    */
    for (const id of THEME_IDS) {
      expect(value(id, "--up"), `theme "${id}"`).not.toBe(value(id, "--accent"));
      expect(value(id, "--down"), `theme "${id}"`).not.toBe(value(id, "--accent"));
    }
  });

  it("never paints a gain and a loss the same", () => {
    for (const id of THEME_IDS) {
      expect(value(id, "--up"), `theme "${id}"`).not.toBe(value(id, "--down"));
    }
  });

  it("gives every theme its own ground", () => {
    // Two themes resolving to the same background is a copied block.
    const grounds = THEME_IDS.map((id) => value(id, "--background"));
    expect(new Set(grounds).size).toBe(grounds.length);
  });

  it("keeps a light theme light and a dark theme dark", () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };

    for (const theme of THEMES) {
      const ground = value(theme.id, "--background")!;
      const ink = value(theme.id, "--foreground")!;
      const l = luminance(ground);
      if (theme.dark) {
        expect(l, `${theme.id} ground`).toBeLessThan(0.2);
        expect(luminance(ink), `${theme.id} ink`).toBeGreaterThan(l);
      } else {
        expect(l, `${theme.id} ground`).toBeGreaterThan(0.5);
        expect(luminance(ink), `${theme.id} ink`).toBeLessThan(l);
      }
    }
  });

  it("keeps body text legible on its own ground", () => {
    const srgb = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [srgb(a), srgb(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };

    for (const id of THEME_IDS) {
      const ground = value(id, "--background")!;
      // The two tiers that carry real content. `--faint` is deliberately below
      // this bar: it is used for asides that are never the only source of a
      // fact, which is the same judgement the original palette made.
      expect(ratio(value(id, "--foreground")!, ground), `${id} foreground`).toBeGreaterThan(7);
      expect(ratio(value(id, "--muted")!, ground), `${id} muted`).toBeGreaterThan(4.5);
    }
  });

  it("keeps button text legible on the button", () => {
    const srgb = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [srgb(a), srgb(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };

    for (const id of THEME_IDS) {
      expect(
        ratio(value(id, "--accent-fg")!, value(id, "--accent")!),
        `${id} accent-fg on accent`,
      ).toBeGreaterThan(4.5);
    }
  });
});

describe("stored preferences", () => {
  it("accepts every theme and the system option", () => {
    for (const id of THEME_IDS) expect(isThemeChoice(id)).toBe(true);
    expect(isThemeChoice("system")).toBe(true);
  });

  it("rejects anything else, so a stale value cannot be stamped", () => {
    // A theme removed in a later release leaves this string in real browsers.
    for (const bad of ["", "solarized", null, undefined, 3, {}]) {
      expect(isThemeChoice(bad)).toBe(false);
    }
  });
});
