import { afterEach, describe, expect, it } from "vitest";
import { flexTokenAllowed } from "./access";

describe("who may connect with a Flex token", () => {
  const original = process.env.BROKER_FLEX_TOKEN_EMAILS;
  afterEach(() => {
    if (original === undefined) delete process.env.BROKER_FLEX_TOKEN_EMAILS;
    else process.env.BROKER_FLEX_TOKEN_EMAILS = original;
  });

  it("is nobody until the owner lists someone", () => {
    delete process.env.BROKER_FLEX_TOKEN_EMAILS;
    expect(flexTokenAllowed("owner@example.com")).toBe(false);
  });

  it("is only the listed addresses, however they are written", () => {
    process.env.BROKER_FLEX_TOKEN_EMAILS = " Owner@Example.com , second@example.com,";
    expect(flexTokenAllowed("owner@example.com")).toBe(true);
    expect(flexTokenAllowed("SECOND@example.com ")).toBe(true);
    expect(flexTokenAllowed("reader@example.com")).toBe(false);
    expect(flexTokenAllowed("owner@example.com.evil")).toBe(false);
    expect(flexTokenAllowed(null)).toBe(false);
    expect(flexTokenAllowed("")).toBe(false);
  });
});
