/**
 * Postgres notices, sorted into the ones worth reading and the ones that are
 * not.
 *
 * Every migration statement is written to be re-run — CREATE TABLE IF NOT
 * EXISTS, ADD COLUMN IF NOT EXISTS — and on a database that already has the
 * table or column, Postgres answers each one with a NOTICE saying so. The
 * postgres client's default is to console.log every notice as a nine-line
 * object, so each deploy's migration step printed 56 of them: over 500 log
 * lines, enough to trip Railway's 500-lines-a-second limit and drop real
 * messages along with them.
 *
 * A notice ending ", skipping" means the statement found its work already
 * done, which the migration reports as a count. Anything else is printed, on
 * one line.
 */

export interface PgNotice {
  code?: string;
  message?: string;
}

/** "relation … already exists, skipping", "index … does not exist, skipping". */
export function isAlreadyDoneNotice(notice: PgNotice): boolean {
  return typeof notice.message === "string" && /,\s*skipping$/i.test(notice.message.trim());
}

export function noticeLine(notice: PgNotice): string {
  const code = notice.code ? ` ${notice.code}` : "";
  return `Postgres notice${code}: ${notice.message ?? "(no message)"}`;
}
