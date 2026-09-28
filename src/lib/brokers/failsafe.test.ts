import { afterEach, describe, expect, it, vi } from "vitest";
import { failsafe, isSchemaMissing, UNAVAILABLE_MESSAGE } from "./failsafe";

/** What postgres.js throws for a table that is not there, wrapped the way Drizzle wraps it. */
function missingTable() {
  const cause = Object.assign(new Error('relation "broker_connections" does not exist'), { code: "42P01" });
  return Object.assign(new Error('Failed query: select "token_ciphertext" from "broker_connections" params: user-1'), {
    cause,
  });
}

describe("keeping a broker failure off the error screen", () => {
  afterEach(() => vi.restoreAllMocks());

  it("recognises a missing table or column however deeply it is wrapped", () => {
    expect(isSchemaMissing(missingTable())).toBe(true);
    expect(isSchemaMissing(Object.assign(new Error("x"), { code: "42703" }))).toBe(true);
    expect(isSchemaMissing(new Error("connection refused"))).toBe(false);
    expect(isSchemaMissing(null)).toBe(false);
  });

  it("answers with a plain sentence instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await failsafe("connecting", async () => {
      throw missingTable();
    });
    expect(result).toEqual({ ok: false, message: UNAVAILABLE_MESSAGE });
  });

  it("tells the operator the fix, without repeating the query or its values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await failsafe("connecting", async () => {
      throw missingTable();
    });
    const written = log.mock.calls.flat().join(" ");
    expect(written).toContain("npm run db:migrate");
    expect(written).not.toContain("select");
    expect(written).not.toContain("user-1");
  });

  it("passes a normal answer straight through", async () => {
    const result = await failsafe("syncing", async () => ({ ok: true, message: "Synced." }));
    expect(result).toEqual({ ok: true, message: "Synced." });
  });
});
