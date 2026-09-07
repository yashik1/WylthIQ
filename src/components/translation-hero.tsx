import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SearchBox } from "@/components/search-box";
import { CornerBrackets } from "@/components/ui";
import { SLOGAN } from "@/lib/brand";

/**
 * The hero shows the product doing its job rather than describing it.
 *
 * On the left, what a filing actually looks like: XBRL concept names and raw
 * figures, which is genuinely what arrives from SEC EDGAR. On the right, the
 * sentence this app writes from exactly those three numbers. The claim is
 * "we translate this into that", so showing both halves argues it better than
 * any list of features.
 *
 * The figures are Apple's real FY2025 balance sheet, and the sentence is the
 * one the live scoring engine produces — not a mockup.
 */

export function TranslationHero() {
  return (
    <section className="full-bleed flush-top relative overflow-hidden border-b border-border pt-[52px] pb-11">
      {/* A soft wash of the two brand hues behind the fold — the one place
          in the app that reaches for a gradient, so it stays a signature
          rather than becoming wallpaper. Purely decorative. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-24 size-[420px] rounded-full bg-accent/20 blur-[110px]" />
        <div className="absolute -top-24 right-0 size-[360px] rounded-full bg-accent-2/15 blur-[110px]" />
      </div>

      {/* The band bleeds; its contents do not. This wrapper repeats the
          column the header and main both use, so the eyebrow below still
          starts on the same vertical line as the logo above it. */}
      <div className="mx-auto grid w-full max-w-[var(--content-max)] grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-12 px-4 sm:px-7">
      <div>
        {/* The slogan leads, because it is the one line that says what this
            is for rather than what it does. The headline under it does the
            explaining. */}
        <p className="eyebrow">{SLOGAN}</p>

        <h1 className="font-display mt-3.5 max-w-[15ch] text-[3.25rem] leading-[1.02] [text-wrap:pretty]">
          Annual reports are written to be filed, not read.
        </h1>

        <p className="mt-4 max-w-[44ch] text-[1.03125rem] leading-relaxed text-muted">
          WylthIQ reads them for you and answers the five questions that
          actually matter — in sentences, with a link to every source.
        </p>

        <div className="mt-6 max-w-[520px]">
          <SearchBox variant="hero" submitLabel="Analyse" />
        </div>

        <p className="mt-3.5 text-[0.8125rem] text-faint">
          Try{" "}
          <Link href="/stock/AAPL" className="text-accent hover:underline">AAPL</Link> ·{" "}
          <Link href="/stock/RY" className="text-accent hover:underline">RY</Link> ·{" "}
          <Link href="/stock/SHOP" className="text-accent hover:underline">SHOP</Link>{" "}
          — no account, no API key.
        </p>
      </div>

      {/*
        The demonstration. `minmax(0, 1fr)` on both figures rather than a bare
        `1fr`: the XBRL concept names are unbreakable strings, and a bare `1fr`
        is `minmax(auto, 1fr)`, which takes its floor from them — which is how
        these two panels ended up 269px against 114px instead of matching.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_34px_minmax(0,1fr)] items-stretch">
        <figure className="relative m-0 border border-border px-[18px] pt-[18px] pb-4">
          <figcaption className="eyebrow mb-3.5">What the filing says</figcaption>

          <dl className="m-0 grid [overflow-wrap:anywhere]">
            {[
              ["us-gaap:Assets", "359,240,000,000"],
              ["us-gaap:Liabilities", "285,510,000,000"],
              ["us-gaap:StockholdersEquity", "73,730,000,000"],
            ].map(([tag, value], i, all) => (
              <div
                key={tag}
                className={`flex justify-between gap-3 py-[7px] text-[0.78125rem] ${
                  i < all.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <dt className="text-muted">{tag}</dt>
                <dd className="tnum m-0 text-foreground">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-[0.71875rem] text-faint">
            Apple&apos;s FY2025 balance sheet, exactly as tagged.
          </p>
          <CornerBrackets />
        </figure>

        <div aria-hidden className="flex items-center justify-center text-accent">
          <ArrowRight className="size-[18px]" strokeWidth={1.5} />
        </div>

        <figure className="relative m-0 border border-border bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] p-[18px]">
          <figcaption className="eyebrow mb-3.5 text-accent">What it means</figcaption>

          <p className="font-display text-[1.625rem] leading-[1.14]">
            For every $1 Apple owes, it owns{" "}
            <span className="tnum text-accent">$1.26</span> in assets.
          </p>

          <p className="mt-3 text-[0.84375rem] leading-relaxed text-muted">
            After paying off everything it owes,{" "}
            <span className="tnum">$73.73B</span> would be left for
            shareholders — about a fifth of everything it owns.
          </p>

          <Link
            href="/stock/AAPL"
            className="font-display mt-3.5 inline-flex items-center gap-1.5 text-[0.84375rem] font-semibold text-accent hover:underline"
          >
            See the full analysis
            <ArrowRight aria-hidden className="size-3.5" strokeWidth={1.5} />
          </Link>
          <CornerBrackets />
        </figure>
      </div>
      </div>
    </section>
  );
}
