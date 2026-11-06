import { describe, expect, it } from "vitest";
import { confirmPeers, opensHere } from "./peer-links";
import type { SymbolSearchResult } from "./providers/types";

const listing = (symbol: string, exchange: string, country: string): SymbolSearchResult => ({
  symbol,
  name: symbol,
  exchange,
  cik: null,
  country,
});

describe("peers this site can open", () => {
  it("keeps bare tickers, US share classes and known exchange suffixes", () => {
    for (const s of ["RY", "BRK.B", "NA.TO", "SHOP.TO", "ATH.TO", "2099.HK"]) expect(opensHere(s), s).toBe(true);
  });

  it("drops preferred shares, trust units and unknown suffixes", () => {
    for (const s of ["NA.PR.I.TO", "BEP.UN.TO", "RY.XYZ", "", "AB CD"]) expect(opensHere(s), s).toBe(false);
  });

  it("drops a listing the directory knows only elsewhere, and keeps one it cannot check", async () => {
    const directory: Record<string, SymbolSearchResult[]> = {
      NA: [listing("NA", "TSX", "Canada")],
      // Veren after its takeover: the ticker survives elsewhere, not in Toronto.
      VRN: [listing("VRN", "NYSE", "United States")],
      PEY: [],
    };
    const peers = await confirmPeers(["NA.TO", "VRN.TO", "PEY.TO", "NA.PR.I.TO", "CVE"], async (q) => directory[q] ?? []);
    expect(peers).toEqual(["NA.TO", "PEY.TO", "CVE"]);
  });

  it("keeps a peer when the directory cannot be reached", async () => {
    const peers = await confirmPeers(["NA.TO"], async () => {
      throw new Error("directory down");
    });
    expect(peers).toEqual(["NA.TO"]);
  });
});
