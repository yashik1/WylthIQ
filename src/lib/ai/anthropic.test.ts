import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callClaude } from "./anthropic";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  delete process.env.ANTHROPIC_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  delete process.env.ANTHROPIC_API_KEY;
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("calling Claude", () => {
  it("does nothing without a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await callClaude({ system: "s", user: "u" })).toEqual({ ok: false, kind: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the system prompt and one user message to the configured model, and returns the text", async () => {
    fetchMock.mockResolvedValue(json(200, { content: [{ type: "text", text: "Revenue rose [S3]." }] }));

    const result = await callClaude({ system: "rules", user: "facts", maxTokens: 300 });
    expect(result).toEqual({ ok: true, text: "Revenue rose [S3].", model: "claude-opus-5" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "test-key-not-real", "anthropic-version": "2023-06-01" });
    expect(JSON.parse(init.body)).toEqual({
      model: "claude-opus-5",
      max_tokens: 300,
      system: "rules",
      messages: [{ role: "user", content: "facts" }],
    });
  });

  it("uses a model an operator configured", async () => {
    process.env.ANTHROPIC_MODEL = "claude-sonnet-5";
    fetchMock.mockResolvedValue(json(200, { content: [{ type: "text", text: "ok" }] }));
    expect(await callClaude({ system: "s", user: "u" })).toMatchObject({ model: "claude-sonnet-5" });
  });

  it("classifies failures without passing on the provider's message", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: { message: "slow down" } }));
    expect(await callClaude({ system: "s", user: "u" })).toEqual({ ok: false, kind: "RATE_LIMITED", status: 429 });

    fetchMock.mockResolvedValueOnce(json(529, {}));
    expect(await callClaude({ system: "s", user: "u" })).toMatchObject({ kind: "RATE_LIMITED" });

    fetchMock.mockResolvedValueOnce(json(401, { error: { message: "bad key test-key-not-real" } }));
    const unauthorised = await callClaude({ system: "s", user: "u" });
    expect(unauthorised).toEqual({ ok: false, kind: "PROVIDER_ERROR", status: 401 });
    expect(JSON.stringify(unauthorised)).not.toContain("test-key");

    fetchMock.mockResolvedValueOnce(json(200, { content: [{ type: "tool_use" }] }));
    expect(await callClaude({ system: "s", user: "u" })).toEqual({ ok: false, kind: "INVALID_DATA" });

    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await callClaude({ system: "s", user: "u" })).toEqual({ ok: false, kind: "PROVIDER_ERROR" });
  });

  it("gives up after the timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    expect(await callClaude({ system: "s", user: "u", timeoutMs: 10 })).toEqual({ ok: false, kind: "TIMEOUT" });
  });
});
