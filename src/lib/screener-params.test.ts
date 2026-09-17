import { describe, expect, it } from "vitest";
import { numericParam } from "./screener";

/**
 * What an untouched filter box means.
 *
 * On 2026-09-17 a reader picked the Materials sector, pressed "Apply filters"
 * and was told the database had no companies in it and shown instructions for
 * running the ingest. There were 33 Materials companies. The form had
 * submitted its empty boxes, `Number("")` is 0, and "P/E at most 0" matches
 * nothing that has ever been stored.
 */

describe("a number typed into a filter", () => {
  it("is nothing at all when the box is empty", () => {
    expect(numericParam("")).toBeUndefined();
    expect(numericParam("   ")).toBeUndefined();
    expect(numericParam(undefined)).toBeUndefined();
    expect(numericParam(null)).toBeUndefined();
  });

  it("is a zero only when somebody typed one", () => {
    expect(numericParam("0")).toBe(0);
    expect(numericParam(" 0 ")).toBe(0);
  });

  it("reads an ordinary threshold", () => {
    expect(numericParam("20")).toBe(20);
    expect(numericParam("7.5")).toBe(7.5);
    expect(numericParam("-3")).toBe(-3);
  });

  it("ignores anything that is not a number", () => {
    expect(numericParam("twenty")).toBeUndefined();
    expect(numericParam("1e400")).toBeUndefined();
  });
});
