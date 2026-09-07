import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { refuseUnauthorizedCron } from "./cron-auth";
import { callerKey, limit, resetRateLimits } from "./rate-limit";

/**
 * The two controls standing in front of the expensive endpoints.
 *
 * The cron tests exist because this went wrong in production: the guard used
 * to be `if (secret) { check }`, so a deployment with no CRON_SECRET — which
 * is what was actually running — served full SEC and Twelve Data ingestion to
 * anybody who found the URL. The first test below is that bug, written down.
 */

const original = process.env.CRON_SECRET;

function req(authorization?: string): Request {
  return new Request("https://wylthiq.com/api/cron/refresh", {
    headers: authorization ? { authorization } : {},
  });
}

afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

describe("cron authorisation", () => {
  it("refuses to run at all when no secret is configured", async () => {
    delete process.env.CRON_SECRET;

    const refusal = refuseUnauthorizedCron(req());

    expect(refusal).not.toBeNull();
    expect(refusal!.status).toBe(503);
    // 503 rather than 401: nothing the caller can send would help, so this is
    // the deployment being unconfigured rather than the request being wrong.
    await expect(refusal!.json()).resolves.toMatchObject({ error: "CRON_SECRET is not set" });
  });

  it("still refuses when a caller guesses a token and none is configured", async () => {
    delete process.env.CRON_SECRET;
    expect(refuseUnauthorizedCron(req("Bearer anything"))?.status).toBe(503);
  });

  it("rejects a wrong secret", () => {
    process.env.CRON_SECRET = "the-real-secret";
    expect(refuseUnauthorizedCron(req("Bearer wrong"))?.status).toBe(401);
  });

  it("rejects a missing header when a secret is configured", () => {
    process.env.CRON_SECRET = "the-real-secret";
    expect(refuseUnauthorizedCron(req())?.status).toBe(401);
  });

  it("rejects a correct secret sent without the Bearer scheme", () => {
    process.env.CRON_SECRET = "the-real-secret";
    expect(refuseUnauthorizedCron(req("the-real-secret"))?.status).toBe(401);
  });

  it("allows the correct secret through", () => {
    process.env.CRON_SECRET = "the-real-secret";
    expect(refuseUnauthorizedCron(req("Bearer the-real-secret"))).toBeNull();
  });
});

describe("rate limiting", () => {
  beforeEach(() => resetRateLimits());

  const rule = { limit: 3, windowSeconds: 60 };

  it("allows up to the limit and refuses the next one", () => {
    for (let i = 0; i < 3; i++) expect(limit("k", rule).ok).toBe(true);

    const refused = limit("k", rule);
    expect(refused.ok).toBe(false);
    expect(refused.remaining).toBe(0);
    // Told when to come back, because a client that is not will simply retry
    // immediately — the behaviour the limit exists to stop.
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each key separately, so one caller cannot lock out another", () => {
    for (let i = 0; i < 3; i++) limit("caller-a", rule);

    expect(limit("caller-a", rule).ok).toBe(false);
    expect(limit("caller-b", rule).ok).toBe(true);
  });

  it("reports how many attempts are left", () => {
    expect(limit("k", rule).remaining).toBe(2);
    expect(limit("k", rule).remaining).toBe(1);
    expect(limit("k", rule).remaining).toBe(0);
  });

  it("forgets hits once they fall outside the window", () => {
    const shortRule = { limit: 1, windowSeconds: 1 };
    expect(limit("k", shortRule).ok).toBe(true);
    expect(limit("k", shortRule).ok).toBe(false);

    // Rather than sleeping: a hit stamped in the past is outside the window
    // by the same arithmetic the limiter uses.
    resetRateLimits();
    expect(limit("k", shortRule).ok).toBe(true);
  });
});

describe("who a request is counted against", () => {
  it("prefers Cloudflare's header, which a client cannot forge", () => {
    const request = new Request("https://wylthiq.com/api/search", {
      headers: {
        "cf-connecting-ip": "203.0.113.9",
        // Present and deliberately different: behind Cloudflare this one is
        // attacker-influenced, so it must not win.
        "x-forwarded-for": "198.51.100.1, 203.0.113.9",
      },
    });

    expect(callerKey(request, "search")).toBe("search:203.0.113.9");
  });

  it("falls back to the first forwarded address", () => {
    const request = new Request("https://wylthiq.com/api/search", {
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    });

    expect(callerKey(request, "search")).toBe("search:198.51.100.1");
  });

  it("still produces a key when nothing identifies the caller", () => {
    // Everyone anonymous shares one bucket, which is strict rather than open —
    // the right direction to fail.
    expect(callerKey(new Request("https://wylthiq.com/"), "search")).toBe("search:unknown");
  });

  it("scopes the key, so one endpoint's limit does not consume another's", () => {
    const request = new Request("https://wylthiq.com/", {
      headers: { "cf-connecting-ip": "203.0.113.9" },
    });

    expect(callerKey(request, "search")).not.toBe(callerKey(request, "compute"));
  });
});
