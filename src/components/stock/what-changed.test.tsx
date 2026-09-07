import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WhatChanged } from "./what-changed";
import type { Change, ChangeReport } from "@/lib/scoring/changes";

/**
 * The year-on-year panel.
 *
 * The rendering job here is small but the two states it has are easy to get
 * wrong: a company where nothing much moved must say so rather than render an
 * empty card, and every move shown has to carry the two figures it was
 * computed from, or the panel is asking to be trusted rather than checked.
 */

const change = (over: Partial<Change> = {}): Change => ({
  key: "revenue",
  label: "Revenue",
  from: "$100.00B",
  to: "$120.00B",
  delta: "+20.0%",
  direction: "better",
  meaning: "Sales are what everything else is built on.",
  ...over,
});

const report = (over: Partial<ChangeReport> = {}): ChangeReport => ({
  fromYear: 2024,
  toYear: 2025,
  form: "10-K",
  changes: [change()],
  steady: 3,
  sourceFilingUrl: "https://www.sec.gov/Archives/edgar/data/320193/aapl-20250927.htm",
  ...over,
});

const render = (r: ChangeReport) => renderToStaticMarkup(<WhatChanged report={r} />);

describe("what changed panel", () => {
  it("names both years being compared", () => {
    const html = render(report());
    expect(html).toContain("What changed in FY2025");
    expect(html).toContain("FY2024");
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

  it("carries the explanation as an openable disclosure", () => {
    const html = render(report());
    expect(html).toContain("<details");
    expect(html).toContain("Sales are what everything else is built on.");
    expect(html).toContain('aria-label="Explain Revenue"');
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

  it("renders without a filing link or a form", () => {
    const html = render(report({ sourceFilingUrl: null, form: null }));
    expect(html).toContain("What changed in FY2025");
    expect(html).not.toContain("read the latest one");
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
          }),
        ],
      }),
    );
    expect(html).toContain("turned positive");
    expect(html).not.toMatch(/150/);
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
    expect(render(report())).not.toMatch(nestedInParagraph);
  });
});
