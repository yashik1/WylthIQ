import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Explain, Metric } from "./ui";

/**
 * Whether an explanation can actually be opened.
 *
 * Every explanatory sentence in this app used to be delivered through a
 * `title` attribute, which appears on hover and nowhere else. That is not a
 * cosmetic shortfall: on a touchscreen there is no hover at all, so on the
 * device most of this app is read on, the explanatory layer the whole product
 * is positioned around simply did not exist. A sighted keyboard user could not
 * reach it either.
 *
 * These tests pin the fix at the markup level, because the regression is
 * invisible: putting the sentence back in a `title` would still render, still
 * pass a typecheck, and still look identical in a screenshot.
 */
describe("explanations", () => {
  const html = renderToStaticMarkup(
    <Metric label="Free cash flow" value="$98.4B" hint="Cash left after upkeep." />,
  );

  it("puts the explanation in the document, not only in a tooltip", () => {
    expect(html).toContain("Cash left after upkeep.");
  });

  it("uses a disclosure a touch or keyboard user can open", () => {
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
  });

  it("does not hide the explanation behind hover alone", () => {
    // The specific regression: a `title` carrying the explanation is only
    // reachable with a mouse.
    expect(html).not.toContain('title="Cash left after upkeep."');
  });

  it("names what is being explained, so a screen reader list is not all ⓘ", () => {
    expect(html).toContain('aria-label="Explain Free cash flow"');
  });

  it("adds no disclosure to a figure that has no explanation", () => {
    const bare = renderToStaticMarkup(<Metric label="Shares" value="15.1B" />);
    expect(bare).not.toContain("<details");
    expect(bare).toContain("15.1B");
  });

  it("still shows the label and the value themselves", () => {
    expect(html).toContain("Free cash flow");
    expect(html).toContain("$98.4B");
  });

  it("works standalone, for explanations that are not attached to a Metric", () => {
    const standalone = renderToStaticMarkup(
      <Explain term="Gross margin">What is left after the cost of the sale.</Explain>,
    );
    expect(standalone).toContain("<details");
    expect(standalone).toContain("What is left after the cost of the sale.");
    expect(standalone).toContain('aria-label="Explain Gross margin"');
  });
});
