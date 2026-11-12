/**
 * Portfolio look-through, asset split, and bucket rebalancing data models (v2).
 */

export type AssetClass = "equity" | "fixed_interest" | "term_deposit";
export type FundAssetClass = "equity" | "fixed_interest" | "mixed";

export interface Constituent {
  isin: string;
  name: string;
  ticker?: string;
  country: string;
  sector: string;
  weight: number;
  asset_class: AssetClass;
  issuer_key?: string;
  issuer_name?: string;
  tranche_count?: number;
}

export interface FundMetadata {
  code: string;
  name: string;
  provider: string;
  effective_date: string;
  cash_ratio: number;
  hedging_ratio: number;
  constituent_count: number;
  asset_class: FundAssetClass;
  cadence?: string;
  is_stale?: boolean;
}

export interface DirectEquityCatalogItem {
  isin: string;
  name: string;
  ticker: string;
  exchange: "NZX" | "ASX";
  country: string;
  sector: string;
  issuer_key?: string;
  issuer_name?: string;
}

export interface DirectHolding extends DirectEquityCatalogItem {
  currency: "NZD" | "AUD";
  value: number; // Value in local currency
}

export interface CashDepositHolding {
  id: string;
  depositId?: string;
  institution: string;
  label: string;
  type: "term_deposit" | "cash";
  valueNZD: number;
  maturityDate?: string;
  interestRate?: number;
}

export interface PortfolioBucket {
  id: string;
  name: string;
  targetPercent: number;
}

// Key format: "fund:<fundCode>" | "direct:<isin>" | "td:<cashDeposit.id>"
export type BucketAssignmentMap = Record<string, string>;

export interface ContributingSource {
  sourceType: "fund" | "direct" | "deposit";
  fundCode?: string;
  fundName?: string;
  depositId?: string;
  assetClass?: AssetClass;
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
  assetClass: AssetClass;
  issuerKey?: string;
  issuerName?: string;
  trancheCount?: number;
  valueNZD: number;
  portfolioWeight: number; // Pi = Ei / D
  equityWeight: number; // Ei / TotalEquitiesNZD (0 for non-equities)
  sources: ContributingSource[];
}

export interface IssuerRollupEntry {
  issuerKey: string;
  issuerName: string;
  equityNZD: number;
  bondNZD: number;
  depositNZD: number;
  totalNZD: number;
  portfolioWeight: number;
  assetClassCount: number;
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
  /** Percentage of total equities (totalEquitiesNZD), summing to 100 across equity categories. */
  portfolioPercentage: number;
  subcategories: SubCategorySegment[];
}

export interface LiquidityBreakdown {
  totalPortfolioNZD: number;
  totalEquitiesNZD: number;
  nzAuEquitiesNZD: number;
  intlEquitiesNZD: number;
  totalBondsNZD: number;
  totalTermDepositsNZD: number;
  totalCashNZD: number;
  totalHedgingNZD: number;
  equitiesPercentage: number;
  nzAuEquitiesPercentage: number;
  intlEquitiesPercentage: number;
  bondsPercentage: number;
  termDepositsPercentage: number;
  cashPercentage: number;
  hedgingPercentage: number;
  growthPercentage: number;
  defensivePercentage: number;
}

export interface FreshnessEnvelope {
  minEffectiveDate: string;
  maxEffectiveDate: string;
  spreadDays: number;
  isAnyStale: boolean;
}

export interface AssignedHoldingSummary {
  key: string;
  label: string;
  valueNZD: number;
  kind: "fund" | "direct" | "deposit";
}

export interface BucketAllocationRow {
  bucket: PortfolioBucket;
  currentNZD: number;
  currentAssignedPercent: number;
  currentPortfolioPercent: number;
  driftPercent: number;
  withdrawNZD: number;
  sellNZD: number;
  buyNZD: number;
  postBalanceNZD: number;
  postPercent: number;
  action: "buy" | "sell" | "hold";
  assignedHoldings: AssignedHoldingSummary[];
  hasTermDeposits: boolean;
}

export interface BucketRebalanceResult {
  isValid: boolean;
  errorReason?: string;
  targetSumPercent: number;
  totalPortfolioNZD: number;
  totalAssignedNZD: number;
  totalUnassignedNZD: number;
  unassignedHoldings: AssignedHoldingSummary[];
  plannedWithdrawalNZD: number;
  postWithdrawalTotalNZD: number;
  totalSellNZD: number;
  totalBuyNZD: number;
  rebalanceRequired: boolean;
  rows: BucketAllocationRow[];
}

export interface UserPortfolioState {
  version: 2;
  timestamp: string;
  audNzdRate: number;
  fundBalances: Record<string, number>;
  directHoldings: DirectHolding[];
  cashDeposits: CashDepositHolding[];
  buckets: PortfolioBucket[];
  bucketAssignments: BucketAssignmentMap;
}
