import { describe, expect, it } from "vitest";
import { classifyProviderError, ProviderTimeoutError, withTimeout } from "./errors";

describe("classifying provider failures", () => {
  it("recognises rate limits however a provider words them", () => {
    expect(classifyProviderError(new Error("You have run out of API credits for the current minute"))).toBe("RATE_LIMITED");
    expect(classifyProviderError(new Error("HTTP 429 Too Many Requests"))).toBe("RATE_LIMITED");
    expect(classifyProviderError(Object.assign(new Error("nope"), { status: 429 }))).toBe("RATE_LIMITED");
  });

  it("recognises timeouts", () => {
    expect(classifyProviderError(new ProviderTimeoutError("Tiingo", 8000))).toBe("TIMEOUT");
    expect(classifyProviderError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("TIMEOUT");
    expect(classifyProviderError(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe("TIMEOUT");
  });

  it("recognises a symbol the provider does not know", () => {
    expect(classifyProviderError(new Error("symbol not found"))).toBe("NOT_FOUND");
    expect(classifyProviderError(Object.assign(new Error("x"), { status: 404 }))).toBe("NOT_FOUND");
  });

  it("recognises a response that could not be read", () => {
    expect(classifyProviderError(new SyntaxError("Unexpected token < in JSON at position 0"))).toBe("INVALID_DATA");
  });

  it("calls everything else a provider error, including a refused key", () => {
    expect(classifyProviderError(new Error("Invalid API key"))).toBe("PROVIDER_ERROR");
    expect(classifyProviderError("something odd")).toBe("PROVIDER_ERROR");
    expect(classifyProviderError(undefined)).toBe("PROVIDER_ERROR");
  });
});

describe("timing out a provider call", () => {
  it("passes a prompt answer through", async () => {
    await expect(withTimeout(Promise.resolve(42), 50, "A")).resolves.toBe(42);
  });

  it("rejects with a timeout when the call hangs", async () => {
    const hang = new Promise<number>(() => {});
    await expect(withTimeout(hang, 10, "Slow")).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("passes a provider's own failure through unchanged", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 50, "A")).rejects.toThrow("boom");
  });
});
