import { sql } from "drizzle-orm";
import { scores } from "./db/schema";

/**
 * Which trading day the dashboard's movers and sectors describe.
 *
 * "How things moved" ranks one day's moves against each other, so every price
 * in it must come from the same day. The question is which day, when stored
 * prices come from several — which is the ordinary state after a refresh that
 * only reached some companies.
 */

/**
 * A stored price's trading day, as New York dates it.
 *
 * The time zone and format are written inline rather than passed as
 * parameters, so the same text can be both selected and grouped by: Postgres
 * matches a GROUP BY expression to the select list by its text, and two
 * placeholders would not match each other.
 */
export const sessionDay = sql<string>`to_char(${scores.priceUpdatedAt} AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`;

export interface SessionCount {
  /** YYYY-MM-DD, New York. */
  day: string;
  companies: number;
  /** The newest stored price that day. */
  latest: Date | string | null;
}

export interface ChosenSession {
  chosen: SessionCount;
  /** Companies priced on a later day than the one chosen. */
  ahead: number;
  /** Companies priced on an earlier day. */
  behind: number;
}

/**
 * The newest day shared by at least half as many companies as the best
 * covered day.
 *
 * Taking the newest price alone ranked sixteen companies after a refresh that
 * only reached sixteen, and the dashboard lost every sector but one. Taking
 * the best covered day alone would hold on to an old full day after today's
 * refresh had reached most companies. Half is the point at which the newer day
 * is broad enough to stand for the market.
 */
export function chooseSession(sessions: SessionCount[]): ChosenSession | null {
  const usable = sessions.filter((s) => Boolean(s.day) && s.companies > 0);
  if (usable.length === 0) return null;

  const newestFirst = [...usable].sort((a, b) => b.day.localeCompare(a.day));
  const widest = Math.max(...newestFirst.map((s) => s.companies));
  // The widest day always qualifies, so this always finds one.
  const chosen = newestFirst.find((s) => s.companies * 2 >= widest)!;

  const sum = (list: SessionCount[]) => list.reduce((n, s) => n + s.companies, 0);

  return {
    chosen,
    ahead: sum(newestFirst.filter((s) => s.day > chosen.day)),
    behind: sum(newestFirst.filter((s) => s.day < chosen.day)),
  };
}
