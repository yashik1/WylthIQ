import Link from "next/link";
import { learnHref, METRIC_GUIDE, type MetricGuideId } from "@/lib/learn/metric-guide";

/**
 * The five-part explanation behind a figure, for the inside of an `Explain`.
 *
 * Phrasing content only — spans and a link. `Explain` renders its body as a
 * span inside a `<details>`, and a paragraph or a list there is invalid markup
 * that a browser quietly rearranges, which fails hydration for the whole
 * panel. Block layout comes from `display: block` on spans instead.
 *
 * `note` carries what is specific to this page — which Altman variant was
 * used, say — and `filing` names the exact filing the figure came from, so
 * "where it comes from" is a document a reader can open rather than a
 * description of one.
 */
export function MetricGuideBody({
  id,
  note,
  filing,
}: {
  id: MetricGuideId;
  note?: string | null;
  filing?: string | null;
}) {
  const guide = METRIC_GUIDE[id];

  return (
    <>
      {note && <span className="block">{note}</span>}
      <Part label="What it is">{guide.what}</Part>
      <Part label="How it is calculated">{guide.how}</Part>
      <Part label="Why it matters">{guide.why}</Part>
      <Part label="Limitations">{guide.limits}</Part>
      <Part label="Where it comes from">
        {filing ? `${filing}. ${guide.source}` : guide.source}
      </Part>
      <span className="mt-1.5 block">
        <Link href={learnHref(id)} className="text-accent underline">
          Learn: {guide.name}
        </Link>
      </span>
    </>
  );
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="mt-1.5 block first:mt-0">
      <span className="font-semibold text-muted-strong">{label}. </span>
      {children}
    </span>
  );
}
