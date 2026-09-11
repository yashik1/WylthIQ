import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { METRIC_GUIDE } from "../learn/metric-guide";
import { GUIDES, findGuide } from "./content";

/**
 * The guides are the only long-form pages on the site, so what matters is
 * that each is substantial, links somewhere real, and never advises.
 */

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

const allText = (guide: (typeof GUIDES)[number]) =>
  [
    guide.title,
    guide.description,
    guide.standfirst,
    ...guide.sections.flatMap((s) => [s.heading, ...s.paragraphs, ...(s.points ?? [])]),
    guide.example?.note ?? "",
    ...guide.faq.flatMap((f) => [f.question, f.answer]),
  ].join(" ");

describe("guides", () => {
  it("has unique, URL-safe slugs that no existing route already uses", () => {
    const appDir = path.resolve(__dirname, "../../app");
    const taken = new Set(
      readdirSync(appDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
    const slugs = GUIDES.map((g) => g.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(taken.has(slug), slug).toBe(false);
    }
  });

  it("gives every guide real substance", () => {
    for (const guide of GUIDES) {
      expect(words(allText(guide)), guide.slug).toBeGreaterThan(450);
      expect(guide.sections.length, guide.slug).toBeGreaterThanOrEqual(4);
      expect(guide.faq.length, guide.slug).toBeGreaterThanOrEqual(3);
      expect(guide.description.length, guide.slug).toBeLessThanOrEqual(200);
    }
  });

  it("links only to pages on this site and to explanations that exist", () => {
    for (const guide of GUIDES) {
      expect(guide.apply.length, guide.slug).toBeGreaterThan(0);
      for (const link of guide.apply) expect(link.href, guide.slug).toMatch(/^\/[a-z]/);
      for (const id of guide.related) expect(METRIC_GUIDE[id], `${guide.slug}: ${id}`).toBeDefined();
    }
  });

  it("never advises", () => {
    for (const guide of GUIDES) {
      expect(allText(guide), guide.slug).not.toMatch(
        /\b(buy|sell|you should|we recommend|price target|undervalued|overvalued|bargain)\b/i,
      );
    }
  });

  it("finds a guide by slug, and nothing for an unknown one", () => {
    expect(findGuide("what-is-free-cash-flow")?.title).toBe("What is free cash flow?");
    expect(findGuide("stock")).toBeNull();
  });
});
