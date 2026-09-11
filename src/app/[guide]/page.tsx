import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StructuredData } from "@/components/structured-data";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { findGuide, GUIDES, type GuideExample } from "@/lib/guides/content";
import { METRIC_GUIDE, learnHref } from "@/lib/learn/metric-guide";
import { PRESETS, type PresetKey } from "@/lib/screener";
import { breadcrumbLd, faqLd } from "@/lib/structured-data";
import { cn } from "@/lib/utils";

/**
 * The long-form guides, one page each at the site root — /what-is-free-cash-flow
 * rather than /guides/what-is-free-cash-flow, because the question is the
 * address.
 *
 * Only the written guides exist. Any other path under this segment is a 404,
 * so the segment can never become a generator of thin pages.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ guide: guide.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[guide]">): Promise<Metadata> {
  const { guide: slug } = await params;
  const guide = findGuide(slug);
  if (!guide) return {};

  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `/${guide.slug}` },
    openGraph: {
      title: `${guide.title} · WylthIQ`,
      description: guide.description,
      type: "article",
      url: `/${guide.slug}`,
    },
  };
}

export default async function GuidePage({ params }: PageProps<"/[guide]">) {
  const { guide: slug } = await params;
  const guide = findGuide(slug);
  if (!guide) notFound();

  const others = GUIDES.filter((g) => g.slug !== guide.slug);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <StructuredData
        data={[
          breadcrumbLd([
            { name: "WylthIQ", path: "/" },
            { name: "Learn", path: "/learn" },
            { name: guide.title, path: `/${guide.slug}` },
          ]),
          faqLd(guide.faq),
        ]}
      />

      <PageHeader eyebrow="Guide" title={guide.title}>
        <p>{guide.standfirst}</p>
      </PageHeader>

      <article className="space-y-7">
        {guide.sections.map((section, index) => (
          <section key={section.heading} aria-labelledby={`guide-section-${index}`}>
            <h2
              id={`guide-section-${index}`}
              className="font-display text-xl font-semibold tracking-tight"
            >
              {section.heading}
            </h2>
            <div className="mt-2 space-y-3 text-[0.9375rem] leading-relaxed text-muted-strong">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.points && (
                <ul className="list-disc space-y-1.5 pl-5">
                  {section.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ))}

        {guide.presets && <PresetList />}
        {guide.example && <Example example={guide.example} />}
      </article>

      <Card>
        <CardHeader title="Apply it" subtitle="See the idea on real companies" />
        <ul className="divide-y divide-border">
          {guide.apply.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="block px-5 py-3 text-sm font-medium text-accent transition-colors hover:bg-surface-2"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Related explanations"
          subtitle="What each figure is, how it is worked out, and where it misleads"
        />
        <div className="flex flex-wrap gap-2 p-5">
          {guide.related.map((id) => (
            <Link
              key={id}
              href={learnHref(id)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
            >
              {METRIC_GUIDE[id].name}
            </Link>
          ))}
        </div>
      </Card>

      <section aria-labelledby="guide-faq">
        <h2 id="guide-faq" className="font-display text-xl font-semibold tracking-tight">
          Common questions
        </h2>
        <dl className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {guide.faq.map((item) => (
            <div key={item.question} className="px-5 py-4">
              <dt className="text-sm font-semibold">{item.question}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted-strong">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      <nav aria-label="Other guides" className="rounded-xl border border-border bg-surface px-5 py-4">
        <h2 className="text-sm font-semibold">More guides</h2>
        <ul className="mt-2 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-x-6 gap-y-1.5">
          {others.map((other) => (
            <li key={other.slug}>
              <Link href={`/${other.slug}`} className="text-sm text-accent hover:underline">
                {other.title}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/learn" className="text-sm text-accent hover:underline">
              Every term, explained
            </Link>
          </li>
        </ul>
      </nav>

      <p className="text-xs leading-relaxed text-muted">
        Educational information only — not investment advice. Every figure on a WylthIQ company
        page links to the filing it came from.
      </p>
    </div>
  );
}

function Example({ example }: { example: GuideExample }) {
  return (
    <Card>
      <CardHeader title={example.heading} subtitle="Figures invented for illustration" />
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border">
          {example.rows.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className={cn(
                  "px-5 py-2 text-left",
                  row.emphasis ? "font-semibold" : "font-normal text-muted-strong",
                )}
              >
                {row.label}
              </th>
              <td className={cn("tnum px-5 py-2 text-right", row.emphasis && "font-semibold")}>
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-5 py-3 text-sm leading-relaxed text-muted">
        {example.note}
      </p>
    </Card>
  );
}

/** The screener's own presets, read from the screener so the two never disagree. */
function PresetList() {
  return (
    <section aria-labelledby="guide-presets">
      <h2 id="guide-presets" className="font-display text-xl font-semibold tracking-tight">
        The ready-made screens
      </h2>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
        {(Object.keys(PRESETS) as PresetKey[]).map((key) => {
          const preset = PRESETS[key];
          const looksFor: readonly string[] = preset.looksFor;
          return (
            <Card key={key} className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[0.9375rem] font-semibold">{preset.label}</h3>
                <Link
                  href={`/screen?preset=${key}`}
                  className="text-xs text-accent underline underline-offset-2"
                >
                  Run this screen
                </Link>
              </div>
              <p className="mt-1 text-sm text-muted-strong">{preset.description}</p>
              <p className="mt-2 text-xs font-medium text-muted">Looks for</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-strong">
                {looksFor.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs font-medium text-muted">Does not tell you</p>
              <p className="mt-0.5 text-sm text-muted-strong">{preset.doesNotTell}</p>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
