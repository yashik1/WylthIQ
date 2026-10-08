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
  /[\\/](lib[\\/]brokers|components[\\/]brokers|app[\\/]api[\\/](cron[\\/]broker-sync|brokers))[\\/]/.test(p),
);
const flex = join(src, "lib", "brokers", "ibkr-flex.ts");
const snaptrade = join(src, "lib", "brokers", "snaptrade.ts");
const rel = (p: string) => relative(src, p);
const isComponent = (p: string) => /[\\/]components[\\/]/.test(p);

/**
 * A page's own request to this app's broker routes — the statement upload —
 * is not a request to a broker, and is taken out before the rules below look
 * for one. Only a same-origin path under /api/brokers/ counts as that.
 */
const OWN_ROUTE_CALL = /fetch\(\s*"\/api\/brokers\/[^"]*",\s*\{\s*method:\s*"POST"/g;
const brokerFacing = (p: string) => code(p).replace(OWN_ROUTE_CALL, "");

/**
 * SnapTrade's own terms and privacy policy, which a reader agrees to by
 * connecting, are linked from the account card and the terms page. A link a
 * reader follows is not a request this app makes, so these two addresses —
 * exactly these — are taken out before looking for code that talks to
 * SnapTrade.
 */
const SNAPTRADE_LEGAL_PAGE = /"https:\/\/snaptrade\.com\/(terms-and-conditions|privacy-policy)"/g;

/**
 * Every request the SnapTrade client may make. Registering, opening the
 * connection page and deleting are the only writes, and none of them touches
 * an account: they manage the reader's link to SnapTrade itself.
 */
const SNAPTRADE_ROUTES = [
  'POST /^\\/snapTrade\\/registerUser$/',
  'POST /^\\/snapTrade\\/login$/',
  'DELETE /^\\/snapTrade\\/deleteUser$/',
  'GET /^\\/authorizations$/',
  'DELETE /^\\/connection\\/[A-Za-z0-9-]+$/',
  'GET /^\\/accounts$/',
  'GET /^\\/accounts\\/[A-Za-z0-9-]+\\/positions\\/all$/',
  'GET /^\\/accounts\\/[A-Za-z0-9-]+\\/activities$/',
];

describe("the broker connections can only read", () => {
  it("finds the broker code it is guarding", () => {
    expect(brokerCode.map(rel)).toEqual(
      expect.arrayContaining([
        join("lib", "brokers", "ibkr-flex.ts"),
        join("lib", "brokers", "snaptrade.ts"),
        join("lib", "brokers", "sync.ts"),
      ]),
    );
  });

  it("talks to IBKR from one file only", () => {
    // Both of IBKR's domains: the trading Web API lives on ibkr.com.
    const naming = everything.filter((p) => /interactivebrokers\.com|\bibkr\.com/i.test(code(p)));
    expect(naming.map(rel)).toEqual([join("lib", "brokers", "ibkr-flex.ts")]);
  });

  it("talks to SnapTrade from one file only", () => {
    const naming = everything.filter((p) => /snaptrade\.com/i.test(code(p).replace(SNAPTRADE_LEGAL_PAGE, "")));
    expect(naming.map(rel)).toEqual([join("lib", "brokers", "snaptrade.ts")]);
  });

  it("names no IBKR address except the two Flex report URLs", () => {
    const urls = code(flex).match(/https:\/\/[^\s"'`]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(
        /^https:\/\/(ndcdyn|gdcdyn)\.interactivebrokers\.com\/AccountManagement\/FlexWebService\/(SendRequest|GetStatement)$/,
      );
    }
  });

  it("names no SnapTrade address but its API", () => {
    const urls = code(snaptrade).match(/https:\/\/[^\s"'`]+/g) ?? [];
    expect(urls).toEqual(["https://api.snaptrade.com"]);
  });

  it("sends requests from the two clients only, and IBKR only GETs", () => {
    const fetching = brokerCode.filter((p) =>
      /\bfetch(Impl)?\s*\(|\(deps\.fetch \?\? fetch\)\(/.test(brokerFacing(p)),
    );
    expect(fetching.map(rel).sort()).toEqual([join("lib", "brokers", "ibkr-flex.ts"), join("lib", "brokers", "snaptrade.ts")]);
    expect(code(flex).match(/method:\s*"[A-Z]+"/g)).toEqual(['method: "GET"']);
  });

  it("can make only the listed SnapTrade requests", () => {
    const routes = [...code(snaptrade).matchAll(/\{\s*method:\s*"([A-Z]+)",\s*path:\s*(\/\^.*?\$\/)\s*\}/g)].map(
      (m) => `${m[1]} ${m[2]}`,
    );
    expect(routes).toEqual(SNAPTRADE_ROUTES);

    // Every call names a method and path that the list above allows.
    const calls = [...code(snaptrade).matchAll(/snaptradeRequest(?:<[^>]*>)?\(\s*"([A-Z]+)",\s*[`"]([^`"]+)[`"]/g)];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const [, method, template] of calls) {
      const path = template.replace(/\$\{[^}]+\}/g, "id-1");
      const allowed = SNAPTRADE_ROUTES.some((route) => {
        const [m, pattern] = route.split(" ");
        return m === method && new RegExp(pattern.slice(1, -1)).test(path);
      });
      expect(allowed, `${method} ${template}`).toBe(true);
    }
  });

  it("only ever asks SnapTrade for a read-only connection", () => {
    for (const path of brokerCode) {
      for (const [, value] of code(path).matchAll(/connectionType:\s*"([^"]*)"/g)) {
        expect(value, rel(path)).toBe("read");
      }
    }
    expect(code(snaptrade)).toMatch(/connectionType:\s*"read"/);
  });

  it("has no vocabulary for placing orders or moving money", () => {
    const banned =
      /placeOrder|cancelOrder|replaceOrder|modifyOrder|reqGlobalCancel|exerciseOptions|iserver|\/orders\b|\/trade\b|\/trading\b|\/quotes\b|impact|tradeDetection|resetUserSecret|trade-if-available|whatif|withdraw|deposit|transferFunds|method:\s*"(PUT|PATCH)"/i;
    for (const path of brokerCode) {
      expect(code(path), rel(path)).not.toMatch(banned);
    }
    // POST and DELETE appear only in the SnapTrade client's list of routes.
    for (const path of brokerCode.filter((p) => p !== snaptrade)) {
      expect(brokerFacing(path), rel(path)).not.toMatch(/method:\s*"(POST|DELETE)"/);
    }
  });

  it("lets pages call only this app's own broker routes", () => {
    for (const path of brokerCode.filter(isComponent)) {
      for (const [, target] of code(path).matchAll(/fetch\(\s*([^,)]+)/g)) {
        expect(target, rel(path)).toMatch(/^"\/api\/brokers\//);
      }
    }
  });
});
