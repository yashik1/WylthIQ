import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Company universe. Populated by the ingest job from the seed list plus SEC
 * metadata. `sectorKind` is derived from the SIC code and drives which scoring
 * models apply.
 */
export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    cik: text("cik"),
    name: text("name").notNull(),
    exchange: text("exchange"),
    country: text("country"),
    sicCode: text("sic_code"),
    sicDescription: text("sic_description"),
    /** financial | real-estate | manufacturing | other — gates which scoring
        models apply. Deliberately coarse; not for display. */
    sectorKind: text("sector_kind").notNull().default("other"),
    /** Familiar market sector for grouping and the heatmap. */
    displaySector: text("display_sector").notNull().default("Other"),
    industry: text("industry"),
    logoUrl: text("logo_url"),
    website: text("website"),
    /** Canadian companies cross-listed on US exchanges are flagged for filtering. */
    isCanadian: boolean("is_canadian").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("companies_symbol_idx").on(t.symbol),
    index("companies_sector_idx").on(t.sectorKind),
    index("companies_display_sector_idx").on(t.displaySector),
  ],
);

/**
 * One row per company per fiscal year, in canonical fields.
 *
 * Stored as double precision: values reach the trillions but stay far inside the
 * 2^53 exact-integer range, and every downstream use is a ratio.
 */
export const financials = pgTable(
  "financials",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year").notNull(),
    endDate: text("end_date").notNull(),
    form: text("form"),
    currency: text("currency").default("USD"),
    /**
     * ISO date the filing carrying these figures was submitted to the SEC —
     * distinct from `endDate`, which is the period the figures describe. A
     * FY2020 10-K is typically filed six to ten weeks into 2021, so a reader
     * who only knew what was public on, say, 2021-01-15 could not yet have
     * seen these numbers. Backtesting a "buy the healthy companies" strategy
     * without this distinction quietly cheats: it scores 2020 using 2020's
     * results before those results existed.
     *
     * Nullable because it depends on the SEC payload's own `filed` field,
     * which fallback providers (Yahoo, Alpha Vantage, EODHD) never carry — see
     * their comments in src/lib/providers/. A row with no filedAt should be
     * excluded from point-in-time reconstruction, not assumed current.
     */
    filedAt: text("filed_at"),

    assets: doublePrecision("assets"),
    liabilities: doublePrecision("liabilities"),
    equity: doublePrecision("equity"),
    currentAssets: doublePrecision("current_assets"),
    currentLiabilities: doublePrecision("current_liabilities"),
    cash: doublePrecision("cash"),
    receivables: doublePrecision("receivables"),
    inventory: doublePrecision("inventory"),
    ppe: doublePrecision("ppe"),
    longTermDebt: doublePrecision("long_term_debt"),
    shortTermDebt: doublePrecision("short_term_debt"),
    retainedEarnings: doublePrecision("retained_earnings"),

    revenue: doublePrecision("revenue"),
    costOfRevenue: doublePrecision("cost_of_revenue"),
    grossProfit: doublePrecision("gross_profit"),
    operatingIncome: doublePrecision("operating_income"),
    netIncome: doublePrecision("net_income"),
    incomeBeforeTax: doublePrecision("income_before_tax"),
    interestExpense: doublePrecision("interest_expense"),
    sga: doublePrecision("sga"),
    depreciation: doublePrecision("depreciation"),

    operatingCashFlow: doublePrecision("operating_cash_flow"),
    capex: doublePrecision("capex"),
    dividendsPaid: doublePrecision("dividends_paid"),
    sharesOutstanding: doublePrecision("shares_outstanding"),

    /** Link back to the filing these figures came from. */
    sourceFilingUrl: text("source_filing_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("financials_company_year_idx").on(t.companyId, t.fiscalYear)],
);

/**
 * Precomputed scores — the table the screener reads.
 *
 * Screening never fans out to external APIs; it queries only this table, which
 * is what makes a universe-wide filter fast and free.
 */
export const scores = pgTable(
  "scores",
  {
    companyId: integer("company_id")
      .primaryKey()
      .references(() => companies.id, { onDelete: "cascade" }),
    fiscalYear: integer("fiscal_year"),

    /** 0-10 composite. Null when too little was reported to judge. */
    healthScore: doublePrecision("health_score"),

    fScore: integer("f_score"),
    fScoreMax: integer("f_score_max"),

    zScore: doublePrecision("z_score"),
    zZone: text("z_zone"),
    zApplicable: boolean("z_applicable").notNull().default(false),

    mScore: doublePrecision("m_score"),
    mFlagged: boolean("m_flagged"),
    mApplicable: boolean("m_applicable").notNull().default(false),

    marketCap: doublePrecision("market_cap"),
    peRatio: doublePrecision("pe_ratio"),
    pbRatio: doublePrecision("pb_ratio"),
    psRatio: doublePrecision("ps_ratio"),
    dividendYield: doublePrecision("dividend_yield"),

    revenueGrowth: doublePrecision("revenue_growth"),
    netMargin: doublePrecision("net_margin"),
    returnOnAssets: doublePrecision("return_on_assets"),
    debtToEquity: doublePrecision("debt_to_equity"),
    currentRatio: doublePrecision("current_ratio"),

    /**
     * Latest quote, refreshed separately from the nightly fundamentals pass.
     * Movers and the sector heatmap read these rather than fanning out to a
     * price API per symbol, which no free tier would sustain.
     */
    price: doublePrecision("price"),
    changePercent: doublePrecision("change_percent"),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),

    /** Cached plain-English question output, so pages render without recompute. */
    questions: jsonb("questions"),
    headline: text("headline"),

    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scores_health_idx").on(t.healthScore),
    index("scores_market_cap_idx").on(t.marketCap),
    index("scores_pe_idx").on(t.peRatio),
    index("scores_f_idx").on(t.fScore),
    index("scores_change_idx").on(t.changePercent),
  ],
);

