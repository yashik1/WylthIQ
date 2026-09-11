import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Filing a saved company under a group. The write is scoped to the caller's
 * account, and an empty group clears the row rather than storing a blank name.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../auth", () => ({ auth: vi.fn() }));
vi.mock("../db", () => ({ getDb: vi.fn(), isDatabaseConfigured: vi.fn(() => true) }));

import { auth } from "../auth";
import { getDb } from "../db";
import { setWatchlistGroup } from "./actions";

const dialect = new PgDialect();
const session = auth as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

describe("setting a watchlist group", () => {
  it("does nothing without a signed-in account", async () => {
    session.mockResolvedValue(null);
    expect((await setWatchlistGroup("AAPL", "Technology")).ok).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("stores a cleaned group against the caller's own saved company", async () => {
    session.mockResolvedValue({ user: { id: "user-a" } });
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    vi.mocked(getDb).mockReturnValue({ insert: vi.fn(() => ({ values })) } as never);

    expect(await setWatchlistGroup(" aapl ", "  Long   term ")).toEqual({ ok: true });
    expect(values).toHaveBeenCalledWith({ userId: "user-a", symbol: "AAPL", groupName: "Long term" });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ groupName: "Long term" }) }),
    );
  });

  it("clears the group, for the caller only, when given an empty name", async () => {
    session.mockResolvedValue({ user: { id: "user-a" } });
    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({ delete: vi.fn(() => ({ where })) } as never);

    expect(await setWatchlistGroup("AAPL", "   ")).toEqual({ ok: true });
    const query = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
    expect(query.params).toEqual(expect.arrayContaining(["user-a", "AAPL"]));
  });

  it("says groups need the migration when the table is missing", async () => {
    session.mockResolvedValue({ user: { id: "user-a" } });
    const values = vi.fn(() => ({
      onConflictDoUpdate: vi.fn().mockRejectedValue({ cause: { code: "42P01" } }),
    }));
    vi.mocked(getDb).mockReturnValue({ insert: vi.fn(() => ({ values })) } as never);

    const result = await setWatchlistGroup("AAPL", "Dividend");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/migration/);
  });
});
