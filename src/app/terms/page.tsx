import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader, SectionHeading } from "@/components/ui";
import { providerStatus } from "@/lib/providers";
import { getUniverseCount } from "@/lib/screener";
import { num } from "@/lib/format";

export const metadata: Metadata = {
  title: "Terms of use and privacy",
  description:
    "What WylthIQ is, what it is not, where its data comes from, and what it stores about you.",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const updated = "September 2026";
  const status = providerStatus();
  const universeCount = await getUniverseCount();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="The rules" title="Terms of use & privacy">
        <p>Last updated {updated}</p>
      </PageHeader>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border bg-poor-soft/40 px-5 py-3">
          <p className="text-sm font-bold text-poor-fg">Read this first: this is not investment advice</p>
        </div>
        <div className="space-y-3 p-5 text-sm leading-relaxed text-muted-strong">
          <p>
            WylthIQ is an educational tool. It summarises public regulatory filings,
            market data and other third-party sources and computes financial scores from
            them. It does not know your circumstances, goals, tax position or risk
            tolerance, and cannot take them into account.
          </p>
          <p>
            Nothing here is a recommendation to buy, sell or hold any security. No
            content on this site should be treated as financial, investment, legal or
            tax advice. Using it creates no advisory or fiduciary relationship.
          </p>
          <p className="font-medium text-foreground">
            You alone are responsible for decisions made using the information shown here.
            Speak to a licensed financial adviser before making investment decisions.
          </p>
        </div>
      </Card>

      <SectionHeading title="Terms of use" eyebrow="Section 1" />
      <Card className="divide-y divide-border">
        <Clause title="What this service is">
          WylthIQ reads company financial statements from public regulatory sources and
          presents them in plain language, alongside scores drawn from published research.
          It also provides screening, comparison, portfolio, watchlist, journal, thesis,
          backtesting and educational tools. It is provided as-is for personal and
          educational use.
        </Clause>

        <Clause title="Accuracy is not guaranteed">
          Figures come from third-party sources and may be delayed, incomplete, mis-tagged
          at source, stale, or wrong. Companies restate results and providers have outages.
          Automated accounting mappings can also misclassify a figure. Stock pages expose
          source information so you can check important numbers against the original filing.
        </Clause>

        <Clause title="The scores are models, not predictions">
          The Piotroski F-Score, Altman Z-Score and Beneish M-Score are statistical models
          based on historical research. They describe patterns; they do not forecast
          outcomes. A high score is not a promise and a low one is not a verdict. Where a
          model does not validly apply, it is suppressed rather than presented as meaningful.
        </Clause>

        <Clause title="Prices and market data are not guaranteed real-time">
          Prices may be real-time, delayed, end-of-day or stale depending on the source and
          exchange. Each supported price view should identify its known freshness. A missing
          or stale-data notice means the displayed figure should not be treated as current.
          Never rely on WylthIQ for time-sensitive trading decisions.
        </Clause>

        <Clause title="AI-generated explanations">
          Some accounts may be offered grounded AI explanations. These explanations are
          generated from information available to WylthIQ and are provided for education and
          research only. AI output can be incomplete, inaccurate or misleading even when it
          includes source context. It is not financial advice and should not replace the
          underlying filing, source data or your own judgment. Do not enter passwords,
          payment-card details or other unnecessary sensitive information into AI prompts.
        </Clause>

        <Clause title="Backtests are hypothetical">
          Historical backtests are simulations, not records of actual investment returns.
          Results can depend on the selected universe, available historical data, corporate
          actions and implementation assumptions. Unless a backtest explicitly states
          otherwise, do not assume that it models taxes, commissions, bid/ask spreads,
          slippage or survivorship bias. Past simulated performance does not predict future
          results.
        </Clause>

        <Clause title="No warranty and no liability">
          The service is provided “as is”, without warranty of any kind, express or implied,
          including fitness for a particular purpose. To the fullest extent permitted by law,
          the operators of this site accept no liability for loss or damage arising from use
          of the service or from an error, omission, delay or interruption in data.
        </Clause>

        <Clause title="Acceptable use">
          Do not use this service unlawfully, attempt to disrupt it, scrape it in bulk, or
          redistribute upstream data commercially. Several providers impose their own
          restrictions, described below, which pass through to users of the service.
        </Clause>

        <Clause title="Changes">
          These terms may change as the service does. Continuing to use it after a change
          means accepting the revised terms. Material changes will be reflected in the date
          at the top of this page.
        </Clause>
      </Card>

      <SectionHeading title="Where the data comes from" eyebrow="Section 2" />
      <Card className="p-5">
        <p className="text-sm leading-relaxed text-muted-strong">
          Each source carries its own terms, which apply to you as well as to this site.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          <Source name="SEC EDGAR" role="Company financial statements and filings" note="Public domain US government data. No restrictions on use." href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces" />
          <Source name="Twelve Data, Finnhub, Tiingo" role="Share prices and quotes" note="Used under their applicable plans. Provider terms govern access, permitted use and redistribution." href="https://twelvedata.com/terms" />
          <Source name="Alpha Vantage" role="Fundamentals for companies outside SEC coverage" note="Optional — only active if a key is configured. Provider terms govern use." href="https://www.alphavantage.co/terms_of_service/" />
          <Source name="Yahoo Finance" role="International prices and fundamentals" note="Optional and disabled by default. Yahoo publishes terms governing automated access and use; enabled deployments must comply with those terms." href="https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html" />
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Coverage is primarily US-listed companies plus Canadian ones that also list in the
          US. Companies listed only on other exchanges may show limited data or none —{" "}
          <Link href="/learn" className="text-accent hover:underline">more about that here</Link>.
        </p>
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-faint">
          On this deployment: {status.coverage.toLowerCase()} coverage
          {universeCount != null && `, ${num(universeCount, 0)} companies scored`}. Price charts are{" "}
          {status.charts ? "active" : "not configured"} and news is {status.news ? "active" : "not configured"}
          {status.missing.length > 0 && `, with no key set for ${status.missing.join(", ")}`}.
        </p>
      </Card>

      <SectionHeading title="Privacy" eyebrow="Section 3" />
      <Card className="divide-y divide-border">
        <Clause title="You can use this without an account">
          Company pages, the screener, comparisons, charts, market views and educational
          content work signed out. An account is optional and enables account-scoped features
          such as saved companies, saved screens, the trade journal, thesis tracking,
          portfolio data and research history.
        </Clause>

        <Clause title="What an account stores">
          Your email address, a bcrypt hash of your password — never the password itself —
          and a username if you choose one. Depending on which features you use, the service
          can also store saved companies and screens, journal entries, investment theses,
          portfolio and holding information, research activity and notification preferences.
          This account data is scoped to your account and is not sold to advertisers.
        </Clause>

        <Clause title="Portfolio, thesis and journal data">
          Information you enter into your portfolio, investment thesis or journal is user
          content. WylthIQ stores it so those features can work across sessions and devices.
          Treat it as research information, not as a regulated custody or brokerage record.
          WylthIQ does not execute trades or hold securities on your behalf.
        </Clause>

        <Clause title="What stays in your browser">
          Signed out, some saved companies and recently viewed items may live in browser
          local storage and are not transmitted as account data. Clearing browser data can
          permanently remove those local items. Signing in can merge supported local saves
          into your account.
        </Clause>

        <Clause title="Email and notifications">
          Your address is used for requested account and service messages, such as password
          resets and enabled summaries or alerts. Marketing/newsletter messages require the
          applicable subscription or confirmation flow. Notification preferences can be
          changed where the relevant feature provides that control.
        </Clause>

        <Clause title="AI prompts and source material">
          If you use an AI explanation feature, the service may send the question and the
          relevant grounded research context to the configured AI provider to generate the
          answer. Do not submit unnecessary personal or confidential information. AI output
          should be treated as generated research assistance, not authoritative source data.
        </Clause>

        <Clause title="Deleting your data">
          Removing a saved company, screen or journal item deletes that item where the feature
          supports deletion. Account deletion and any associated data are subject to the
          deletion controls provided by the service; if a self-service control is unavailable,
          use the support/security contact specified by the deployment. Backup copies may
          persist for a limited operational period where required for recovery or security.
        </Clause>

        <Clause title="No tracking or advertising">
          There are no advertising trackers, no analytics profiling you across sites, and no
          user data is sold to advertisers.
        </Clause>

        <Clause title="Requests to third parties">
          Loading research data causes this service to request information from upstream
          providers. Those requests are made by the server where supported. Standard server
          logs may record requests for security and debugging; they should not contain
          passwords, session cookies or authorization headers.
        </Clause>

        <Clause title="Who else may process your data">
          Railway may host the application and Postgres database. Resend may deliver email.
          If AI explanations are enabled, the configured AI provider may process the prompt
          and supplied research context. Stripe may process payments if subscriptions are
          enabled. Each provider's applicable terms and privacy policy govern its processing.
        </Clause>
      </Card>

      <Card className="mt-6 p-5">
        <p className="text-sm leading-relaxed text-muted">
          <strong className="text-foreground">A note on these terms.</strong> They describe
          the intended behaviour of this service and have not been reviewed by a lawyer. If
          you deploy WylthIQ publicly, charge for it, or operate it somewhere with specific
          financial-promotion or privacy rules, have them reviewed before relying on them.
        </p>
      </Card>

      <p className="mt-8 text-sm text-muted">
        Questions about the data or models?{" "}
        <Link href="/learn" className="text-accent hover:underline">The Learn page</Link> explains
        the figures and scores in plain language.
      </p>
    </div>
  );
}

function Clause({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-strong">{children}</p>
    </section>
  );
}

function Source({ name, role, note, href }: { name: string; role: string; note: string; href: string }) {
  return (
    <li className="border-l-2 border-border pl-3">
      <a href={href} target="_blank" rel="noreferrer noopener" className="font-semibold hover:text-accent">{name}</a>
      <span className="ml-2 text-xs text-muted">{role}</span>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{note}</p>
    </li>
  );
}
