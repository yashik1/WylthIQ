import Link from "next/link";
import { Badge, Card, CardHeader } from "@/components/ui";
import { calendarDate } from "@/lib/format";
import type { SavedThesis } from "@/lib/thesis/actions";
import { THESIS_STATUSES, TIME_HORIZONS, type ThesisStatus } from "@/lib/thesis/metrics";
import {
  CONDITION_STATUS_LABEL,
  type ConditionStatus,
  type ThesisReality,
} from "@/lib/thesis/reality";
import { cn } from "@/lib/utils";
import { ThesisEditor, type ThesisDraft } from "./thesis-editor";

const STATUS_TONE: Record<ThesisStatus, "neutral" | "accent" | "good" | "fair" | "poor"> = {
  active: "accent",
  "under-review": "neutral",
  intact: "good",
  "at-risk": "fair",
  invalidated: "poor",
};

/** A glyph and a word for every outcome, so none rests on colour alone. */
const OUTCOME: Record<ConditionStatus, { glyph: string; className: string }> = {
  "on-track": { glyph: "✓", className: "text-good-fg" },
  above: { glyph: "↑", className: "text-good-fg" },
  below: { glyph: "✗", className: "text-poor" },
  "no-data": { glyph: "–", className: "text-faint" },
};

function toDraft(thesis: SavedThesis): ThesisDraft {
  return {
    thesis: thesis.thesis,
    mustGoRight: thesis.mustGoRight,
    couldBreak: thesis.couldBreak,
    horizon: thesis.horizon ?? "",
    status: thesis.status,
    conditions: thesis.conditions.map((c) => ({
      metric: c.metric,
      operator: c.operator,
      target: c.target == null ? "" : String(c.target),
    })),
  };
}

/**
 * The reader's own thesis for this company, and how the figures measure up.
 */
export function ThesisPanel({
  symbol,
  companyName,
  signedIn,
  thesis,
  reality,
}: {
  symbol: string;
  companyName: string;
  signedIn: boolean;
  thesis: SavedThesis | null;
  reality: ThesisReality | null;
}) {
  if (!signedIn) {
    return (
      <Card className="p-5">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight">Your thesis</h2>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
          Write down why you are following {companyName}, what has to go right and what would
          change your mind, then see each new annual report measured against it.{" "}
          <Link
            href={`/signin?next=${encodeURIComponent(`/stock/${symbol}`)}`}
            className="text-accent underline underline-offset-2"
          >
            Sign in to start one
          </Link>
          .
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Your thesis"
        subtitle={
          thesis
            ? `Written ${calendarDate(thesis.createdAt.toISOString())}${
                thesis.updatedAt.getTime() - thesis.createdAt.getTime() > 60_000
                  ? `, last edited ${calendarDate(thesis.updatedAt.toISOString())}`
                  : ""
              }. Only you can see this.`
            : "Only you can see this."
        }
        action={thesis && <Badge tone={STATUS_TONE[thesis.status]}>{THESIS_STATUSES[thesis.status]}</Badge>}
      />

      {thesis && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 px-5 py-4 md:grid-cols-3">
          <Written label="My thesis" text={thesis.thesis} />
          <Written label="What must go right" text={thesis.mustGoRight} />
          <Written label="What could break it" text={thesis.couldBreak} />
          {thesis.horizon && (
            <p className="text-xs text-muted md:col-span-3">
              Time horizon: {TIME_HORIZONS[thesis.horizon]}
            </p>
          )}
        </div>
      )}

      {thesis && reality && reality.results.length > 0 && <RealityTable reality={reality} />}

      <div className="border-t border-border px-5 py-4">
        <ThesisEditor symbol={symbol} companyName={companyName} initial={thesis ? toDraft(thesis) : null} />
      </div>
    </Card>
  );
}

function Written({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted">{label}</h3>
      <p className={cn("mt-1 whitespace-pre-wrap text-sm leading-relaxed", !text && "text-faint")}>
        {text || "Not written"}
      </p>
    </div>
  );
}

function RealityTable({ reality }: { reality: ThesisReality }) {
  const { baseline, latest } = reality;

  return (
    <section aria-labelledby="thesis-reality-heading" className="border-t border-border">
      <div className="px-5 pt-4">
        <h3 id="thesis-reality-heading" className="text-sm font-semibold">Thesis vs reality</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          {baseline
            ? `"Then" is FY${baseline.fiscalYear}, the annual report on file when you wrote this, as it was first filed.`
            : "Nothing had been filed yet when you wrote this, so there is no starting point."}{" "}
          {latest &&
            `"Now" is FY${latest.fiscalYear}${latest.newSinceThesis ? ", filed since you wrote it" : ""}.`}{" "}
          The status above stays as you set it.
        </p>
      </div>
      <div className="scroll-x">
        <table className="mt-2 w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-y border-border bg-surface-2/50 text-left text-xs text-muted">
              <th scope="col" className="px-5 py-2 font-medium">Condition</th>
              <th scope="col" className="px-3 py-2 font-medium">Target</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Then</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Now</th>
              <th scope="col" className="px-5 py-2 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reality.results.map((result, index) => (
              <tr key={index}>
                <th scope="row" className="px-5 py-2.5 text-left font-medium">{result.label}</th>
                <td className="px-3 py-2.5 text-muted-strong">{result.target}</td>
                <td className="tnum px-3 py-2.5 text-right text-muted">
                  {result.then ? result.then.text : "—"}
                </td>
                <td className="tnum px-3 py-2.5 text-right">{result.now ? result.now.text : "—"}</td>
                <td className={cn("px-5 py-2.5 font-medium", OUTCOME[result.status].className)}>
                  <span aria-hidden>{OUTCOME[result.status].glyph} </span>
                  {CONDITION_STATUS_LABEL[result.status]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
