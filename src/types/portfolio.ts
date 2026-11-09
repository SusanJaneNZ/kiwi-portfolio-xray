/**
 * Portfolio look-through and calculation data models.
 */

export interface Constituent {
  isin: string;
  name: string;
  ticker?: string;
  country: string;
  sector: string;
  weight: number;
}

export interface FundMetadata {
  code: string;
  name: string;
  provider: string;
  effective_date: string;
  cash_ratio: number;
  hedging_ratio: number;
  constituent_count: number;
  cadence?: string;
  is_stale?: boolean;
}

export interface DirectHolding {
  isin: string;
  name: string;
  ticker: string;
  exchange: "NZX" | "ASX";
  country: string;
  sector: string;
  currency: "NZD" | "AUD";
  value: number; // Value in local currency
}

export interface ContributingSource {
  sourceType: "fund" | "direct";
  fundCode?: string;
  fundName?: string;
  valueNZD: number;
  weightInFund?: number;
  effectiveDate?: string;
}

export interface ConsolidatedHolding {
  isin: string;
  name: string;
  ticker: string;
  country: string;
  sector: string;
  valueNZD: number;
  portfolioWeight: number; // Pi = Ei / D
  equityWeight: number; // Ei / TotalEquitiesNZD
  sources: ContributingSource[];
}

export interface SubCategorySegment {
  name: string;
  valueNZD: number;
  percentage: number; // Within parent category
}

export interface CategoryBreakdown {
  name: string;
  valueNZD: number;
  portfolioPercentage: number;
  subcategories: SubCategorySegment[];
}

export interface LiquidityBreakdown {
  totalPortfolioNZD: number;
  totalEquitiesNZD: number;
  totalCashNZD: number;
  totalHedgingNZD: number;
  equitiesPercentage: number;
  cashPercentage: number;
  hedgingPercentage: number;
}

export interface FreshnessEnvelope {
  minEffectiveDate: string;
  maxEffectiveDate: string;
  spreadDays: number;
  isAnyStale: boolean;
}

export interface UserPortfolioState {
  version: number;
  timestamp: string;
  audNzdRate: number;
  fundBalances: Record<string, number>; // fundCode -> NZD value
  directHoldings: DirectHolding[];
}

