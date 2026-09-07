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
};

/**
 * Terms of use and privacy, in one page.
 *
 * Written to be read rather than skimmed past. The most important clause — that
 * this is not investment advice — leads, because burying it under boilerplate
 * would defeat the point of having it.
 */
export default async function TermsPage() {
  const updated = "September 2026";
  const status = providerStatus();
  const universeCount = await getUniverseCount();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="The rules" title="Terms of use & privacy">
        <p>Last updated {updated}</p>
      </PageHeader>

      {/* The clause everything else depends on. */}
      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border bg-poor-soft/40 px-5 py-3">
          <p className="text-sm font-bold text-poor-fg">
            Read this first: this is not investment advice
          </p>
        </div>
        <div className="space-y-3 p-5 text-sm leading-relaxed text-muted-strong">
          <p>
            WylthIQ is an educational tool. It summarises public regulatory filings
            and computes well-known academic scores from them. It does not know your
            circumstances, your goals, your tax position or your risk tolerance, and it
            cannot take them into account.
          </p>
          <p>
            Nothing here is a recommendation to buy, sell or hold any security. No
            content on this site should be treated as financial, investment, legal or
            tax advice. Using it creates no advisory or fiduciary relationship of any
            kind.
          </p>
          <p className="font-medium text-foreground">
            Speak to a licensed financial adviser before making investment decisions.
            You alone are responsible for what you do with this information.
          </p>
        </div>
      </Card>

      <SectionHeading title="Terms of use" eyebrow="Section 1" />
      <Card className="divide-y divide-border">
        <Clause title="What this service is">
          WylthIQ reads company financial statements from public regulatory sources
          and presents them in plain language, alongside scores drawn from published
          academic research. It is provided free, as-is, for personal and educational
          use.
        </Clause>

        <Clause title="Accuracy is not guaranteed">
          Figures come from third-party sources and may be delayed, incomplete,
          mis-tagged at source, or simply wrong. Companies restate results. Data
          providers have outages. Automated mapping between different accounting
          taxonomies can misclassify a figure. Every stock page links to the original
          filing precisely so you can check the numbers yourself, and you should treat
          that filing — not this site — as authoritative.
        </Clause>

        <Clause title="The scores are models, not predictions">
          The Piotroski F-Score, Altman Z-Score and Beneish M-Score are published
          statistical models fitted on historical data, mostly decades ago and mostly on
          US companies. They describe patterns; they do not forecast outcomes. A high
          score is not a promise and a low one is not a verdict. Where a model does not
          validly apply — such as bankruptcy scores for banks — it is suppressed rather
          than shown, but no such gate is perfect.
        </Clause>

        <Clause title="Prices are delayed">
          Share prices shown here are delayed, and the delay varies by source and
          exchange. Each price carries a label saying how fresh it is. Never rely on
          these figures for time-sensitive decisions.
        </Clause>

        <Clause title="No warranty and no liability">
          The service is provided &ldquo;as is&rdquo;, without warranty of any kind,
          express or implied, including fitness for a particular purpose. To the fullest
          extent permitted by law, the operators of this site accept no liability for
          any loss or damage — financial or otherwise — arising from your use of it, or
          from any error, omission, delay or interruption in the data.
        </Clause>

        <Clause title="Acceptable use">
          Do not use this service unlawfully, do not attempt to disrupt it, and do not
          scrape it in bulk or redistribute its data commercially. Several upstream
          providers impose their own restrictions, described below, which pass through
          to you.
        </Clause>

        <Clause title="Changes">
          These terms may change as the service does. Continuing to use it after a
          change means accepting the revised terms. Material changes will be reflected
          in the date at the top of this page.
        </Clause>
      </Card>

      <SectionHeading title="Where the data comes from" eyebrow="Section 2" />
      <Card className="p-5">
        <p className="text-sm leading-relaxed text-muted-strong">
          Each source carries its own terms, which apply to you as well as to this site.
        </p>
        <ul className="mt-4 space-y-3 text-sm">
          <Source
            name="SEC EDGAR"
            role="Company financial statements and filings"
            note="Public domain US government data. No restrictions on use."
            href="https://www.sec.gov/search-filings/edgar-application-programming-interfaces"
          />
          <Source
            name="Twelve Data, Finnhub, Tiingo"
            role="Share prices and quotes"
            note="Used under their free plans, which are for personal, non-commercial use. Redistribution is not permitted."
            href="https://twelvedata.com/terms"
          />
          <Source
            name="Alpha Vantage"
            role="Fundamentals for companies outside SEC coverage"
            note="Used under its free plan. Optional — only active if a key is configured."
            href="https://www.alphavantage.co/terms_of_service/"
          />
          <Source
            name="Yahoo Finance"
            role="International prices and fundamentals"
            note="Optional and disabled by default. Yahoo publishes no official API and restricts automated access and redistribution; if the operator of this deployment has enabled it, that data is for personal use only."
            href="https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html"
          />
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          Coverage is US-listed companies plus Canadian ones that also list in the US.
          Companies listed only on other exchanges may show limited data or none —{" "}
          <Link href="/learn" className="text-accent hover:underline">
            more about that here
          </Link>
          .
        </p>

        {/*
          What this particular deployment has switched on.

          This used to sit on the dashboard as a four-row status table, which
          put an operator's configuration checklist in front of every visitor
          on the first screen they saw. It belongs with the licence terms it
          describes — and here it is one line rather than a table, because
          "which providers are live" is a footnote to a reader and a headline
          only to whoever runs the deployment.
        */}
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-faint">
          On this deployment: {status.coverage.toLowerCase()} coverage
          {universeCount != null && `, ${num(universeCount, 0)} companies scored`}
          {". "}
          Price charts are {status.charts ? "active" : "not configured"} and news is{" "}
          {status.news ? "active" : "not configured"}
          {status.missing.length > 0 && `, with no key set for ${status.missing.join(", ")}`}.
        </p>
      </Card>

      <SectionHeading title="Privacy" eyebrow="Section 3" />
      <Card className="divide-y divide-border">
        <Clause title="You can use this without an account">
          Company pages, the screener, comparisons, charts and market data all work
          signed out, and nothing identifying you is collected to use them. An account
          is optional and unlocks the backtester, the trade journal and a saved list
          that follows you between devices.
        </Clause>

        <Clause title="What an account stores">
          Your email address, a bcrypt hash of your password — never the password
          itself — and a username if you choose one. Alongside it: the companies you
          save, anything you write in the trade journal, screens you save, and whether
          you asked for the weekly summary email. All of it is held in this
          service&apos;s own database and is readable only by your own account.
        </Clause>

        <Clause title="What stays in your browser">
          Signed out, your saved companies and recently viewed list live in your
          browser&apos;s local storage and are never transmitted anywhere. Your light or
          dark theme preference stays there whether or not you have an account.
          Clearing your browser data deletes those permanently, and nobody — including
          the operator of this site — can recover them. Signing in merges a
          browser-held list into your account, once.
        </Clause>

        <Clause title="Email">
          Your address is used to send what you asked for and nothing else: a password
          reset when you request one, and the weekly summary if you switch it on. The
          newsletter is separate and needs a confirmation click before anything is
          sent, so an address submitted by somebody else never becomes a subscription.
          Every email carries a one-click unsubscribe. There is no marketing list
          beyond the newsletter, and addresses are never sold or shared.
        </Clause>

        <Clause title="Deleting your data">
          Turning off the weekly summary or unsubscribing from the newsletter stops
          those immediately. Removing a saved company or a journal entry deletes it.
          For deleting an account and everything attached to it, email the address in
          the security policy and it will be done by hand — an in-app button for this
          is not built yet, and saying otherwise would be inaccurate.
        </Clause>

        <Clause title="No tracking or advertising">
          There are no advertising trackers, no analytics profiling you across sites, and
          no data is sold or shared with advertisers.
        </Clause>

        <Clause title="Requests to third parties">
          Loading a page causes this service to request data from the providers listed
          above. Those requests are made by the server, not your browser, so those
          providers do not receive your IP address or device details. Standard server
          logs may record requests for security and debugging; they do not record
          passwords, session cookies or authorisation headers.
        </Clause>

        <Clause title="Who else holds your data">
          Three companies process it on this service&apos;s behalf. Railway hosts the
          application and its Postgres database, so anything stored on your account
          sits there. Resend delivers email, and therefore handles the address any
          message is sent to. Stripe would handle payment if subscriptions are ever
          switched on — card details go directly to Stripe and never reach this
          service. Nothing is sold or shared with anybody else.
        </Clause>

        <Clause title="No tracking, and no cookie banner">
          The only cookie this service sets is the one that keeps you signed in, and it
          exists solely for that. There is no analytics cookie, no advertising
          identifier and nothing following you between sites, which is why you are not
          asked to consent to any.
        </Clause>
      </Card>

      <Card className="mt-6 p-5">
        <p className="text-sm leading-relaxed text-muted">
          <strong className="text-foreground">A note on these terms.</strong> They were
          drafted to describe how this service actually behaves, and they have not been
          reviewed by a lawyer. If you deploy WylthIQ publicly, charge for it, or
          operate it somewhere with specific financial-promotion rules, have them
          reviewed before relying on them.
        </p>
      </Card>

      <p className="mt-8 text-sm text-muted">
        Questions about the data or the models?{" "}
        <Link href="/learn" className="text-accent hover:underline">
          The Learn page
        </Link>{" "}
        explains every figure and score in plain language.
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

function Source({
  name,
  role,
  note,
  href,
}: {
  name: string;
  role: string;
  note: string;
  href: string;
}) {
  return (
    <li className="border-l-2 border-border pl-3">
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="font-semibold hover:text-accent"
      >
        {name}
      </a>
      <span className="ml-2 text-xs text-muted">{role}</span>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{note}</p>
    </li>
  );
}
