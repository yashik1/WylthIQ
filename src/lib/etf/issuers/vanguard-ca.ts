import type { EtfProfile } from "../../providers/alphavantage";

/**
 * Vanguard Canada's ETFs — fees, size and position counts, as Vanguard lists
 * them.
 *
 * A table rather than a request, and that is a constraint rather than a
 * preference. Vanguard's site draws these figures from an internal API that
 * refuses any caller not identifying as one of Vanguard's own applications,
 * and presenting that identity from here would be impersonating their
 * website. What Vanguard does publish openly is its product list, which
 * prints every ETF's fee, holdings count and size in one table — so that is
 * what this is, copied with its date.
 *
 * Fees move about once a year, after each fund's financial year-end, so a
 * dated table is a fair trade for a figure that changes that rarely. The
 * page states the date beside the fee. To refresh: open SOURCE_URL, read the
 * ETF rows (not the "Series F" mutual funds or the model portfolios), update
 * the entries and move VANGUARD_CA_AS_OF.
 */

/** When the figures below were read off Vanguard's product list. */
export const VANGUARD_CA_AS_OF = "2026-09-10";

const SOURCE_URL = "https://www.vanguard.ca/en/product";

interface VanguardEtf {
  name: string;
  /** Percent units, as the list prints them: 0.05 is 0.05%. */
  managementFee: number;
  /**
   * Management expense ratio, percent units. Null for a fund too new to
   * have completed a financial year — the list prints a dash.
   */
  mer: number | null;
  holdings: number | null;
  /** Canadian dollars, rounded as the list prints them ("$17.8 B"). */
  totalAssets: number | null;
}

