import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * A thesis belongs to one reader. Nothing is read or written without a
 * session, and every statement carries the caller's own user id.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../billing/entitlement", () => ({ getEntitlement: vi.fn(), hasAccess: vi.fn() }));
vi.mock("../db", () => ({ getDb: vi.fn(), isDatabaseConfigured: vi.fn(() => true) }));

import { getEntitlement, hasAccess } from "../billing/entitlement";
import { getDb } from "../db";
import { deleteThesis, getThesis, saveThesis } from "./actions";

const dialect = new PgDialect();
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL);

function signedInAs(userId: string | null) {
  vi.mocked(getEntitlement).mockResolvedValue({ signedIn: userId != null, userId } as never);
  vi.mocked(hasAccess).mockReturnValue(userId != null);
}

const input = {
  thesis: "  Services keep compounding. ",
  mustGoRight: "Margins hold.",
  couldBreak: "Regulation of the app store.",
  horizon: "3-5y",
  status: "active",
  conditions: [
    { metric: "operatingMargin", operator: "above", target: "25" },
    { metric: "made-up", operator: "above", target: 1 },
  ],
};

beforeEach(() => {
  vi.mocked(getDb).mockReset();
});

describe("thesis actions", () => {
  it("does nothing without a signed-in account", async () => {
    signedInAs(null);
    expect((await saveThesis("AAPL", input)).ok).toBe(false);
    expect((await deleteThesis("AAPL")).ok).toBe(false);
    expect(await getThesis("AAPL")).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  it("saves a cleaned thesis against the caller's account, keeping only measurable conditions", async () => {
    signedInAs("user-a");
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const where = vi.fn().mockResolvedValue([]);
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({ from: () => ({ where }) })),
      insert: vi.fn(() => ({ values })),
    } as never);

    expect(await saveThesis(" aapl ", input)).toEqual({ ok: true, message: "Thesis saved." });
    expect(values).toHaveBeenCalledWith({
      userId: "user-a",
      symbol: "AAPL",
      thesis: "Services keep compounding.",
      mustGoRight: "Margins hold.",
      couldBreak: "Regulation of the app store.",
      horizon: "3-5y",
      status: "active",
      conditions: [{ metric: "operatingMargin", operator: "above", target: 25 }],
    });
    expect(render(where.mock.calls[0][0]).params).toEqual(["user-a"]);
    // An edit keeps the original creation date: only updatedAt is set on conflict.
    const set = onConflictDoUpdate.mock.calls[0][0].set;
    expect(set).not.toHaveProperty("createdAt");
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("refuses an empty thesis, and a symbol that is not one", async () => {
    signedInAs("user-a");
    expect((await saveThesis("AAPL", { thesis: " ", mustGoRight: "", couldBreak: "", horizon: null, status: "active", conditions: [] })).ok).toBe(false);
    expect((await saveThesis("AAPL; DROP TABLE", input)).ok).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("says theses need the migration when the table is missing", async () => {
    signedInAs("user-a");
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({ from: () => ({ where: vi.fn().mockRejectedValue({ cause: { code: "42P01" } }) }) })),
    } as never);
    const result = await saveThesis("AAPL", input);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/migration/);
  });

  it("reads and deletes only the caller's own thesis", async () => {
    signedInAs("user-a");
    const limit = vi.fn().mockResolvedValue([
      {
        id: 1, symbol: "AAPL", thesis: "x", mustGoRight: "", couldBreak: "", horizon: "nonsense",
        status: "at-risk", conditions: [{ metric: "netMargin", operator: "above", target: 20 }, { bad: true }],
        createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-02-01"),
      },
    ]);
    const selectWhere = vi.fn<(condition: unknown) => { limit: typeof limit }>(() => ({ limit }));
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn(() => ({ from: () => ({ where: selectWhere }) })),
      delete: vi.fn(() => ({ where: deleteWhere })),
    } as never);

    const thesis = await getThesis("AAPL");
    expect(thesis).toMatchObject({ horizon: null, status: "at-risk", conditions: [{ metric: "netMargin", operator: "above", target: 20 }] });
    expect(render(selectWhere.mock.calls[0][0]).params).toEqual(["user-a", "AAPL"]);

    expect((await deleteThesis("AAPL")).ok).toBe(true);
    expect(render(deleteWhere.mock.calls[0][0]).params).toEqual(["user-a", "AAPL"]);
  });
});
