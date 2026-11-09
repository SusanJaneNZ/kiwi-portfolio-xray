/**
 * Post-aggregation micro-holding grouping and client-side filtering.
 */

import { ConsolidatedHolding } from "../types/portfolio";

export const MICRO_HOLDING_THRESHOLD = 0.0001; // 0.01% of total portfolio

export interface FilterOptions {
  searchQuery?: string;
  groupMicroHoldings?: boolean;
}

export interface FilteredHoldingsResult {
  visibleHoldings: ConsolidatedHolding[];
  microHoldingsCount: number;
  microHoldingsTotalNZD: number;
  microHoldingsWeight: number;
}

export function filterAndGroupHoldings(
  holdings: ConsolidatedHolding[],
  options: FilterOptions = {}
): FilteredHoldingsResult {
  const { searchQuery = "", groupMicroHoldings = true } = options;
  const query = searchQuery.trim().toLowerCase();

  // If search query is present, search across the entire underlying constituent index
  let matched = holdings;
  if (query) {
    matched = holdings.filter(
      (h) =>
        h.name.toLowerCase().includes(query) ||
        h.ticker.toLowerCase().includes(query) ||
        h.isin.toLowerCase().includes(query) ||
        h.sector.toLowerCase().includes(query) ||
        h.country.toLowerCase().includes(query)
    );
  }

  // If grouping is disabled or user searched, return matched list directly
  if (!groupMicroHoldings || query) {
    return {
      visibleHoldings: matched,
      microHoldingsCount: 0,
      microHoldingsTotalNZD: 0,
      microHoldingsWeight: 0,
    };
  }

  const primary: ConsolidatedHolding[] = [];
  let microCount = 0;
  let microTotalNZD = 0;
  let microTotalWeight = 0;
  let microTotalEquityWeight = 0;

  for (const h of matched) {
    if (h.portfolioWeight >= MICRO_HOLDING_THRESHOLD) {
      primary.push(h);
    } else {
      microCount++;
      microTotalNZD += h.valueNZD;
      microTotalWeight += h.portfolioWeight;
      microTotalEquityWeight += h.equityWeight;
    }
  }

  if (microCount > 0) {
    primary.push({
      isin: "MICRO_HOLDINGS_AGGREGATE",
      name: `Other Micro-Holdings (${microCount.toLocaleString()} companies < 0.01% each)`,
      ticker: "MICRO",
      country: "Global",
      sector: "All 11 Sectors",
      valueNZD: microTotalNZD,
      portfolioWeight: microTotalWeight,
      equityWeight: microTotalEquityWeight,
      sources: [],
    });
  }

  return {
    visibleHoldings: primary,
    microHoldingsCount: microCount,
    microHoldingsTotalNZD: microTotalNZD,
    microHoldingsWeight: microTotalWeight,
  };
}