export const VANGUARD_CA_ETFS: Record<string, VanguardEtf> = {
  // Equity
  VIGG: { name: "Vanguard Developed ex-North America Dividend Appreciation Index ETF", managementFee: 0.28, mer: 0.32, holdings: 225, totalAssets: 14_800_000 },
  VCN: { name: "Vanguard FTSE Canada All Cap Index ETF", managementFee: 0.05, mer: 0.05, holdings: 215, totalAssets: 17_800_000_000 },
  VCE: { name: "Vanguard FTSE Canada Index ETF", managementFee: 0.05, mer: 0.05, holdings: 86, totalAssets: 3_700_000_000 },
  VRE: { name: "Vanguard FTSE Canadian Capped REIT Index ETF", managementFee: 0.35, mer: 0.32, holdings: 18, totalAssets: 265_400_000 },
  VDY: { name: "Vanguard FTSE Canadian High Dividend Yield Index ETF", managementFee: 0.2, mer: 0.22, holdings: 60, totalAssets: 9_000_000_000 },
  VIU: { name: "Vanguard FTSE Developed All Cap ex North America Index ETF", managementFee: 0.2, mer: 0.21, holdings: 3657, totalAssets: 11_600_000_000 },
  VI: { name: "Vanguard FTSE Developed All Cap ex North America Index ETF (CAD-hedged)", managementFee: 0.2, mer: 0.22, holdings: 3657, totalAssets: 972_100_000 },
  VDU: { name: "Vanguard FTSE Developed All Cap ex U.S. Index ETF", managementFee: 0.2, mer: 0.21, holdings: 3886, totalAssets: 852_600_000 },
  VEF: { name: "Vanguard FTSE Developed All Cap ex U.S. Index ETF (CAD-hedged)", managementFee: 0.2, mer: 0.21, holdings: 3886, totalAssets: 1_300_000_000 },
  VA: { name: "Vanguard FTSE Developed Asia Pacific All Cap Index ETF", managementFee: 0.2, mer: 0.22, holdings: 2332, totalAssets: 358_500_000 },
  VE: { name: "Vanguard FTSE Developed Europe All Cap Index ETF", managementFee: 0.2, mer: 0.22, holdings: 1221, totalAssets: 686_200_000 },
  VIDY: { name: "Vanguard FTSE Developed ex North America High Dividend Yield Index ETF", managementFee: 0.28, mer: 0.31, holdings: 629, totalAssets: 2_200_000_000 },
  VEE: { name: "Vanguard FTSE Emerging Markets All Cap Index ETF", managementFee: 0.23, mer: 0.24, holdings: 6338, totalAssets: 4_600_000_000 },
  VXC: { name: "Vanguard FTSE Global All Cap ex Canada Index ETF", managementFee: 0.2, mer: 0.21, holdings: 11702, totalAssets: 3_600_000_000 },
  VVO: { name: "Vanguard Global Minimum Volatility ETF", managementFee: 0.35, mer: 0.36, holdings: 195, totalAssets: 45_000_000 },
  VMO: { name: "Vanguard Global Momentum Factor ETF", managementFee: 0.35, mer: 0.38, holdings: 899, totalAssets: 481_500_000 },
  VVL: { name: "Vanguard Global Value Factor ETF", managementFee: 0.35, mer: 0.38, holdings: 845, totalAssets: 896_600_000 },
  VUN: { name: "Vanguard Morningstar U.S. Total Market Index ETF", managementFee: 0.15, mer: 0.16, holdings: 3515, totalAssets: 19_700_000_000 },
  VUS: { name: "Vanguard Morningstar U.S. Total Market Index ETF (CAD-hedged)", managementFee: 0.15, mer: 0.15, holdings: 3515, totalAssets: 1_400_000_000 },
  VFV: { name: "Vanguard S&P 500 Index ETF", managementFee: 0.08, mer: 0.08, holdings: 505, totalAssets: 35_200_000_000 },
  VSP: { name: "Vanguard S&P 500 Index ETF (CAD-hedged)", managementFee: 0.08, mer: 0.08, holdings: 505, totalAssets: 6_300_000_000 },
  VGG: { name: "Vanguard U.S. Dividend Appreciation Index ETF", managementFee: 0.28, mer: 0.29, holdings: 333, totalAssets: 2_600_000_000 },
  VGH: { name: "Vanguard U.S. Dividend Appreciation Index ETF (CAD-hedged)", managementFee: 0.28, mer: 0.29, holdings: 333, totalAssets: 1_000_000_000 },
  VUDV: { name: "Vanguard U.S. High Dividend Yield Index ETF", managementFee: 0.28, mer: 0.36, holdings: 604, totalAssets: 59_400_000 },
  VUDH: { name: "Vanguard U.S. High Dividend Yield Index ETF (CAD-hedged)", managementFee: 0.28, mer: 0.32, holdings: null, totalAssets: 3_900_000 },

  // Fixed income
  VAB: { name: "Vanguard Canadian Aggregate Bond Index ETF", managementFee: 0.08, mer: 0.08, holdings: 1305, totalAssets: 7_600_000_000 },
  VCB: { name: "Vanguard Canadian Corporate Bond Index ETF", managementFee: 0.15, mer: 0.16, holdings: 862, totalAssets: 854_600_000 },
  VGV: { name: "Vanguard Canadian Government Bond Index ETF", managementFee: 0.1, mer: 0.09, holdings: 500, totalAssets: 144_600_000 },
  VLB: { name: "Vanguard Canadian Long-Term Bond Index ETF", managementFee: 0.15, mer: 0.17, holdings: 418, totalAssets: 251_700_000 },
  VSB: { name: "Vanguard Canadian Short-Term Bond Index ETF", managementFee: 0.1, mer: 0.1, holdings: 576, totalAssets: 1_600_000_000 },
  VSC: { name: "Vanguard Canadian Short-Term Corporate Bond Index ETF", managementFee: 0.1, mer: 0.1, holdings: 450, totalAssets: 1_600_000_000 },
  VVSG: { name: "Vanguard Canadian Ultra-Short Government Bond Index ETF", managementFee: 0.1, mer: 0.11, holdings: 24, totalAssets: 233_100_000 },
  VGAB: { name: "Vanguard Global Aggregate Bond Index ETF (CAD-hedged)", managementFee: 0.2, mer: 0.22, holdings: 16824, totalAssets: 664_600_000 },
  VCOR: { name: "Vanguard Global Core-Plus Bond ETF", managementFee: 0.25, mer: null, holdings: null, totalAssets: null },
  VBG: { name: "Vanguard Global ex-U.S. Aggregate Bond Index ETF (CAD-hedged)", managementFee: 0.2, mer: 0.2, holdings: 6802, totalAssets: 1_500_000_000 },
  VBU: { name: "Vanguard U.S. Aggregate Bond Index ETF (CAD-hedged)", managementFee: 0.2, mer: 0.21, holdings: 11451, totalAssets: 1_900_000_000 },

  // Asset allocation
  VEQT: { name: "Vanguard All-Equity ETF Portfolio", managementFee: 0.17, mer: 0.22, holdings: 14027, totalAssets: 17_000_000_000 },
  VBAL: { name: "Vanguard Balanced ETF Portfolio", managementFee: 0.17, mer: 0.22, holdings: 40568, totalAssets: 5_900_000_000 },
  VCNS: { name: "Vanguard Conservative ETF Portfolio", managementFee: 0.17, mer: 0.22, holdings: 40568, totalAssets: 964_900_000 },
  VCIP: { name: "Vanguard Conservative Income ETF Portfolio", managementFee: 0.17, mer: 0.22, holdings: 40568, totalAssets: 259_300_000 },
  VGRO: { name: "Vanguard Growth ETF Portfolio", managementFee: 0.17, mer: 0.22, holdings: 40568, totalAssets: 10_800_000_000 },
  VRIF: { name: "Vanguard Retirement Income ETF Portfolio", managementFee: 0.29, mer: 0.31, holdings: 40610, totalAssets: 374_700_000 },
};

/**
 * The profile for a Vanguard Canada ETF, by its Toronto ticker, or null.
 *
 * The bare Toronto ticker, never a suffixed one and never a US one: VGRO is
 * both a Vanguard Canada portfolio and an unrelated US fund, and deciding
 * which was meant is the caller's job, done with the exchange suffix.
 */
export function getVanguardCanadaProfile(ticker: string): EtfProfile | null {
  const fund = VANGUARD_CA_ETFS[ticker.trim().toUpperCase()];
  if (!fund) return null;

  return {
    // The MER, not the management fee: it is the fee plus the fund's running
    // costs, and it is the figure every other fee on this site is compared as.
    expenseRatio: fund.mer == null ? null : fund.mer / 100,
    dividendYield: null,
    turnover: null,
    inceptionDate: null,
    leveraged: false,
    sectors: [],
    holdings: [],
    topHoldings: [],
    holdingCount: fund.holdings,
    netAssets: fund.totalAssets,
    netAssetsCurrency: fund.totalAssets == null ? null : "CAD",
    source: {
      name: "Vanguard Canada's product list",
      url: SOURCE_URL,
      asOf: VANGUARD_CA_AS_OF,
      publishedByManager: true,
    },
  };
}
