/**
 * Keeps a failure in the broker features from taking the page down with it.
 *
 * A server action that throws hands its error to the page's error boundary,
 * which replaces the whole account page with a generic "that didn't load".
 * That is what happened when the broker tables had not been created yet: the
 * first query failed, and a reader who pressed "Connect a broker" lost the
 * page rather than being told the feature was not available.
 *
 * So every broker action and route runs inside `failsafe`, and answers with a
 * plain sentence instead. The server log still gets the reason — naming the
 * migration when that is what is missing, since that is the one an operator
 * can fix in a minute — but never the error's own text, which for a database
 * error can quote the query and its values.
 */

export interface FailsafeResult {
  ok: boolean;
  message: string;
}

export const UNAVAILABLE_MESSAGE =
  "Connecting a broker isn't available right now. Please try again later.";

/** Postgres's codes for a table or column that is not there: the migrations have not run. */
const SCHEMA_MISSING = new Set(["42P01", "42703"]);

/** Whether an error, or anything it wraps, is a missing table or column. */
export function isSchemaMissing(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && SCHEMA_MISSING.has(code)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Writes what went wrong to the server log, without the error's own message. */
export function logBrokerFailure(where: string, err: unknown): void {
  if (isSchemaMissing(err)) {
    console.error(
      `[brokers] ${where}: the broker tables are missing. Run \`npm run db:migrate\` against this database.`,
    );
    return;
  }
  console.error(`[brokers] ${where} failed:`, err instanceof Error ? err.name : "unknown error");
}

/** Runs a broker action, answering with a plain sentence if anything in it throws. */
export async function failsafe<T extends FailsafeResult>(
  where: string,
  run: () => Promise<T>,
): Promise<T | FailsafeResult> {
  try {
    return await run();
  } catch (err) {
    logBrokerFailure(where, err);
    return { ok: false, message: UNAVAILABLE_MESSAGE };
  }
}
