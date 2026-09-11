import { describe, expect, it } from "vitest";
import { PRESETS, type PresetKey } from "./screener";

/**
 * The one-click screens.
 *
 * A preset is where a beginner starts, so each has to say what it looks for
 * and — as plainly — what it cannot tell them.
 */

describe("screener presets", () => {
  it("offers the five research presets and keeps red flags", () => {
    const labels = (Object.keys(PRESETS) as PresetKey[]).map((key) => PRESETS[key].label);
    expect(labels).toEqual(["Financial health", "Growth", "Value", "Dividend", "Quality", "Red flags"]);
  });

  it("keeps the keys existing links use", () => {
    for (const key of ["healthy", "cheap-profitable", "growing", "dividend", "red-flags"]) {
      expect(PRESETS).toHaveProperty(key);
    }
  });

  it("says what each looks for and what it does not tell", () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      expect(preset.looksFor.length, key).toBeGreaterThan(0);
      expect(preset.doesNotTell.length, key).toBeGreaterThan(40);
    }
  });

  it("never advises", () => {
    for (const [key, preset] of Object.entries(PRESETS)) {
      const prose = [preset.description, ...preset.looksFor, preset.doesNotTell].join(" ");
      expect(prose, key).not.toMatch(/\b(buy|sell|should|recommend|avoid|undervalued)\b/i);
    }
  });
});
