import { describe, expect, it } from "vitest";
import { ACCOUNTING_FLAG, DISTRESS_FLAG } from "./model-flags";

describe("model flags", () => {
  it("say what the model found and that it is not a verdict", () => {
    expect(ACCOUNTING_FLAG.text).toMatch(/not evidence of wrongdoing\.$/);
    expect(DISTRESS_FLAG.text).toMatch(/not a forecast\.$/);
  });

  it("never advise", () => {
    for (const flag of [ACCOUNTING_FLAG, DISTRESS_FLAG]) {
      expect(`${flag.label} ${flag.text}`).not.toMatch(/\b(buy|sell|should|avoid|recommend)\b/i);
    }
  });
});