/** Cached OHLCV series, keyed by symbol and timeframe. */
export const priceCache = pgTable(
  "price_cache",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    bars: jsonb("bars").notNull(),
    fromDate: timestamp("from_date", { withTimezone: true }).notNull(),
    toDate: timestamp("to_date", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("price_cache_key_idx").on(t.symbol, t.timeframe)],
);

/** Audit trail for ingest runs, so a partial or failed refresh is visible. */
export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  processed: integer("processed").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  status: text("status").notNull().default("running"),
  notes: text("notes"),
});

/* ------------------------------------------------------------------ accounts
 *
 * Auth.js owns the shape of the four tables below — `users`, `accounts`,
 * `sessions` and `verificationTokens` are what its Drizzle adapter expects,
 * with those exact column names. They are hand-written here rather than
 * imported so the whole schema stays in one file and one migration path, but
 * the shape is not ours to redesign: renaming a column breaks the adapter.
 *
 * `passwordHash` is the one addition. Auth.js has no opinion about passwords —
 * its Credentials provider hands you whatever the form submitted and expects
 * you to decide — so the hash lives here, and nothing anywhere in this app
 * ever stores or logs the password itself.
 */
export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  /**
   * The username, and the name shown in the header and on the account page.
   *
   * Optional, because it always was and nobody should lose access to an
   * account for want of one — and because an OAuth provider may not supply
   * it. Unique when present, compared without regard to case: see the index
   * declared at the foot of this table, and src/lib/auth/username.ts for the
   * same rule expressed in TypeScript.
   */
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  /** bcrypt hash. Null for an account created through an OAuth provider. */
  passwordHash: text("password_hash"),
  /**
   * Whether to email this reader a weekly summary of what their saved
   * companies filed.
   *
   * Defaults to false and stays false until somebody asks for it. An account
   * is permission to sign in, not permission to be emailed, and a digest
   * switched on by default is the kind of thing that gets a sending domain
   * blocked as much as it annoys people.
   */
  digestOptIn: boolean("digest_opt_in").notNull().default(false),
  /**
   * When the last digest actually went out.
   *
   * The idempotency key. A cron that is retried, or that runs twice because a
   * platform redelivered the request, must not send the same summary twice —
   * so the sender checks this rather than trusting that it runs once a week.
   */
  digestLastSentAt: timestamp("digest_last_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  /*
    One account per username, compared case-insensitively.

    Partial and functional, which is why it is written as raw SQL rather than
    a plain uniqueIndex on the column: `lower(name)` so "Yashik07" cannot sit
    beside "yashik07", and `WHERE name IS NOT NULL` so the many accounts with
    no username at all do not all collide with each other on NULL.

    This index is the actual guarantee. The signup action checks first so it
    can say something useful, but two people can submit the same username in
    the same instant and both pass that check — only the database can settle
    it, and the action is written to catch the violation it raises.
  */
  uniqueIndex("users_name_lower_idx")
    .on(sql`lower(${t.name})`)
    .where(sql`${t.name} IS NOT NULL`),
]);

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * Password reset tokens.
 *
 * Deliberately separate from `verificationTokens`, which Auth.js uses for its
 * own email flows — sharing that table would mean a reset link and a sign-in
 * link are indistinguishable, so consuming one could silently satisfy the
 * other.
 *
 * Only a hash of the token is stored. The raw token goes in the emailed link
 * and nowhere else, so a leaked database still cannot be used to reset
 * anyone's password.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("password_reset_token_hash_idx").on(t.tokenHash),
    index("password_reset_user_idx").on(t.userId),
  ],
);

