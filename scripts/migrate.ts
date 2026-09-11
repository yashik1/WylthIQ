/**
 * Creates the database tables.
 *
 * Deliberately does not use drizzle-kit. That is a devDependency, and hosting
 * platforms set NODE_ENV=production and prune those, so `drizzle-kit push`
 * cannot run in a deployed container. This script needs only `postgres`, which
 * the app depends on anyway, so it works everywhere.
 *
 *   npm run db:migrate
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/**
 * Every table the app expects to exist once all migrations have run: the five
 * original market-data tables, the accounts, billing and journal tables, and
 * the saved-companies list, and the trade journal. Checked after the fact so a half-applied migration
 * is reported rather than discovered later by a page failing.
 *
 * The names are the single source of truth and the count is derived from them.
 * This used to be a number sitting beside a hard-coded list in the query below
 * — two things that had to agree with nothing making them agree. Adding
 * watchlist_items to one and not the other reported a perfectly good schema as
 * broken, and pointed the reader at errors that had never been printed.
 */
const EXPECTED_TABLES = [
  "companies", "financials", "scores", "price_cache", "ingest_runs",
  "users", "accounts", "sessions", "verification_tokens",
  "password_reset_tokens", "subscriptions", "journal_entries",
  "watchlist_items", "playbooks", "trades",
  "watchlist_groups", "saved_screen_runs",
] as const;

/** Postgres error codes we treat as "already done" rather than failures. */
const ALREADY_EXISTS = new Set([
  "42P07", // duplicate_table
  "42710", // duplicate_object (index, constraint)
  "42P16", // invalid_table_definition, e.g. re-adding a primary key
  "42701", // duplicate_column, from re-running an ADD COLUMN migration
]);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set.\n\n" +
        "  On Railway: Variables tab -> DATABASE_URL = ${{Postgres.DATABASE_URL}}\n" +
        "  Locally:    put the PUBLIC connection string in .env.local\n",
    );
    process.exit(1);
  }

  // Every migration, in filename order — not just the first. Each statement is
  // individually tolerant of "already exists", so re-running is safe and a
  // partially-applied schema catches up rather than needing a reset.
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.error("No .sql migrations found in drizzle/.");
    process.exit(1);
  }

  const statements = files.flatMap((file) =>
    readFileSync(join(dir, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  console.log(`Applying ${statements.length} statements from ${files.length} migration(s):`);
  for (const f of files) console.log(`  ${f}`);
  console.log();

  const sql = postgres(url, { max: 1, connect_timeout: 15, prepare: false });

  let created = 0;
  let skipped = 0;

  try {
    for (const statement of statements) {
      try {
        await sql.unsafe(statement);
        created++;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code && ALREADY_EXISTS.has(code)) {
          skipped++;
          continue;
        }
        throw err;
      }
    }

    // Prove the tables are actually queryable before reporting success.
    const present = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ${sql(EXPECTED_TABLES)}
    `;

    const found = new Set(present.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !found.has(t));

    console.log(`\n${created} applied, ${skipped} already existed.`);
    console.log(`${found.size} of ${EXPECTED_TABLES.length} expected tables present.`);

    if (missing.length > 0) {
      // Names the tables rather than pointing at "the errors above", which may
      // not be there: every statement can be skipped as already-existing while
      // a table is genuinely absent, and then there is nothing above to check.
      console.error(`\nMissing: ${missing.join(", ")}`);
      console.error(
        "Re-run this command. If a table is still missing afterwards, the migration\n" +
          "that creates it is failing for some reason other than 'already exists'.",
      );
      process.exitCode = 1;
    } else {
      console.log("\nSchema is ready. Next: npm run ingest -- --limit 25");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  const code = (err as { code?: string }).code;
  console.error("\nMigration failed:", err instanceof Error ? err.message : err);

  if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT") {
    console.error(
      "\nCould not reach the database. If the host ends in .railway.internal it only\n" +
        "resolves inside Railway — from elsewhere use DATABASE_PUBLIC_URL instead.",
    );
  } else if (code === "28P01") {
    console.error("\nThe password in DATABASE_URL was rejected.");
  }
  process.exit(1);
});
