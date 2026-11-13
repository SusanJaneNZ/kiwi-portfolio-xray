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
  isEtf?: boolean;
  fundCode?: string;
}

export interface DirectHolding extends DirectEquityCatalogItem {
  currency: "NZD" | "AUD";
  shares: number; // Mandatory discrete share/unit count
  units?: number; // Alias for discrete share/unit count
  price: number; // Native unit price (NZD or AUD)
  value: number; // Local currency worth: shares * price (read-only)
  isEtf?: boolean; // Flag indicating this listed asset is an ETF with underlying constituents
  fundCode?: string; // Links to fund_holdings.json if isEtf === true
}

export type FixedInterestCategory = "term_deposit" | "bond" | "cash";
export type FixedInterestTaxType = "rwt" | "pie";
export type PaymentFrequency = "monthly" | "quarterly" | "semi-annual" | "annual" | "maturity";

export interface FixedInterestHolding {
  id: string;
  institution: string; // Issuer / Bank (e.g. "Contact Energy", "Heartland Bank", "ANZ")
  name: string; // Description / Label (e.g. "CEN060 5.80% 2028", "12M PIE Term Deposit")
  category: FixedInterestCategory;
  taxType: FixedInterestTaxType; // 'rwt' or 'pie' (bonds are strictly 'rwt')
  pirRate?: 0.105 | 0.175 | 0.28; // Applicable when category !== 'bond' && taxType === 'pie'
  valueNZD: number; // Principal / Face value in NZD
  interestRate?: number; // Annual coupon or interest rate % (e.g. 5.80)
  maturityDate?: string; // YYYY-MM-DD
  frequency?: PaymentFrequency; // Payment cadence
  depositId?: string; // Optional account / reference code
  issuerKey?: string; // Canonical issuer key (e.g. "ISSUER_CEN") for corporate bonds
  // Backward compatibility alias for legacy code referencing .label or .type
  label?: string;
  type?: "term_deposit" | "cash";
}

// Backward-compatible alias for existing consumers
export type CashDepositHolding = FixedInterestHolding;

export interface PortfolioBucket {
  id: string;
  name: string;
  targetPercent: number;
}

export const DEFAULT_STARTER_BUCKETS: PortfolioBucket[] = [
  { id: "bkt-growth", name: "Growth", targetPercent: 60 },
  { id: "bkt-high-div", name: "High Div Yield", targetPercent: 20 },
  { id: "bkt-bonds", name: "Bonds", targetPercent: 20 },
];

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
  kind: "fund" | "direct" | "deposit" | "bond";
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
  fixedInterest: FixedInterestHolding[];
  cashDeposits: FixedInterestHolding[]; // Mirror alias for backwards compatibility
  buckets: PortfolioBucket[];
  bucketAssignments: BucketAssignmentMap;
}
