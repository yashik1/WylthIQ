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
- **Trading strategies backtested** on `/backtest` — mean reversion (Bollinger + RSI),
  Connors RSI(2), the 50/200 golden cross, a 200-day trend rule, and an intraday
  opening-range breakout, each shown against simply buying and holding. Textbook
  parameters, left untuned: a rule tuned until it looks good on the decade being
  displayed will always look good on that decade.
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
| Worldwide coverage | `EODHD_API_KEY` | ~$100/mo |

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

# 4. Load quotes, for movers and the sector heatmap
npm run quotes
```

The two jobs are separate on purpose: filings change quarterly, prices change
constantly. Run `ingest` nightly and `quotes` as often as your price plan allows —
Finnhub's free tier permits 60 requests a minute, so the full universe takes about
ten minutes.

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

**What needs an account.** Four things: the screener backtest, the trade journal, the
trading strategies, and the moving-average overlays on a backtest chart. These are
currently open to anyone signed in — the Stripe billing behind them is fully wired up
but not enforced, and switching it on is `ACCESS_MODE` in
`src/lib/billing/access-mode.ts` and nothing else. Everything else works signed-out — the screener, health reports, comparison and stock pages,
crypto and commodities, and the single-instrument "what if I had invested" including
its one/three/five/ten-year holding-period table.

The first two are gated at the page *and* at the API route or server action behind
it, since a paywall that only covers the rendered page is answered in JSON to
anyone who opens the network tab. The overlays are a UI gate only, and
deliberately: an SMA is the mean of numbers the free chart already shows, so
withholding it server-side would stop nobody while forcing a round trip on every
period change for the people paying for it.

`/api/health` reports what the running app can actually see — whether the database
is reachable, which tables exist, row counts, and whether the price providers work.
Check it first when something looks empty.

For the scheduled refresh on GitHub Actions, add the same secrets under
**Settings → Secrets → Actions**, using the database's **public** URL there.

---

## Development

```bash
npm test          # 49 tests, incl. fixtures for us-gaap, ifrs-full and derived fields
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
one. What exists, and why each was or was not adopted:

| Source | Cost | Covers | Status |
| --- | --- | --- | --- |
| **SEC EDGAR** | free, no key | US + Canadian cross-listed | **In use.** Clean JSON facts API, no quota |
| **Yahoo Finance** | free | Worldwide, prices + fundamentals | **Opt-in.** No official API; terms restrict automated use |
| **Alpha Vantage** | free (25/day) | Worldwide | **In use** as on-demand fallback |
| **EODHD** | ~$100/mo | 60+ exchanges | Implemented, dormant — one env var away |
| **SEDAR+** (Canada) | — | Canadian filings | **No API.** The CSA calls one "a longer-term objective" |
| **EDINET** (Japan) | free key | Japanese filings | Viable, not built — needs a J-GAAP normalizer |
| **Companies House** (UK) | free key | UK filings | Viable, not built — iXBRL documents, not a facts API |

The two national regulators are genuinely free and officially open, and are the
natural way to extend coverage without paying. Neither offers anything like
SEC's `companyfacts` endpoint, so each needs its own taxonomy mapping — which is
why Yahoo covers more ground for far less work today.

## Data sources

Fundamentals and filings from [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).
Prices from [Twelve Data](https://twelvedata.com). News from [Finnhub](https://finnhub.io).
Optional worldwide data from [EODHD](https://eodhd.com).

SEC EDGAR requires a `User-Agent` header identifying you with a contact address — set
`SEC_USER_AGENT` before deploying.
