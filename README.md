# WylthIQ

Understand any company's finances without reading a balance sheet.

WylthIQ reads official regulatory filings and answers five questions in plain
English — is it profitable, is it growing, is it drowning in debt, is it cheap, are
there accounting red flags — and links every figure back to the filing it came from.

> **Educational information only — not investment advice.** This tool describes what
> public filings say. It does not know your circumstances and never recommends buying
> or selling anything.

---

## What it does

- **Plain-English verdicts.** Instead of a debt-to-equity ratio: *"For every $1 it owes,
  it owns $1.80 in assets."*
- **Established scoring models.** Piotroski F-Score, Altman Z-Score and Beneish M-Score,
  applied only where they are valid (see [Honest scoring](#honest-scoring)).
- **Price charts** filterable by minute, 5/15 minutes, hour, day and week.
- **A screener** that filters hundreds of companies on financial health, not just price.
- **Market movers and sector performance**, plus peer comparison on any stock chart.
- **Saved companies and recent history**, kept in your browser with no account.
- **Every source linked** — 10-K, 10-Q, 8-K and 40-F filings straight from SEC EDGAR.
- **Grounded AI explanations** — ask fixed questions about the figures on a company
  page. Free for everyone (no sign-in). Answers cite the filings and are withheld if
  they read as advice. Requires `ANTHROPIC_API_KEY` on the server.
- **Trading strategies backtested** on `/backtest` — mean reversion (Bollinger + RSI),
  Connors RSI(2), the 50/200 golden cross, a 200-day trend rule, and an intraday
  opening-range breakout, each shown against simply buying and holding. Textbook
  parameters, left untuned: a rule tuned until it looks good on the decade being
  displayed will always look good on that decade.
- **Connect a broker, read-only.** Readers link their own brokerage account through
  SnapTrade, or upload an IBKR statement — never giving this site a key for it. Holdings
  appear on `/portfolio` and trades in the journal. See [Connecting a broker](#connecting-a-broker).
- **A chart of every trade** in the journal. Each trade's own page draws it on the
  candles it happened on, with an arrow at every buy and sell, and lines for the entry,
  exit, stop and target. The candles are captured when the trade comes in (one-minute
  for a scalp, up to daily for a long hold) and kept, so the chart outlasts the free
  intraday history it was drawn from. Readers can add their own screenshots too, by
  file, drag and drop, or paste; each is re-encoded to WebP and kept private to them.
- **Portfolio charts** on `/portfolio` — an allocation ring that groups holdings by
  company, sector, broker or currency, and a map of every company sized by its value and
  shaded by its gain or loss on cost.
- **Crypto, commodities and futures** at `/markets` — Bitcoin, gold, oil, wheat and the
  index contracts. None of them file accounts, so none of them get a health score; they
  get the chart, the comparison and the backtest, and the page says plainly why the rest
  does not apply.

Coverage is US companies plus Canadian companies cross-listed on US exchanges, plus the
non-company instruments listed in `src/lib/instruments.ts`.

**A note on units.** Eleven of the agricultural and livestock contracts are quoted in US
cents rather than dollars — wheat at "695" is $6.95 a bushel. The provider reports that as
the currency `USX` and it is carried through to the page, because a hundredfold error in a
price is the kind that reads as perfectly plausible. `npm run instruments:verify` re-checks
every symbol still returns real history and that no unit has drifted out of step with what
the provider reports.

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000> and search for a ticker. **No API keys are required** —
SEC EDGAR needs none, so fundamentals, scores and filings work immediately.

To enable the optional extras, copy `.env.example` to `.env.local` and fill in what you
want:

| Feature | Needs | Cost |
| --- | --- | --- |
| Fundamentals, scores, filings | nothing | free |
| Price charts and quotes | `TWELVEDATA_API_KEY` | free |
| Price fallback when rate limited | `TIINGO_API_KEY` | free |
| News, logos, peers | `FINNHUB_API_KEY` | free |
| Screener and rankings | `DATABASE_URL` | free tier |
| Grounded AI explanations | `ANTHROPIC_API_KEY` | free for readers (operator pays model) |
| Non-US fundamentals (on demand) | `ALPHAVANTAGE_API_KEY` or FMP free tier | free |
| Worldwide coverage (full) | `EODHD_API_KEY` | ~$100/mo |

### Enabling the screener

The screener compares hundreds of companies at once, so scores are precomputed and
stored rather than fetched live.

```bash
# 1. Provision Postgres (railway.com -> New -> Database -> PostgreSQL)
#    and put the connection string in .env.local as DATABASE_URL

# 2. Create the tables
npm run db:migrate

# 3. Load companies and compute scores (try a small batch first)
npm run ingest -- --limit 25
npm run ingest

# 4. Load quotes, for movers and the sector heatmap, then price trends
npm run quotes
```

The two jobs are separate on purpose: filings change quarterly, prices change
constantly. Run `ingest` nightly and `quotes` as often as your price plan allows —
Finnhub's free tier permits 60 requests a minute, so the full universe takes about
ten minutes.

After the quotes, the same run works out each company's **price trends** for the
screener's "Price trend" filter: the 50- and 200-day averages and the last time one
crossed the other (golden and death crosses), the price against its 200-day average,
the 52-week high and low, and the 14-day RSI. They come from about 400 days of daily
bars per company, through the same provider chain and Postgres bar cache as the
charts. Alpaca's free plan (`ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`) covers the
US listings at 200 requests a minute; without it they fall to the slower providers.
`npm run technicals` runs the trends alone, and `npm run quotes -- --skip-technicals`
the quotes alone. Run it after the US close so the day's bars have settled.

---

## Honest scoring

The models this tool uses were fitted on particular kinds of companies, and applying
them everywhere produces confident nonsense. WylthIQ would rather show nothing than
show a wrong number:

- **Altman Z and Beneish M are suppressed for banks and insurers.** Their balance sheets
  have no working capital and are leveraged by design, which those models misread as
  distress. The UI says so explicitly instead of leaving a blank.
- **Piotroski signals that cannot be evaluated are skipped, not failed.** A bank that
  cannot report a current ratio is scored out of 6, not penalised out of 9.
- **Altman variants are chosen to match the company.** The original five-factor model for
  manufacturers, the four-factor Z″ for everyone else, and the book-value Z′ when no
  market capitalisation is available.
- **Valuation is excluded from the health score.** An expensive share price says nothing
  about whether the business underneath is sound, so it is scored separately.
- **Missing data stays missing.** Nothing defaults to zero, because a zero silently
  corrupts every ratio built on top of it.

---

## Architecture

Every data source sits behind one `MarketDataProvider` interface
(`src/lib/providers/types.ts`), so the data layer can be swapped without touching pages.

The free stack composes three sources, each doing what it does best at no cost:

| Source | Supplies | Why |
| --- | --- | --- |
| **SEC EDGAR** | fundamentals, filings, SIC codes | Authoritative, no API key, no daily cap |
| **Twelve Data** | OHLCV bars, quotes | Free tier serves the full intraday range; key is an email signup, no brokerage account |
| **Finnhub** | news, logos, peers, quote fallback | Free tier covers these; its `/quote` allows 60/min (candles are paywalled) |
| **Tiingo** | daily/weekly price fallback | Free tier counts usage per hour, not per minute, so it survives a Twelve Data burst |

Free-plan caveats worth knowing for price data: Twelve Data allows 800 credits/day
and 8/minute (a chart view costs one credit), 1-minute history begins 2020-02-10,
and prices carry a short delay — so quotes are labelled delayed rather than live
unless you set `TWELVEDATA_REALTIME=true` on a paid plan.

Setting `EODHD_API_KEY` alone switches the entire app to worldwide coverage — 60+
exchanges, 150,000+ tickers — with no other change. Its payload maps onto the same
canonical model, so the scoring engine cannot tell the two apart.

### XBRL normalization

Turning raw filings into comparable numbers needs several guards, each verified against
live SEC data and covered by tests:

- **Two taxonomies.** US filers report `us-gaap`; foreign private issuers, including
  Canadian 40-F filers such as Royal Bank, report `ifrs-full`. Both map to one schema.
- **Concept migration.** Filers change tags over time — Shopify tagged revenue as
  `RevenueFromContractWithCustomerExcludingAssessedTax` through FY2023 and `Revenues`
  from FY2024 — so concepts resolve per year, not once per company.
- **Derived liabilities.** Many filers never tag total liabilities, so it is computed as
  `assets − equity`. (`LiabilitiesAndStockholdersEquity` is deliberately *not* used: it
  is the balance sheet total, and reading it as debt roughly doubles the figure.)
- **Filing errors.** Royal Bank's FY2020 40-F reports zero shares outstanding, which
  would make every per-share figure `Infinity`.

### Scheduling

The nightly refresh runs on **GitHub Actions** (`.github/workflows/ingest.yml`), which
has no runtime limit and is free for public repos. Point its `DATABASE_URL` secret at
the database's **public** connection string, since Actions runs outside Railway's
network.

`/api/cron/refresh` refreshes the stalest slice on demand and takes an optional
`?limit=`. Trigger it from a Railway cron service if you would rather keep everything
on one platform:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/refresh?limit=200"
```

---

## Deploying

Everything runs on **Railway** — the app and Postgres as two services in one project.

1. **Postgres**: New → Database → PostgreSQL.
2. **App**: New → GitHub Repo → this repository.
3. On the app service's **Variables**, set `DATABASE_URL` to Railway's reference
   syntax so traffic stays on the internal network — free, and no public access
   needed:

   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   ```

4. Add `SEC_USER_AGENT`, `CRON_SECRET`, and whichever price keys you want.
5. For accounts, add `AUTH_SECRET` (`openssl rand -base64 32`) and `AUTH_URL`
   (the app's own public origin). Without `AUTH_SECRET` nobody can sign in;
   the rest of the site still works, since the free pages never read a session.
6. For the paid features, add `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and
   `STRIPE_WEBHOOK_SECRET`, then point a Stripe webhook at
   `https://<your-app>/api/billing/webhook` subscribed to
   `checkout.session.completed` and the three `customer.subscription.*`
   events. Leave all three empty to run the app with nothing paid.
7. Create the tables and load the data, from inside the container:

   ```bash
   railway ssh -s StockFilter -- npm run db:migrate
   railway ssh -s StockFilter -- npm run ingest
   ```

   `db:migrate` is safe to re-run: every statement tolerates "already exists",
   so a schema that is half-applied catches up rather than needing a reset.
   Set it as the service's pre-deploy command (`npm run db:migrate`) and every
   deploy brings the schema up to date before the new code serves a page.

**What needs an account.** A few features that store the reader's own data
(backtesting overlays, trade journal, broker connections, etc.). These are
currently open to anyone signed in — the Stripe billing behind them is fully
wired up but not enforced (`ACCESS_MODE` in `src/lib/billing/access-mode.ts`).
Everything else, including grounded AI explanations, works signed-out.

`/api/health` reports what the running app can actually see — whether the database
is reachable, which tables exist, row counts, and whether the price providers work.
Check it first when something looks empty.

For the scheduled refresh on GitHub Actions, add the same secrets under
**Settings → Secrets → Actions**, using the database's **public** URL there.

---

## Connecting a broker

Readers can connect their own brokerage account. Its holdings then appear on
`/portfolio` next to anything entered by hand, and its buys and sells are paired into
complete trades in `/journal`, refreshed once a day. **Readers never give this site a
key for their broker.** There are three ways in:

| Route | Who | What this app holds |
| --- | --- | --- |
| **SnapTrade** | everyone | SnapTrade's per-reader secret for this app — no broker login, password or key |
| **Statement upload** | everyone | nothing: the file is read and not kept |
| **Flex token** | only addresses in `BROKER_FLEX_TOKEN_EMAILS` | the IBKR Flex token, encrypted |

See the full broker section in previous commits or the source for operational details.
**It cannot trade or move money.** Connections are requested read-only and enforced
in tests (`src/lib/brokers/read-only.test.ts`).

---

## Development

```bash
npm test          # tests, incl. fixtures for us-gaap, ifrs-full and derived fields
npm run typecheck
npm run build
npm run build:fixtures   # refresh test fixtures from live SEC data
npm run instruments:verify   # re-check every crypto/commodity/future still has history
```

Test fixtures cover three real companies chosen to exercise every branch: **AAPL**
(us-gaap, classified balance sheet), **RY** (ifrs-full, unclassified bank balance sheet)
and **SHOP** (us-gaap, untagged liabilities, mid-history concept switch).

---

## International coverage

Coverage beyond the US and Canadian cross-listings is a data problem, not a code
one. Preferred free paths:

| Source | Cost | Covers | Status |
| --- | --- | --- | --- |
| **SEC EDGAR** | free, no key | US + Canadian cross-listed | **In use.** Clean JSON facts API, no quota |
| **Alpha Vantage** | free (25/day) | Worldwide (on demand) | **In use** as on-demand fallback |
| **Financial Modeling Prep** | free (~250/day) | Global standardized fundamentals | Recommended free expansion — map into existing provider interface |
| **Yahoo Finance** | free | Worldwide, prices + fundamentals | **Opt-in.** No official API; terms restrict automated use |
| **EODHD** | ~$100/mo | 60+ exchanges | Implemented, dormant — one env var away |
| **Companies House** (UK) | free key | UK filings (iXBRL) | Preferred official free path — not yet built |
| **EDINET** (Japan) | free key | Japanese filings (XBRL) | Preferred official free path — needs J-GAAP normalizer |
| **SEDAR+** (Canada) | — | Canadian filings | **No API.** The CSA calls one "a longer-term objective" |

**Recommended free expansion order**

1. Keep using Alpha Vantage (and optionally FMP free tier) for occasional non-US lookups.
2. Implement **Companies House** (UK) — free government API, English, good docs; accounts
   arrive as iXBRL (parse like EDGAR).
3. Implement **EDINET** (Japan) — free official API + excellent data once normalized.
4. Only then consider paid worldwide feeds if the free official sources are insufficient.

The product remains fully free for readers, including AI explanations.
