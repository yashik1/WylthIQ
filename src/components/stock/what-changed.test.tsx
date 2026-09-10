import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WhatChanged } from "./what-changed";
import type { Change, ChangeReport, QuarterComparison } from "@/lib/scoring/changes";

/**
 * The what-changed panel.
 *
 * The rendering job here is small but its states are easy to get wrong: a
 * company where nothing much moved must say so rather than render an empty
 * card, every move shown has to carry the two figures it was computed from,
 * and a quarter must never be mistaken for a year.
 */

const change = (over: Partial<Change> = {}): Change => ({
  key: "revenue",
  label: "Revenue",
  from: "$100.00B",
  to: "$120.00B",
  delta: "+20.0%",
  direction: "better",
  severity: "significant",
  meaning: "Sales are what everything else is built on.",
  ...over,
});

const quarter = (over: Partial<QuarterComparison> = {}): QuarterComparison => ({
  kind: "year-over-year",
  toLabel: "Q3 FY2026",
  fromLabel: "Q3 FY2025",
  form: "10-Q",
  filedAt: "2026-07-31",
  sourceFilingUrl: "https://www.sec.gov/Archives/edgar/data/320193/q3.htm",
  changes: [change({ delta: "+9.6%", severity: "notable" })],
  steady: 5,
  ...over,
});

const report = (over: Partial<ChangeReport> = {}): ChangeReport => ({
  fromYear: 2024,
  toYear: 2025,
  form: "10-K",
  filedAt: "2025-10-31",
  changes: [change()],
  steady: 3,
  sourceFilingUrl: "https://www.sec.gov/Archives/edgar/data/320193/aapl-20250927.htm",
  quarterly: [],
  ...over,
});

const render = (r: ChangeReport) => renderToStaticMarkup(<WhatChanged report={r} />);

describe("what changed panel", () => {
  it("names both years being compared, and when the latest was filed", () => {
    const html = render(report());
    expect(html).toContain("What changed in FY2025");
    expect(html).toContain("FY2024");
    expect(html).toContain("filed Oct 31, 2025");
  });

  it("shows the figures behind the move, not just the move", () => {
    const html = render(report());
    expect(html).toContain("+20.0%");
    // Without both sides the percentage is an assertion the reader cannot check.
    expect(html).toContain("$100.00B");
    expect(html).toContain("$120.00B");
  });

  it("gives a steady year an answer rather than an empty card", () => {
    const html = render(report({ changes: [], steady: 8 }));
    expect(html).toMatch(/Nothing moved far enough/);
    expect(html).toContain("8 measures");
  });

  it("counts a single steady measure in the singular", () => {
    const html = render(report({ changes: [], steady: 1 }));
    expect(html).toContain("1 measure ");
    expect(html).not.toContain("1 measures");
  });

  it("says how many measures were compared and stayed put", () => {
    expect(render(report({ steady: 4 }))).toContain("4 other measures barely moved");
    expect(render(report({ steady: 1 }))).toContain("1 other measure barely moved");
    // Nothing to mention when everything moved.
    expect(render(report({ steady: 0 }))).not.toMatch(/barely moved/);
  });

  it("marks direction for a screen reader, not only in colour", () => {
    const worse = render(report({ changes: [change({ direction: "worse" })] }));
    expect(worse).toContain("Deteriorated");

    const better = render(report({ changes: [change({ direction: "better" })] }));
    expect(better).toContain("Improved");
  });

  it("grades each move in words", () => {
    expect(render(report())).toContain("Significant");
    expect(render(report({ changes: [change({ severity: "critical" })] }))).toContain("Critical");
  });

  it("says why a move matters without anything to open", () => {
    const html = render(report());
    expect(html).toContain("Why it matters:");
    expect(html).toContain("Sales are what everything else is built on.");
  });

  it("explains the measure itself through the shared guide, with a link to Learn", () => {
    const html = render(report());
    expect(html).toContain("<details");
    expect(html).toContain('aria-label="Explain Revenue"');
    expect(html).toContain('href="/learn#revenue"');
  });

  it("offers no explanation for a measure the guide does not cover", () => {
    const html = render(
      report({ changes: [change({ key: "capex", label: "Capital spending", direction: "neutral" })] }),
    );
    expect(html).not.toContain('aria-label="Explain Capital spending"');
  });

  it("admits it has not read the management commentary", () => {
    // The one thing a reader might reasonably assume a "what changed" panel
    // did, and the one thing this data cannot support.
    expect(render(report())).toMatch(/management commentary/i);
  });

  it("links the filing the latest figures came from", () => {
    expect(render(report())).toContain(
      "https://www.sec.gov/Archives/edgar/data/320193/aapl-20250927.htm",
    );
  });

  it("renders without a filing link, a form or a filed date", () => {
    const html = render(report({ sourceFilingUrl: null, form: null, filedAt: null }));
    expect(html).toContain("What changed in FY2025");
    expect(html).not.toContain("read the latest one");
    expect(html).not.toContain("filed");
  });

  it("renders a sign change without inventing a percentage", () => {
    const html = render(
      report({
        changes: [
          change({
            key: "netIncome",
            label: "Profit",
            from: "-$100.00B",
            to: "$50.00B",
            delta: "turned positive",
            severity: "critical",
          }),
        ],
      }),
    );
    expect(html).toContain("turned positive");
    expect(html).not.toMatch(/150/);
  });
});

describe("quarters", () => {
  it("adds no quarterly section when there is none", () => {
    expect(render(report())).not.toMatch(/Latest quarter/);
  });

  it("labels a quarter against the same quarter a year earlier as exactly that", () => {
    const html = render(report({ quarterly: [quarter()] }));
    expect(html).toContain("Latest fiscal year, against the one before");
    expect(html).toContain("Latest quarter, against the same quarter a year earlier");
    expect(html).toContain("Q3 FY2026 against Q3 FY2025");
    expect(html).toContain("filed Jul 31, 2026");
    expect(html).toContain("https://www.sec.gov/Archives/edgar/data/320193/q3.htm");
  });

  it("warns that a quarter against the one before includes seasonal swings", () => {
    const html = render(
      report({ quarterly: [quarter({ kind: "sequential", fromLabel: "Q2 FY2026" })] }),
    );
    expect(html).toContain("Latest quarter, against the quarter before");
    expect(html).toMatch(/seasonal/);
  });

  it("gives a quiet quarter an answer rather than an empty block", () => {
    const html = render(report({ quarterly: [quarter({ changes: [] })] }));
    expect(html).toMatch(/Nothing moved far enough to be worth calling out between these quarters/);
  });
});

describe("markup validity", () => {
  /*
    A <details> is flow content and a <p> accepts only phrasing, so a browser
    closes the paragraph early when it meets one. The server-rendered string
    and the parsed DOM then disagree, and React fails hydration on the whole
    subtree — which is exactly what shipped here first, and which no snapshot
    of the markup would have caught because the string itself looks fine.
  */
  const nestedInParagraph = /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<details/;

  it("never nests a disclosure inside a paragraph", () => {
    expect(render(report({ quarterly: [quarter()] }))).not.toMatch(nestedInParagraph);
  });

  it("puts nothing but phrasing content inside an explanation", () => {
    // The body of an explanation is a span; a paragraph or list inside it is
    // invalid and gets rearranged by the browser.
    const html = render(report());
    const body = html.match(/<span class="explain-body">([\s\S]*?)<\/details>/)?.[1] ?? "";
    expect(body).not.toMatch(/<(p|div|ul|ol|li|dl)\b/);
  });
});
