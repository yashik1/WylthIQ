import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { brokerTokensEnabled, decryptToken, encryptToken, tokenHint } from "./crypto";

const TOKEN = "123456789012345678901234";

describe("broker token encryption", () => {
  const original = process.env.BROKER_TOKEN_KEY;

  beforeEach(() => {
    process.env.BROKER_TOKEN_KEY = randomBytes(32).toString("base64");
  });

  afterEach(() => {
    if (original === undefined) delete process.env.BROKER_TOKEN_KEY;
    else process.env.BROKER_TOKEN_KEY = original;
  });

  it("reads back what it wrote", () => {
    const stored = encryptToken(TOKEN, "user-1", "ibkr-flex");
    expect(decryptToken(stored, "user-1", "ibkr-flex")).toBe(TOKEN);
  });

  it("never stores the token where it can be read", () => {
    const stored = encryptToken(TOKEN, "user-1", "ibkr-flex");
    expect(stored).not.toContain(TOKEN);
    expect(stored.startsWith("v1:")).toBe(true);
  });

  it("writes a different ciphertext every time", () => {
    expect(encryptToken(TOKEN, "user-1", "ibkr-flex")).not.toBe(
      encryptToken(TOKEN, "user-1", "ibkr-flex"),
    );
  });

  it("will not decrypt a token copied onto another reader's row", () => {
    const stored = encryptToken(TOKEN, "user-1", "ibkr-flex");
    expect(decryptToken(stored, "user-2", "ibkr-flex")).toBeNull();
    expect(decryptToken(stored, "user-1", "other-broker")).toBeNull();
  });

  it("refuses a ciphertext that has been altered", () => {
    const stored = encryptToken(TOKEN, "user-1", "ibkr-flex");
    const [version, iv, tag, body] = stored.split(":");
    const flipped = Buffer.from(body, "base64url");
    flipped[0] ^= 1;
    const tampered = [version, iv, tag, flipped.toString("base64url")].join(":");
    expect(decryptToken(tampered, "user-1", "ibkr-flex")).toBeNull();
    expect(decryptToken("not a ciphertext", "user-1", "ibkr-flex")).toBeNull();
  });

  it("cannot read tokens after the key is rotated", () => {
    const stored = encryptToken(TOKEN, "user-1", "ibkr-flex");
    process.env.BROKER_TOKEN_KEY = randomBytes(32).toString("base64");
    expect(decryptToken(stored, "user-1", "ibkr-flex")).toBeNull();
  });

  it("is switched off without a usable key, rather than failing later", () => {
    expect(brokerTokensEnabled()).toBe(true);

    delete process.env.BROKER_TOKEN_KEY;
    expect(brokerTokensEnabled()).toBe(false);
    expect(() => encryptToken(TOKEN, "user-1", "ibkr-flex")).toThrow(/BROKER_TOKEN_KEY/);

    process.env.BROKER_TOKEN_KEY = randomBytes(16).toString("base64");
    expect(brokerTokensEnabled()).toBe(false);
  });

  it("shows only the last four characters", () => {
    expect(tokenHint(`  ${TOKEN}  `)).toBe("1234");
  });
});
