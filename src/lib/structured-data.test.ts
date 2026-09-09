import { describe, expect, it } from "vitest";
import { breadcrumbLd, corporationLd, faqLd, organisationLd, websiteLd } from "./structured-data";

/**
 * Guards on the JSON-LD, and one of them is here for a specific reason.
 *
 * `websiteLd` has now shipped a duplicate `publisher` key four times. Each
 * time, a change to this file added the publisher as a full inline
 * Organization while the `@id` reference form was already there, which is
 * invalid TypeScript — and each time the only thing that noticed was the
 * production build on Railway, two merges later, by which point main was red
 * and an unrelated pull request looked like the culprit.
 *
 * TypeScript does catch it, at `next build`. That is the problem: it catches
 * it after review, after merge, and only where somebody is watching a deploy
 * log. This runs in `npm test`, which is cheap enough to run before merging,
 * and it fails on the meaning rather than the syntax — esbuild resolves a
 * duplicate key to the last one wins, so a re-added inline block does not
 * throw here, it silently replaces the reference and this test says so.
 */

describe("the site and its publisher are one entity", () => {
  it("links the website to the organisation by @id, not by repeating it", () => {
    const site = websiteLd();
    const org = organisationLd();

    /*
      The whole point of the reference form. Two blocks each naming
      "WylthIQ" are two things to a crawler that happen to share a name; a
      reference makes them one, which is what a search for the product's own
      name has to resolve against.
    */
    expect(site.publisher).toEqual({ "@id": org["@id"] });
  });

  it("does not inline a second publisher over the reference", () => {
    // The exact regression. If someone re-adds the inline Organization block,
    // the last key wins at runtime and `publisher` gains a "@type" it should
    // never have here.
    const publisher = websiteLd().publisher as Record<string, unknown>;

    expect(publisher).not.toHaveProperty("@type");
    expect(publisher).not.toHaveProperty("name");
    expect(publisher).not.toHaveProperty("sameAs");
    expect(Object.keys(publisher)).toEqual(["@id"]);
  });

  it("gives the organisation a stable id the reference can point at", () => {
    const org = organisationLd();
    expect(org["@id"]).toMatch(/#organisation$/);
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe("WylthIQ");
  });

  it("carries the spellings a reader actually types", () => {
    // A brand written as one word gets searched as two.
    expect(organisationLd().alternateName).toContain("Wylth IQ");
    expect(websiteLd().alternateName).toContain("Wylth IQ");
  });

  it("claims no profile it does not have", () => {
    /*
      `sameAs` exists to corroborate an entity against places that already
      know it. A link to an account that does not exist is a claim a crawler
      will check and find false, so the property stays absent until there is
      something true to put in it.
    */
    expect(organisationLd()).not.toHaveProperty("sameAs");
  });
});

describe("what the markup is not allowed to assert", () => {
  /*
    The rule this module's own header sets: everything emitted is either a
    fact from a public filing or a description of this site. A health score
    marked up as an AggregateRating would be both a schema abuse and a claim
    the rest of the app is built to refuse.
  */
  const blocks = [
    organisationLd(),
    websiteLd(),
    corporationLd({ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", industry: "Technology" }),
    breadcrumbLd([{ name: "Home", path: "/" }]),
    faqLd([{ question: "What is a P/E?", answer: "Price divided by earnings." }]),
  ];

  for (const forbidden of ["aggregateRating", "review", "offers", "price"]) {
    it(`never emits ${forbidden}`, () => {
      for (const block of blocks) {
        expect(JSON.stringify(block)).not.toContain(`"${forbidden}"`);
      }
    });
  }
});

describe("a company", () => {
  it("states the ticker and identifies the filer", () => {
    const ld = corporationLd({
      symbol: "AAPL",
      name: "Apple Inc.",
      cik: "0000320193",
      website: "https://apple.com",
    });

    expect(ld["@type"]).toBe("Corporation");
    expect(ld.tickerSymbol).toBe("AAPL");
    expect(ld.sameAs).toEqual(["https://apple.com"]);
    expect(ld.identifier).toMatchObject({ value: "0000320193" });
  });

  it("omits what it was not given rather than inventing it", () => {
    const ld = corporationLd({ symbol: "XYZ", name: "Nothing Known Inc." });
    expect(ld).not.toHaveProperty("sameAs");
    expect(ld).not.toHaveProperty("identifier");
    expect(ld).not.toHaveProperty("description");
  });
});
