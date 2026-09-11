import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Saved screens are one reader's own. These pin the part that matters most:
 * nothing is read or written without a signed-in account, and every write
 * carries the caller's user id in its own WHERE clause.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./billing/entitlement", () => ({ getEntitlement: vi.fn(), canAccess: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn(), isDatabaseConfigured: vi.fn(() => true) }));

import { canAccess, getEntitlement } from "./billing/entitlement";
import { getDb } from "./db";
import { deleteSavedScreen, recordScreenRun, renameSavedScreen } from "./saved-screens";

const dialect = new PgDialect();
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL);

function signedInAs(userId: string | null) {
  vi.mocked(getEntitlement).mockResolvedValue({ signedIn: userId != null, userId } as never);
  vi.mocked(canAccess).mockReturnValue(userId != null);
}

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

describe("saved screen actions", () => {
  it("does nothing at all without a signed-in account", async () => {
    signedInAs(null);

    expect((await renameSavedScreen(7, "Mine now")).ok).toBe(false);
    expect((await deleteSavedScreen(7)).ok).toBe(false);
    await recordScreenRun(7, 10);

    expect(getDb).not.toHaveBeenCalled();
  });

  it("renames only a screen the caller owns", async () => {
    signedInAs("user-a");
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(getDb).mockReturnValue({ update: vi.fn(() => ({ set })) } as never);

    expect(await renameSavedScreen(7, "  Canadian   quality ")).toEqual({ ok: true });

    expect(set).toHaveBeenCalledWith(expect.objectContaining({ name: "Canadian quality" }));
    const query = render(where.mock.calls[0][0]);
    expect(query.sql).toContain('"user_id"');
    expect(query.params).toEqual(expect.arrayContaining([7, "user-a"]));
  });

  it("explains a name already in use rather than failing silently", async () => {
    signedInAs("user-a");
    const where = vi.fn().mockRejectedValue({ message: "Failed query", cause: { code: "23505" } });
    vi.mocked(getDb).mockReturnValue({ update: vi.fn(() => ({ set: () => ({ where }) })) } as never);

    const result = await renameSavedScreen(7, "Taken");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already have a screen called/);
  });

  it("refuses an id that is not a positive whole number before touching the database", async () => {
    signedInAs("user-a");
    expect((await deleteSavedScreen(-1)).ok).toBe(false);
    expect((await renameSavedScreen(1.5, "x")).ok).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("deletes only the caller's own row", async () => {
    signedInAs("user-a");
    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({ delete: vi.fn(() => ({ where })) } as never);

    expect(await deleteSavedScreen(9)).toEqual({ ok: true });
    expect(render(where.mock.calls[0][0]).params).toEqual(expect.arrayContaining([9, "user-a"]));
  });

  it("records a run through the caller's own screen, and survives a missing table", async () => {
    signedInAs("user-a");
    const execute = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({ execute } as never);

    await recordScreenRun(12, 31);
    const query = render(execute.mock.calls[0][0]);
    expect(query.sql).toMatch(/WHERE id = \$\d+ AND user_id = \$\d+/);
    expect(query.params).toEqual([31, 12, "user-a"]);

    execute.mockRejectedValue({ cause: { code: "42P01" } });
    await expect(recordScreenRun(12, 31)).resolves.toBeUndefined();
  });
});
