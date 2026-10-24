import { describe, expect, it } from "vitest";
import { nextTrendRefresh } from "./trend-schedule";

const next = (iso: string) => nextTrendRefresh(new Date(iso)).toISOString();

describe("when the price trends are next worked out", () => {
  it("is later the same weekday, before the evening run", () => {
    expect(next("2026-10-26T14:00:00Z")).toBe("2026-10-26T21:30:00.000Z");
  });

  it("is the next weekday once that day's run has gone", () => {
    expect(next("2026-10-26T22:00:00Z")).toBe("2026-10-27T21:30:00.000Z");
    expect(next("2026-10-26T21:30:00Z")).toBe("2026-10-27T21:30:00.000Z");
  });

  it("skips the weekend", () => {
    // Friday evening after the run, Saturday, and Sunday all point to Monday.
    expect(next("2026-10-23T23:53:00Z")).toBe("2026-10-26T21:30:00.000Z");
    expect(next("2026-10-24T09:00:00Z")).toBe("2026-10-26T21:30:00.000Z");
    expect(next("2026-10-25T23:59:00Z")).toBe("2026-10-26T21:30:00.000Z");
  });
});
