/**
 * Micro-holding grouping and search filtering unit tests.
 */

import { filterAndGroupHoldings } from "./microfilter";
import { ConsolidatedHolding } from "../types/portfolio";

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const SAMPLE_HOLDINGS: ConsolidatedHolding[] = [
  {
    isin: "US0378331005",
    name: "Apple Inc.",
    ticker: "AAPL",
    country: "United States",
    sector: "Information Technology",
    assetClass: "equity",
    issuerName: "Apple",
    valueNZD: 5000,
    portfolioWeight: 0.5,
    equityWeight: 0.5,
    sources: [{ sourceType: "fund", fundCode: "USF", assetClass: "equity", valueNZD: 5000 }],
  },
  {
    isin: "TINY1",
    name: "SmallCo Ltd",
    ticker: "SML",
    country: "New Zealand",
    sector: "Industrials",
    assetClass: "equity",
    valueNZD: 0.5,
    portfolioWeight: 0.00005,
    equityWeight: 0.00005,
    sources: [{ sourceType: "fund", fundCode: "FNZ", assetClass: "equity", valueNZD: 0.5 }],
  },
  {
    isin: "TINY2",
    name: "MicroCo Ltd",
    ticker: "MIC",
    country: "Australia",
    sector: "Materials",
    assetClass: "equity",
    valueNZD: 0.4,
    portfolioWeight: 0.00004,
    equityWeight: 0.00004,
    sources: [{ sourceType: "fund", fundCode: "AUS", assetClass: "equity", valueNZD: 0.4 }],
  },
];

export const microfilterTestCases: Array<[string, () => void]> = [
  [
    "groups holdings below 0.01% into aggregate MICRO row",
    () => {
      const res = filterAndGroupHoldings(SAMPLE_HOLDINGS, { groupMicroHoldings: true });
      assertEq(res.visibleHoldings.length, 2, "AAPL + aggregate MICRO row");
      assertEq(res.microHoldingsCount, 2, "2 micro holdings grouped");
      assertEq(res.visibleHoldings[1].ticker, "MICRO", "aggregate ticker");
    },
  ],
  [
    "search query bypasses micro grouping and matches fundCode and issuerName",
    () => {
      const byFund = filterAndGroupHoldings(SAMPLE_HOLDINGS, { searchQuery: "FNZ", groupMicroHoldings: true });
      assertEq(byFund.visibleHoldings.length, 1, "matches FNZ source");
      assertEq(byFund.visibleHoldings[0].ticker, "SML", "finds SmallCo via FNZ fundCode");

      const byIssuer = filterAndGroupHoldings(SAMPLE_HOLDINGS, { searchQuery: "apple", groupMicroHoldings: true });
      assertEq(byIssuer.visibleHoldings.length, 1, "case-insensitive name/issuer match");
    },
  ],
];