/* -------------------------------------------------------------- subscriptions
 *
 * Stripe is the source of truth for whether someone has paid; this table is a
 * local cache of what its webhooks last told us. Entitlement is therefore
 * checked against `status` and `currentPeriodEnd` together — a row saying
 * "active" whose period ended a week ago means a webhook was missed, not that
 * the subscriber is still entitled.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),
    /**
     * Which plan this is: free, pro or pro-plus.
     *
     * Stored rather than derived from `stripePriceId` at read time. The price
     * ids live in environment variables, and deriving would mean that
     * rotating one — a currency change, a new price for new customers —
     * silently demoted every existing subscriber who was still on the old id.
     * The webhook resolves this once, when the plan is bought or changed, and
     * a paying customer's tier then survives any later reshuffling of the
     * catalogue.
     */
    tier: text("tier").notNull().default("pro"),
    /** Stripe's own vocabulary: active, trialing, past_due, canceled, unpaid… */
    status: text("status").notNull().default("incomplete"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_customer_idx").on(t.stripeCustomerId),
    index("subscriptions_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------- journal
 *
 * A subscriber's own trading notes. Nothing here comes from a market data
 * provider, which is what makes it the one paid feature carrying no data
 * licensing exposure at all.
 *
 * `symbol` is free text rather than a foreign key to `companies`: a journal
 * entry may well be about something outside the screening universe, and an
 * entry should never be deleted because its ticker left the index.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** buy | sell | watch | note — what the entry is about. */
    kind: text("kind").notNull().default("note"),
    /** The reader's own conviction, 1-5, for reviewing decisions later. */
    conviction: integer("conviction"),
    entryDate: text("entry_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("journal_user_date_idx").on(t.userId, t.entryDate),
    index("journal_user_symbol_idx").on(t.userId, t.symbol),
  ],
);

/* ------------------------------------------------------------------ trading
 *
 * A trade journal, in the sense the phrase actually means: what was bought and
 * sold, at what price, against which plan.
 *
 * `journal_entries` above stays exactly as it is. It records what somebody was
 * thinking, which is the hard part to reconstruct months later and is worth
 * keeping on its own terms — but it holds no prices, so it can never answer
 * "am I any good at this". These two tables can.
 *
 * Nothing here comes from a market data provider. Every figure is a fill the
 * reader typed in, which is why this whole feature sits clear of the licensing
 * that constrains the rest of the app.
 */

/**
 * A named strategy with its rules written down.
 *
 * The rules are the point. Attributing a trade to a strategy lets you ask
 * whether the strategy works; recording whether you *followed* the rules lets
 * you ask the separate question of whether you executed it — and a strategy
 * that makes money when followed and loses money overall calls for the
 * opposite response to one that simply does not work.
 */
export const playbooks = pgTable(
  "playbooks",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What the setup is, in the reader's own words. */
    description: text("description").notNull().default(""),
    /** The conditions that must hold, one per line. Free text on purpose. */
    rules: text("rules").notNull().default(""),
    /** Retired rather than deleted, so the trades that reference it survive. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playbooks_user_name_idx").on(t.userId, t.name),
    index("playbooks_user_idx").on(t.userId),
  ],
);

/**
 * One position, from entry to exit.
 *
 * Prices are per share and stored as double precision, like every other money
 * column here. P&L, R-multiples and every summary figure are computed from
 * these rather than stored: a derived column would go stale the moment
 * somebody corrected a fill, and a journal whose totals disagree with its own
 * rows is worse than no journal.
 *
 * `exitPrice` and `closedAt` are null together while a position is open, and
 * every realised figure ignores those rows rather than treating them as flat.
 */
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Free text, like the journal's: a trade may be in something unscreened. */
    symbol: text("symbol").notNull(),
    /** long | short. Decides the sign of every result. */
    side: text("side").notNull().default("long"),

    quantity: doublePrecision("quantity").notNull(),
    entryPrice: doublePrecision("entry_price").notNull(),
    exitPrice: doublePrecision("exit_price"),
    /** Where the loss was to be cut. Without it a trade has no defined risk. */
    stopPrice: doublePrecision("stop_price"),
    targetPrice: doublePrecision("target_price"),
    /** Commission and the rest, for the whole round trip. */
    fees: doublePrecision("fees").notNull().default(0),

    openedAt: text("opened_at").notNull(),
    closedAt: text("closed_at"),

    /** Nulled rather than cascaded, so deleting a strategy keeps the history. */
    playbookId: integer("playbook_id").references(() => playbooks.id, {
      onDelete: "set null",
    }),
    /** Whether the reader kept to their own rules. Null when not answered. */
    followedRules: boolean("followed_rules"),
    notes: text("notes").notNull().default(""),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("trades_user_opened_idx").on(t.userId, t.openedAt),
    index("trades_user_symbol_idx").on(t.userId, t.symbol),
    index("trades_user_playbook_idx").on(t.userId, t.playbookId),
  ],
);

