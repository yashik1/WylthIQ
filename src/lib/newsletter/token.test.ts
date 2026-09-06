import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newsletterToken, verifyNewsletterToken } from "./token";

/**
 * Newsletter confirmation and unsubscribe links.
 *
 * The property that matters most is the one separating the two purposes: both
 * tokens name the same address under the same secret, so if the purpose were
 * not inside the signed material, a confirmation link would double as an
 * unsubscribe and the reverse.
 */

const original = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-not-a-real-one";
});

afterEach(() => {
  if (original === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = original;
});

const email = "reader@example.com";

describe("round trip", () => {
  it("returns the address a token was minted for", () => {
    expect(verifyNewsletterToken("confirm", newsletterToken("confirm", email))).toBe(email);
    expect(verifyNewsletterToken("unsubscribe", newsletterToken("unsubscribe", email))).toBe(email);
  });

  it("survives an address containing characters a URL would mangle", () => {
    const plus = "reader+marketminer@example.co.uk";
    expect(verifyNewsletterToken("confirm", newsletterToken("confirm", plus))).toBe(plus);
  });
});

describe("what a token cannot do", () => {
  /*
    The whole reason `purpose` is signed rather than passed alongside. Without
    it these two are byte-identical, and a confirmation link — which is sent
    to an address that has not yet agreed to anything — would silently work as
    an unsubscribe for somebody already on the list.
  */
  it("does not accept a confirm token as an unsubscribe", () => {
    expect(verifyNewsletterToken("unsubscribe", newsletterToken("confirm", email))).toBeNull();
  });

  it("does not accept an unsubscribe token as a confirmation", () => {
    expect(verifyNewsletterToken("confirm", newsletterToken("unsubscribe", email))).toBeNull();
  });

  it("rejects a token signed under a different secret", () => {
    const token = newsletterToken("confirm", email);
    process.env.AUTH_SECRET = "a-completely-different-secret";
    expect(verifyNewsletterToken("confirm", token)).toBeNull();
  });

  it("rejects a tampered address", () => {
    const [, signature] = newsletterToken("confirm", email).split(".");
    const forged = `${Buffer.from("attacker@example.com").toString("base64url")}.${signature}`;
    expect(verifyNewsletterToken("confirm", forged)).toBeNull();
  });

  it("rejects malformed input rather than throwing", () => {
    for (const bad of ["", ".", "nodot", "a.b.c", "!!!.!!!"]) {
      expect(verifyNewsletterToken("confirm", bad)).toBeNull();
    }
  });

  it("rejects everything when there is no secret to verify against", () => {
    const token = newsletterToken("confirm", email);
    delete process.env.AUTH_SECRET;
    expect(verifyNewsletterToken("confirm", token)).toBeNull();
  });
});
