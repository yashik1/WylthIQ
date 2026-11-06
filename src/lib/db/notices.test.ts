import { describe, expect, it } from "vitest";
import { isAlreadyDoneNotice, noticeLine } from "./notices";

describe("Postgres notices during a migration", () => {
  it("recognises a statement that found its work already done", () => {
    expect(isAlreadyDoneNotice({ code: "42P07", message: 'relation "trade_charts" already exists, skipping' })).toBe(true);
    expect(
      isAlreadyDoneNotice({ code: "42701", message: 'column "rsi_14" of relation "scores" already exists, skipping' }),
    ).toBe(true);
    expect(isAlreadyDoneNotice({ code: "00000", message: 'index "old_idx" does not exist, skipping' })).toBe(true);
  });

  it("keeps anything else, and prints it on one line", () => {
    const truncated = { code: "42622", message: 'identifier "a_very_long_name" will be truncated to "a_very_long"' };
    expect(isAlreadyDoneNotice(truncated)).toBe(false);
    expect(isAlreadyDoneNotice({})).toBe(false);
    expect(noticeLine(truncated)).toBe('Postgres notice 42622: identifier "a_very_long_name" will be truncated to "a_very_long"');
    expect(noticeLine({})).toBe("Postgres notice: (no message)");
  });
});
