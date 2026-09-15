import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { chooseSession, sessionDay, type SessionCount } from "./market-session";

/**
 * Choosing the trading day the dashboard ranks.
 *
 * On the live site the stored prices came from a dozen different days after
 * weeks of partial refreshes, and ranking only the newest collapsed "How
 * things moved" to sixteen companies and a single sector. What is pinned is
 * that a thin newest day gives way to a broad one, a broad newest day wins,
 * and nothing priced on another day is lost from the count.
 */

const day = (d: string, companies: number): SessionCount => ({
  day: d,
  companies,
  latest: `${d}T20:00:00Z`,
});

describe("the day to rank", () => {
  it("passes over a newest day that only a handful of companies reached", () => {
    // Close to the live shape: 16 on Sep 11, the rest spread over older days.
    const result = chooseSession([day("2026-09-11", 16), day("2026-09-03", 150), day("2026-08-16", 320)]);

    expect(result?.chosen.day).toBe("2026-08-16");
    expect(result?.ahead).toBe(166);
    expect(result?.behind).toBe(0);
  });

  it("takes the newest day once most companies have it", () => {
    const result = chooseSession([day("2026-09-15", 400), day("2026-09-14", 139)]);

    expect(result?.chosen.day).toBe("2026-09-15");
    expect(result).toMatchObject({ ahead: 0, behind: 139 });
  });

  it("takes the newest day at half the coverage of the widest", () => {
    expect(chooseSession([day("2026-09-15", 200), day("2026-09-14", 339)])?.chosen.day).toBe("2026-09-15");
    expect(chooseSession([day("2026-09-15", 169), day("2026-09-14", 339)])?.chosen.day).toBe("2026-09-14");
  });

  it("does not depend on the order the days arrive in", () => {
    const shuffled = chooseSession([day("2026-08-16", 320), day("2026-09-11", 16), day("2026-09-03", 150)]);
    expect(shuffled?.chosen.day).toBe("2026-08-16");
  });

  it("has nothing to rank without priced days", () => {
    expect(chooseSession([])).toBeNull();
    expect(chooseSession([{ day: "", companies: 5, latest: null }])).toBeNull();
  });
});

describe("the trading-day expression", () => {
  it("carries no parameters, so the same text can be selected and grouped by", () => {
    const query = new PgDialect().sqlToQuery(sessionDay);

    expect(query.params).toEqual([]);
    expect(query.sql).toContain("AT TIME ZONE 'America/New_York'");
  });
});
