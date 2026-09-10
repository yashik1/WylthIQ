import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which manager is asked about which ticker.
 *
 * The rule worth pinning is the negative one: a bare ticker is never looked
 * up, because a bare ticker names the US security and several Canadian fund
 * tickers belong to unrelated US funds as well.
 */

const { ishares } = vi.hoisted(() => ({ ishares: vi.fn() }));

vi.mock("./ishares-ca", () => ({ getISharesCanadaProfile: ishares }));

import { getCanadianIssuerProfile } from "./index";

beforeEach(() => {
  ishares.mockReset();
  ishares.mockResolvedValue(null);
});

describe("choosing the manager", () => {
  it("never answers a bare ticker", async () => {
    // VGRO in New York is not Vanguard Canada's VGRO.
    expect(await getCanadianIssuerProfile("VGRO")).toBeNull();
    expect(ishares).not.toHaveBeenCalled();
  });

  it("answers a Toronto listing from Vanguard's table without a request", async () => {
    const profile = await getCanadianIssuerProfile("VGRO.TO");
    expect(profile?.expenseRatio).toBeCloseTo(0.0022, 8);
    expect(ishares).not.toHaveBeenCalled();
  });

  it("treats the Cboe Canada listing as the same fund", async () => {
    expect((await getCanadianIssuerProfile("VCN.NE"))?.holdingCount).toBe(215);
  });

  it("asks iShares about a Toronto ticker Vanguard does not list", async () => {
    await getCanadianIssuerProfile("XIC.TO");
    expect(ishares).toHaveBeenCalledWith("XIC");
  });

  it("ignores listings outside Canada", async () => {
    expect(await getCanadianIssuerProfile("RIO.L")).toBeNull();
    expect(ishares).not.toHaveBeenCalled();
  });
});