/* ----------------------------------------------------------------- watchlist
 *
 * The companies a signed-in reader has saved.
 *
 * This existed only in localStorage before accounts did, and stayed there
 * afterwards — so the app asked people to create an account and then forgot
 * their saved list the moment they picked up their phone. The browser copy is
 * still the signed-out path and is merged up on first sign-in, so nobody
 * loses weeks of saving by finally registering.
 *
 * Deliberately *not* gated behind entitlement. Saving a company is how a
 * newcomer starts using this app at all, and it is the one place a gate would
 * do active harm.
 *
 * `symbol` is free text rather than a foreign key to `companies`, for the same
 * reason journal entries are: somebody may well save something outside the
 * screening universe, and a saved company should not vanish because its ticker
 * left an index.
 */
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    /** Cached at save time so a list renders without a lookup per row. */
    name: text("name"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Saving the same company twice is a no-op, not a second row. Enforced
    // here rather than in the action, so a double-submitted form or a merge
    // running twice cannot produce duplicates.
    uniqueIndex("watchlist_user_symbol_idx").on(t.userId, t.symbol),
    index("watchlist_user_added_idx").on(t.userId, t.addedAt),
  ],
);

/**
 * Who owned this company, from the quarterly Form 13F filings.
 *
 * Every institutional manager holding over $100M in US equities has to file
 * one, listing every position. It is public domain, and it is the only thing
 * in this app that says what large investors were actually doing rather than
 * what a company said about itself.
 *
 * Only the largest holders are stored. A big company has eight or nine
 * thousand 13F filers on its register — Apple had 8,538 for Q1 2026 — and
 * keeping every one of them for every company would be several million rows to
 * render a list of ten. The ingest ranks them and keeps the top handful.
 *
 * `holderCount` and `totalShares` are therefore summary figures that cannot be
 * recovered from the rows kept, and they are repeated identically across each
 * of a company's rows for a quarter. That redundancy is deliberate: the
 * summary and the top holders are written together by one pass and read
 * together by one query, so a separate table would be joined to these rows in
 * lockstep forever to fetch two numbers.
 *
 * Rows are per quarter and never updated, so the read path can compare the two
 * most recent quarters to say whether a holder added or trimmed.
 */
