import { describe, expect, it } from "vitest";
import { sinceInception } from "./since-inception";
import type { Bar } from "../providers/types";

/**
 * The whole-life return on a fund page.
 *
 * What is worth pinning is the honesty around it: the window is the dates
 * actually priced, a yearly rate is only stated once there has been a year,
 * and whether distributions are in the closes is carried rather than assumed.
 */

const bar = (date: string, close: number): Bar => ({
  time: Date.parse(`${date}T00:00:00Z`) / 1000,
  open: close,
  high: close,
  low: close,
  close,
  volume: 0,
});

describe("return since inception", () => {
  it("compounds the whole window into a yearly rate", () => {
    const result = sinceInception(
      [bar("2016-01-01", 100), bar("2021-01-01", 150), bar("2026-01-01", 200)],
      "2015-12-30",
      false,
    );

    expect(result?.totalReturn).toBeCloseTo(1, 6);
    expect(result?.perYear).toBeCloseTo(0.0718, 3);
    expect(result).toMatchObject({ from: "2016-01-01", to: "2026-01-01", partial: false });
  });

  it("states no yearly rate for a fund younger than a year", () => {
    const result = sinceInception([bar("2026-01-05", 20), bar("2026-06-01", 24)], "2026-01-02", false);

    expect(result?.totalReturn).toBeCloseTo(0.2, 6);
    expect(result?.perYear).toBeNull();
  });

  it("says when the price history starts long after the launch", () => {
    const late = sinceInception([bar("2015-01-01", 10), bar("2026-01-01", 20)], "2001-02-16", false);
    expect(late).toMatchObject({ partial: true, from: "2015-01-01", inceptionDate: "2001-02-16" });

    const prompt = sinceInception([bar("2001-03-01", 10), bar("2026-01-01", 20)], "2001-02-16", false);
    expect(prompt?.partial).toBe(false);
  });

  it("carries whether distributions are already in the closes", () => {
    const bars = [bar("2016-01-01", 100), bar("2026-01-01", 200)];
    expect(sinceInception(bars, "2016-01-01", true)?.includesDividends).toBe(true);
    expect(sinceInception(bars, "2016-01-01", null)?.includesDividends).toBeNull();
  });

  it("ignores prices from before the fund existed", () => {
    const result = sinceInception(
      [bar("2010-01-01", 999), bar("2016-01-01", 100), bar("2026-01-01", 200)],
      "2015-12-31",
      false,
    );
    expect(result?.from).toBe("2016-01-01");
    expect(result?.totalReturn).toBeCloseTo(1, 6);
  });

  it("uses the whole history when no launch date is published", () => {
    // Vanguard Canada's fund list carries no launch date, and most managers
    // this app cannot read carry nothing at all.
    const result = sinceInception(
      [bar("2012-11-05", 30), bar("2026-09-11", 94)],
      null,
      false,
    );

    expect(result).toMatchObject({ inceptionDate: null, from: "2012-11-05", partial: false });
    expect(result?.totalReturn).toBeCloseTo(2.133, 3);
  });

  it("has no figure without two priced dates, or from a launch date it cannot read", () => {
    expect(sinceInception([bar("2026-01-01", 10)], "2020-01-01", false)).toBeNull();
    expect(sinceInception([], "2020-01-01", false)).toBeNull();
    expect(sinceInception([bar("2016-01-01", 1), bar("2026-01-01", 2)], "not-a-date", false)).toBeNull();
  });
});
