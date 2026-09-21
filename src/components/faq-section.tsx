import { StructuredData } from "@/components/structured-data";
import { faqLd } from "@/lib/structured-data";

/**
 * Questions as headings, each answered immediately underneath.
 *
 * An audit of the live site on 2026-09-21 found pages with no question-shaped
 * headings at all, and one with a question heading whose answer only arrived
 * after a paragraph of preamble. Both matter for the same reason: an answer
 * engine lifts the text directly under a heading, so a heading that asks
 * something and then clears its throat gets quoted clearing its throat.
 *
 * The rules this enforces by its shape:
 *   - the question is an `<h2>`, which is the level a crawler reads as a
 *     section of the page rather than a label inside one;
 *   - the answer is the first thing under it, self-contained, no preamble;
 *   - the same words go into FAQPage markup, because a crawler and a reader
 *     getting different text is where structured data becomes cloaking.
 *
 * Answers are written at 15–70 words. Shorter says nothing; longer stops
 * being liftable and starts being a paragraph somebody has to read.
 */
export interface FaqEntry {
  question: string;
  answer: string;
}

export function FaqSection({
  id,
  heading,
  entries,
}: {
  id: string;
  /** Introduces the group without itself being a question. */
  heading: string;
  entries: FaqEntry[];
}) {
  if (entries.length === 0) return null;

  return (
    <section aria-labelledby={id}>
      <StructuredData data={faqLd(entries)} />

      <p id={id} className="eyebrow mb-4">
        {heading}
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-x-8 gap-y-6">
        {entries.map((entry) => (
          <div key={entry.question}>
            <h2 className="font-display text-[1.0625rem] leading-snug">{entry.question}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{entry.answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
