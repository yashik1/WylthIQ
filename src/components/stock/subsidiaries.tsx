import { Card, CardHeader } from "@/components/ui";
import { count } from "@/lib/format";
import type { SubsidiaryReport } from "@/lib/company/subsidiaries";

/** Beyond this the list is a directory rather than an answer. */
const SHOWN = 40;

/**
 * The companies a company owns, from Exhibit 21 of its annual report.
 *
 * The heading says "names in its annual report" rather than "owns", and the
 * distinction is the whole honesty of the panel. Item 601(b)(21) requires a
 * filer to list its *significant* subsidiaries and expressly permits leaving
 * out the rest, so this is a floor rather than a census: Apple names nineteen
 * entities and footnotes that others are omitted.
 *
 * It is also not a list of acquisitions, which is what most readers arrive
 * wanting. Some acquisitions do appear — Converse under Nike, BA Sports
 * Nutrition under Coca-Cola — because the business became a named legal
 * entity large enough to disclose. Many do not, because a brand is not an
 * entity and the entity is below the threshold. Saying which of the two this
 * is costs one sentence and prevents a reader concluding a company never
 * bought anything.
 */
export function Subsidiaries({ report }: { report: SubsidiaryReport }) {
  const { subsidiaries } = report;
  const shown = subsidiaries.slice(0, SHOWN);
  const rest = subsidiaries.length - shown.length;

  // Worth saying only when there are enough to be a spread rather than a list.
  const jurisdictions = new Set(
    subsidiaries.map((s) => s.jurisdiction).filter((j): j is string => Boolean(j)),
  );

  return (
    <Card>
      <CardHeader
        title="The companies it owns"
        subtitle={
          <>
            The {count(subsidiaries.length)} subsidiaries named in its {report.form}
            {jurisdictions.size > 2 && <>, incorporated across {jurisdictions.size} places</>}.
            A filer lists the significant ones and may leave the rest out, so this is the
            floor rather than the full count.
          </>
        }
      />

      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border @2xl:grid-cols-2 @2xl:divide-y-0">
        {shown.map((s, i) => (
          <li
            key={`${s.name}-${i}`}
            className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-sm @2xl:border-b @2xl:border-border"
          >
            <span className="min-w-0 text-muted-strong">{s.name}</span>
            {s.jurisdiction && (
              <span className="shrink-0 text-xs text-faint">{s.jurisdiction}</span>
            )}
          </li>
        ))}
      </ul>

      {rest > 0 && (
        <p className="border-t border-border px-5 py-3 text-xs text-faint">
          The first {shown.length} of {count(subsidiaries.length)}. The rest are in the
          exhibit.
        </p>
      )}

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
        Source:{" "}
        <a
          href={report.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          Exhibit 21
        </a>{" "}
        of the {report.form} filed {report.filedAt}. These are legal entities, not brands
        or acquisitions — a company that bought a business may hold it inside an entity
        named here, or inside one small enough that the rule does not require naming it at
        all.
      </p>
    </Card>
  );
}
