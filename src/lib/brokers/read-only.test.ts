import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A tripwire over the source, for the promise made to every reader who
 * connects a broker: this app reads, and never trades or moves money.
 *
 * The guarantee itself is IBKR's — a Flex Web Service token can download
 * reports and nothing else. This test is the second line: it fails the build
 * if the code ever grows a way to talk to IBKR other than the two report
 * URLs, or picks up the vocabulary of placing orders or moving funds, so that
 * change cannot slip in unnoticed as part of something else.
 */

const root = join(import.meta.dirname, "..", "..", "..");
const src = join(root, "src");
const self = join(import.meta.dirname, "read-only.test.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "fixtures" ? [] : sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry.name) || path === self) return [];
    return [path];
  });
}

/**
 * Code without its comments, so the explanation of what the app will not do
 * does not itself trip the wire. A `//` preceded by a colon is a URL, not a
 * comment, and is kept.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const everything = sourceFiles(src).filter((p) => !/\.test\.tsx?$/.test(p));
const brokerCode = everything.filter((p) =>
  /[\\/](lib[\\/]brokers|components[\\/]brokers|app[\\/]api[\\/]cron[\\/]broker-sync)[\\/]/.test(p),
);
const client = join(src, "lib", "brokers", "ibkr-flex.ts");

describe("the broker connection can only read", () => {
  it("finds the broker code it is guarding", () => {
    expect(brokerCode.map((p) => relative(src, p))).toEqual(
      expect.arrayContaining([join("lib", "brokers", "ibkr-flex.ts"), join("lib", "brokers", "sync.ts")]),
    );
  });

  it("talks to IBKR from one file only", () => {
    // Both of IBKR's domains: the trading Web API lives on ibkr.com.
    const naming = everything.filter((p) => /interactivebrokers\.com|\bibkr\.com/i.test(code(p)));
    expect(naming.map((p) => relative(src, p))).toEqual([join("lib", "brokers", "ibkr-flex.ts")]);
  });

  it("names no IBKR address except the two Flex report URLs", () => {
    const urls = code(client).match(/https:\/\/[^\s"'`]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(
        /^https:\/\/(ndcdyn|gdcdyn)\.interactivebrokers\.com\/AccountManagement\/FlexWebService\/(SendRequest|GetStatement)$/,
      );
    }
  });

  it("sends only GET requests, from one place", () => {
    const fetching = brokerCode.filter((p) => /\bfetch(Impl)?\s*\(/.test(code(p)));
    expect(fetching.map((p) => relative(src, p))).toEqual([join("lib", "brokers", "ibkr-flex.ts")]);
    const methods = code(client).match(/method:\s*"[A-Z]+"/g) ?? [];
    expect(methods).toEqual(['method: "GET"']);
  });

  it("has no vocabulary for placing orders or moving money", () => {
    const banned =
      /placeOrder|cancelOrder|replaceOrder|modifyOrder|reqGlobalCancel|exerciseOptions|iserver|\/orders\b|whatif|withdraw|deposit|transferFunds|method:\s*"(POST|PUT|PATCH|DELETE)"/i;
    for (const path of brokerCode) {
      expect(code(path), relative(src, path)).not.toMatch(banned);
    }
  });
});