export const institutionalHoldings = pgTable(
  "institutional_holdings",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** The quarter the position was held on, e.g. 2026-03-31. */
    quarter: text("quarter").notNull(),
    /** CIK of the filing manager, which is the stable identity across renames. */
    managerCik: text("manager_cik").notNull(),
    managerName: text("manager_name").notNull(),
    shares: doublePrecision("shares"),
    /** Position value in dollars, as filed. */
    value: doublePrecision("value"),
    /** How many managers reported the company that quarter, across all sizes. */
    holderCount: integer("holder_count"),
    /** Shares held by all of them, not only the ones kept below. */
    totalShares: doublePrecision("total_shares"),
  },
  (t) => [
    // One row per manager per company per quarter. A manager that amends its
    // filing must update the row rather than add a second one, which is what
    // otherwise double-counts Vanguard on every large company.
    uniqueIndex("institutional_company_quarter_manager_idx").on(
      t.companyId,
      t.quarter,
      t.managerCik,
    ),
    index("institutional_company_quarter_idx").on(t.companyId, t.quarter),
  ],
);

/**
 * CUSIP to ticker, so 13F holdings can be found by symbol.
 *
 * 13F identifies securities by CUSIP and this app identifies them by ticker
 * and CIK, and the SEC publishes no direct crosswalk between the two. It does
 * publish the Fails-to-Deliver files, which carry CUSIP, symbol and issuer
 * name together and are public domain — any actively traded security appears
 * in one within a month. That is where these rows come from.
 */
export const cusipSymbols = pgTable(
  "cusip_symbols",
  {
    cusip: text("cusip").primaryKey(),
    symbol: text("symbol").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cusip_symbol_idx").on(t.symbol)],
);

/**
 * A screen somebody built and wants back.
 *
 * The filters are stored as JSON rather than as a column per dimension. The
 * screener's filter set is expected to grow — that is what makes it worth
 * paying for — and a column per filter would mean a migration every time one
 * is added, plus a table full of nulls. The cost of that choice is that this
 * column is not queryable, which is fine: nothing queries across saved
 * screens, they are only ever read back whole for the person who saved them.
 *
 * Validated on the way out rather than trusted, since JSON in Postgres is
 * whatever was put there — including whatever an older version of the app
 * wrote before a filter was renamed.
 */
export const savedScreeners = pgTable(
  "saved_screeners",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filters: jsonb("filters").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Saving over a name replaces that screen rather than making a second one
    // with the same label, which is what a reader means by saving twice.
    uniqueIndex("saved_screeners_user_name_idx").on(t.userId, t.name),
    index("saved_screeners_user_idx").on(t.userId, t.updatedAt),
  ],
);

/**
 * The public newsletter list.
 *
 * Deliberately not the `users` table. A subscriber is an email address and
 * nothing else — no password, no session, and quite possibly no intention of
 * ever registering — so folding them into accounts would mean rows that
 * cannot sign in polluting every query that means "a person with an account",
 * and an unsubscribe becoming indistinguishable from a deletion. Somebody can
 * be on both lists at once, which is the point: the digest is personalised to
 * companies an account holder saved, and this one is not personalised at all.
 *
 * `confirmedAt` null means the address was submitted but never confirmed —
 * double opt-in, so a typo or a malicious submission of somebody else's
 * address never becomes a subscription. Only confirmed rows are ever sent to.
 *
 * `unsubscribedAt` rather than deleting the row: a deleted address can be
 * resubscribed by whoever submitted it the first time, which is exactly the
 * loop an unsubscribe is meant to end.
 */
export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: serial("id").primaryKey(),
  /** Stored lowercased. Normalised by the action, as `users.email` is. */
  email: text("email").notNull().unique(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  /**
   * When a confirmation was last sent, which is the resend cooldown.
   *
   * Without it this form is an email cannon: submit somebody else's address
   * on a loop and they receive one confirmation per submission. With it they
   * receive at most one an hour however hard anybody leans on it.
   */
  confirmSentAt: timestamp("confirm_sent_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type Score = typeof scores.$inferSelect;
export type Financial = typeof financials.$inferSelect;
export type User = typeof users.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type Playbook = typeof playbooks.$inferSelect;
export type TradeRow = typeof trades.$inferSelect;
export type InstitutionalHolding = typeof institutionalHoldings.$inferSelect;
export type CusipSymbol = typeof cusipSymbols.$inferSelect;
export type SavedScreener = typeof savedScreeners.$inferSelect;
export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;
