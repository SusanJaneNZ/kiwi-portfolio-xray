/**
 * Organic Retirement Income & Cashflow Projection Engine.
 *
 * In retirement decumulation, spending is funded first from natural cashflows
 * (dividends + interest + pensions). Only the net shortfall requires capital liquidation.
 */

import {
  DEFAULT_CASHFLOW_SETTINGS,
  FixedInterestHolding,
  FundMetadata,
  NZSuperType,
  RetirementCashflowSettings,
  UserPortfolioState,
} from "../types/portfolio";
import { directHoldingValueNZD } from "../utils/format";

export interface NzSuperRateMeta {
  gross: number;
  netM: number;
}

export const NZ_SUPER_RATES: Record<NZSuperType, NzSuperRateMeta> = {
  none: { gross: 0, netM: 0 },
  single_alone: { gross: 33830, netM: 28600 },
  single_sharing: { gross: 31230, netM: 26400 },
  couple_both: { gross: 52050, netM: 44000 },
  custom: { gross: 0, netM: 0 },
};

export const NZ_SUPER_ANNUAL_RATES: Record<NZSuperType, number> = {
  none: 0,
  single_alone: 28600,     // ~$550 / week net
  single_sharing: 26400,   // ~$508 / week net
  couple_both: 44000,      // ~$846 / week net combined
  custom: 0,
};

/** Default dividend & distribution yields for common NZX equities and ETFs (as of 2026). */
export const DEFAULT_DIVIDEND_YIELDS: Record<string, number> = {
  // Common Smartshares ETFs
  DIV: 5.5,
  ASD: 5.5,
  NPF: 5.2,
  NZB: 5.0,
  AGG: 4.8,
  GBF: 4.5,
  FNZ: 3.2,
  TNZ: 3.5,
  MDZ: 2.8,
  MZY: 3.5,
  ASF: 4.2,
  AUS: 3.8,
  TWF: 2.0,
  USF: 1.5,
  USM: 1.6,
  USS: 1.6,
  EUF: 2.8,
  APA: 2.6,
  EMF: 2.2,
  ESG: 1.8,
  ASIA: 1.8,
  // Key NZX Equities
  CEN: 5.2,
  SPK: 6.8,
  MCY: 4.8,
  MEL: 4.6,
  IFT: 1.8,
  AIA: 2.8,
  FPH: 1.8,
  EBO: 3.2,
  CNU: 5.8,
  GNE: 6.5,
  VHP: 5.6,
  KPG: 6.2,
  ARG: 6.4,
  RYM: 0.0,
  SUM: 1.5,
  OCA: 0.0,
  POT: 2.6,
  WHS: 4.5,
  BGP: 6.0,
};

export interface FixedInterestCashflowItem {
  id: string;
  name: string;
  institution: string;
  category: 'term_deposit' | 'bond' | 'cash';
  taxType: 'rwt' | 'pie';
  principalNZD: number;
  interestRate: number;
  effectiveTaxRate: number;
  grossAnnualNZD: number;
  netAnnualNZD: number;
  frequency: string;
  maturityDate?: string;
  termMonths?: number;
  termFactor: number;
  isTermAdjusted: boolean;
}

export interface DividendCashflowItem {
  key: string;
  label: string;
  ticker?: string;
  kind: 'direct' | 'fund';
  valueNZD: number;
  shares?: number;
  currency: 'NZD' | 'AUD';
  yieldPercent: number;
  isOverride: boolean;
  grossAnnualNZD: number;
  estimatedNetAnnualNZD: number;
  isPie: boolean;
}

export interface RetirementCashflowResult {
  settings: RetirementCashflowSettings;
  fixedInterestItems: FixedInterestCashflowItem[];
  dividendItems: DividendCashflowItem[];

  // Fixed Interest Rollups
  totalFixedInterestPrincipalNZD: number;
  totalFixedInterestGrossNZD: number;
  totalFixedInterestNetNZD: number;

  // Equities & Funds Rollups
  totalEquitiesValueNZD: number;
  totalDividendsGrossNZD: number;
  totalDividendsNetNZD: number;

  // Combined Organic Portfolio Inflows
  totalOrganicGrossNZD: number;
  totalOrganicNetNZD: number;

  // External Guaranteed Income
  nzSuperGrossAnnualNZD: number;
  nzSuperNetAnnualNZD: number;
  nzSuperAnnualNZD: number;
  otherGrossIncomeAnnualNZD: number;
  otherNetIncomeAnnualNZD: number;
  otherIncomeAnnualNZD: number;
  totalExternalGrossIncomeNZD: number;
  totalExternalIncomeNZD: number;

  // Total Retirement Cashflow (Net)
  totalRetirementInflowNZD: number;
  annualLivingBudgetNZD: number;

  // PIE vs Non-PIE Breakdown of Net Inflows
  totalPieNetNZD: number;
  totalNonPieNetNZD: number;
  pieFixedNetNZD: number;
  pieDividendsNetNZD: number;
  nonPieFixedNetNZD: number;
  nonPieDividendsNetNZD: number;
  pieInflowPercent: number;
  nonPieInflowPercent: number;

  // Relative to Living Budget
  pieBudgetPercent: number;
  nonPieBudgetPercent: number;
  drawdownBudgetPercent: number;

  // Net Capital Drawdown Required
  netCapitalDrawdownRequiredNZD: number;
  surplusDeficitNZD: number;
  isFullyFunded: boolean;
  coverageRatioPercent: number;
}

/**
 * Parses term length in months from description or name (e.g. "6M PIE TD", "12 Month Term Deposit").
 */
export function parseTermMonthsFromName(name: string): number | undefined {
  const clean = name.trim();
  // Match "6M", "6 Month", "6 Months", "9mo"
  const mMatch = clean.match(/\b(\d+)\s*m(?:onth|o)?s?\b/i);
  if (mMatch) {
    const val = parseInt(mMatch[1], 10);
    if (val > 0 && val <= 120) return val;
  }
  // Match "1 Year", "2 Years", "1 YR", "1yr"
  const yrMatch = clean.match(/\b(\d+)\s*(?:year|yr)s?\b/i);
  if (yrMatch) {
    const val = parseInt(yrMatch[1], 10);
    if (val > 0 && val <= 10) return val * 12;
  }
  return undefined;
}

/**
 * Calculates 12-month forward interest for a single Fixed Interest holding,
 * assuming current term deposits and bonds rollover at their stated annual rates.
 * PIE deposits apply the investor's PIR rate (10.5%, 17.5%, or 28%).
 * Non-PIE deposits and bonds apply the investor's personal marginal tax rate.
 */
export function calculateFixedInterestItem(
  holding: FixedInterestHolding,
  marginalTaxRate: number = 0.33,
  pirRate: number = 0.28
): FixedInterestCashflowItem {
  const principalNZD = Math.max(0, holding.valueNZD || 0);
  const interestRate = Math.max(0, holding.interestRate ?? 0);
  const grossAnnualNZD = Math.round((principalNZD * (interestRate / 100)) * 100) / 100;

  // Effective tax rate: PIE uses investor's PIR (10.5%, 17.5%, 28%), standard RWT uses marginal rate
  let effectiveTaxRate: number;
  if (holding.category === 'bond' || holding.taxType === 'rwt') {
    effectiveTaxRate = marginalTaxRate;
  } else {
    // If holding has specific legacy pirRate, use it; otherwise use investor's global PIR
    effectiveTaxRate = holding.pirRate ?? pirRate;
  }

  const netAnnualNZD = Math.round((grossAnnualNZD * (1 - effectiveTaxRate)) * 100) / 100;

  return {
    id: holding.id,
    name: holding.name || holding.label || 'Fixed Interest',
    institution: holding.institution || 'Bank / Issuer',
    category: holding.category || 'term_deposit',
    taxType: holding.taxType || 'rwt',
    principalNZD,
    interestRate,
    effectiveTaxRate,
    grossAnnualNZD,
    netAnnualNZD,
    frequency: holding.frequency || 'maturity',
    maturityDate: holding.maturityDate,
    termFactor: 1.0,
    isTermAdjusted: false,
  };
}

/**
 * Resolves the effective dividend yield for a direct holding or fund.
 */
export function resolveEffectiveDividendYield(
  tickerOrCode: string,
  userOverride?: number,
  directHoldingYield?: number,
  fallbackYield: number = 3.0
): { yieldPercent: number; isOverride: boolean } {
  // 1. Direct explicit override in cashflow settings
  if (userOverride !== undefined && !isNaN(userOverride) && userOverride >= 0) {
    return { yieldPercent: userOverride, isOverride: true };
  }
  // 2. Direct holding property
  if (directHoldingYield !== undefined && !isNaN(directHoldingYield) && directHoldingYield >= 0) {
    return { yieldPercent: directHoldingYield, isOverride: true };
  }
  // 3. Known catalog / ETF default yield
  const cleanCode = tickerOrCode.replace(/\.(NZ|AX)$/i, '').toUpperCase();
  if (cleanCode in DEFAULT_DIVIDEND_YIELDS) {
    return { yieldPercent: DEFAULT_DIVIDEND_YIELDS[cleanCode], isOverride: false };
  }
  // 4. Fallback generic yield
  return { yieldPercent: fallbackYield, isOverride: false };
}

/**
 * Calculates complete 12-month forward retirement cashflow and net drawdown requirement.
 */
export function calculateRetirementCashflow(params: {
  portfolioState: UserPortfolioState;
  settings?: Partial<RetirementCashflowSettings>;
  fundsRegistry?: FundMetadata[];
}): RetirementCashflowResult {
  const { portfolioState, fundsRegistry = [] } = params;
  const settings: RetirementCashflowSettings = {
    ...DEFAULT_CASHFLOW_SETTINGS,
    ...(portfolioState.cashflowSettings || {}),
    ...(params.settings || {}),
  };

  const audNzdRate = portfolioState.audNzdRate || 1.10;
  const fixedList = portfolioState.fixedInterest || portfolioState.cashDeposits || [];
  const overrides = settings.dividendYieldOverrides || {};
  const pirRate = settings.pirRate ?? portfolioState.pirRate ?? 0.28;

  // 1. Fixed Interest Items (PIE TDs use investor's global PIR; non-PIE & bonds use marginal tax rate)
  const fixedInterestItems: FixedInterestCashflowItem[] = fixedList.map((h) =>
    calculateFixedInterestItem(h, settings.marginalTaxRate, pirRate)
  );

  const totalFixedInterestPrincipalNZD = fixedInterestItems.reduce((acc, i) => acc + i.principalNZD, 0);
  const totalFixedInterestGrossNZD = fixedInterestItems.reduce((acc, i) => acc + i.grossAnnualNZD, 0);
  const totalFixedInterestNetNZD = fixedInterestItems.reduce((acc, i) => acc + i.netAnnualNZD, 0);

  // 2. Equity Dividends & Listed ETFs
  const dividendItems: DividendCashflowItem[] = [];

  for (const dh of portfolioState.directHoldings || []) {
    const valNZD = directHoldingValueNZD(dh, audNzdRate);
    if (valNZD <= 0) continue;

    const key = `direct:${dh.isin}`;
    const tickerBase = (dh.ticker || dh.isin).replace(/\.(NZ|AX)$/i, '').toUpperCase();
    const { yieldPercent, isOverride } = resolveEffectiveDividendYield(
      tickerBase,
      overrides[tickerBase] ?? overrides[key],
      dh.dividendYield
    );

    const grossAnnualNZD = Math.round((valNZD * (yieldPercent / 100)) * 100) / 100;
    const isPie = Boolean(dh.isEtf || dh.fundCode);

    let estimatedNetAnnualNZD: number;
    if (isPie) {
      // Listed PIE ETF (e.g. Smartshares) - tax capped at max 28% PIR inside fund
      estimatedNetAnnualNZD = Math.round((grossAnnualNZD * (1 - 0.28)) * 100) / 100;
    } else if (dh.country === 'New Zealand') {
      // NZ Direct Equity (with 28% company imputation credits attached)
      // Top-up tax = (marginalRate - 0.28). If marginal rate is below 28%, investor receives refund
      const topUpTax = settings.marginalTaxRate - 0.28;
      estimatedNetAnnualNZD = Math.round((grossAnnualNZD * (1 - topUpTax)) * 100) / 100;
    } else {
      // Foreign / ASX Direct Equity (taxed at investor's full personal marginal tax rate)
      estimatedNetAnnualNZD = Math.round((grossAnnualNZD * (1 - settings.marginalTaxRate)) * 100) / 100;
    }

    dividendItems.push({
      key,
      label: dh.name || dh.ticker,
      ticker: dh.ticker,
      kind: 'direct',
      valueNZD: valNZD,
      shares: dh.shares,
      currency: dh.currency,
      yieldPercent,
      isOverride,
      grossAnnualNZD,
      estimatedNetAnnualNZD,
      isPie,
    });
  }

  // 3. Unlisted Pooled Funds
  const registryByCode = new Map(fundsRegistry.map((f) => [f.code.toUpperCase(), f]));

  for (const [code, balance] of Object.entries(portfolioState.fundBalances || {})) {
    if (balance <= 0) continue;
    const cleanCode = code.toUpperCase();
    const fundMeta = registryByCode.get(cleanCode);
    const key = `fund:${code}`;

    const defaultFundYield = fundMeta?.asset_class === 'fixed_interest' ? 4.5 : 2.5;
    const { yieldPercent, isOverride } = resolveEffectiveDividendYield(
      cleanCode,
      overrides[cleanCode] ?? overrides[key],
      undefined,
      defaultFundYield
    );

    const grossAnnualNZD = Math.round((balance * (yieldPercent / 100)) * 100) / 100;
    // Multi-rate PIE funds (e.g. Kernel, InvestNow) deduct tax at the investor's selected PIR (10.5%, 17.5%, or 28%)
    const estimatedNetAnnualNZD = Math.round((grossAnnualNZD * (1 - pirRate)) * 100) / 100;

    dividendItems.push({
      key,
      label: fundMeta?.name || code,
      kind: 'fund',
      valueNZD: balance,
      currency: 'NZD',
      yieldPercent,
      isOverride,
      grossAnnualNZD,
      estimatedNetAnnualNZD,
      isPie: true,
    });
  }

  const totalEquitiesValueNZD = dividendItems.reduce((acc, i) => acc + i.valueNZD, 0);
  const totalDividendsGrossNZD = dividendItems.reduce((acc, i) => acc + i.grossAnnualNZD, 0);
  const totalDividendsNetNZD = dividendItems.reduce((acc, i) => acc + i.estimatedNetAnnualNZD, 0);

  // 4. Combined Organic Portfolio Inflows
  const totalOrganicGrossNZD = Math.round((totalFixedInterestGrossNZD + totalDividendsGrossNZD) * 100) / 100;
  const totalOrganicNetNZD = Math.round((totalFixedInterestNetNZD + totalDividendsNetNZD) * 100) / 100;

  // 5. External Guaranteed Income
  const superRateMeta = NZ_SUPER_RATES[settings.nzSuperType] || { gross: 0, netM: 0 };
  const nzSuperGrossAnnualNZD =
    settings.nzSuperType === 'custom'
      ? Math.max(0, settings.nzSuperCustomAnnual || 0)
      : superRateMeta.gross;

  const nzSuperNetAnnualNZD =
    settings.nzSuperType === 'custom'
      ? Math.max(0, settings.nzSuperCustomAnnual || 0)
      : superRateMeta.netM;

  const otherGrossIncomeAnnualNZD = Math.max(
    0,
    settings.otherGrossIncomeAnnual ?? settings.otherIncomeAnnual ?? 0
  );

  // Other gross income (rental property, foreign pension, consulting) taxed at investor's personal marginal rate
  const otherNetIncomeAnnualNZD = Math.round(
    (otherGrossIncomeAnnualNZD * (1 - settings.marginalTaxRate)) * 100
  ) / 100;

  const totalExternalGrossIncomeNZD = Math.round((nzSuperGrossAnnualNZD + otherGrossIncomeAnnualNZD) * 100) / 100;
  const totalExternalIncomeNZD = Math.round((nzSuperNetAnnualNZD + otherNetIncomeAnnualNZD) * 100) / 100;

  // Backwards compatibility aliases
  const nzSuperAnnualNZD = nzSuperNetAnnualNZD;
  const otherIncomeAnnualNZD = otherNetIncomeAnnualNZD;

  // 6. Net Retirement Cashflow & Drawdown Calculation
  const totalRetirementInflowNZD = Math.round((totalOrganicNetNZD + totalExternalIncomeNZD) * 100) / 100;
  const annualLivingBudgetNZD = Math.max(0, settings.annualLivingBudget || 0);

  const surplusDeficitNZD = Math.round((totalRetirementInflowNZD - annualLivingBudgetNZD) * 100) / 100;
  const netCapitalDrawdownRequiredNZD = Math.max(0, -surplusDeficitNZD);
  const isFullyFunded = surplusDeficitNZD >= 0;
  const coverageRatioPercent =
    annualLivingBudgetNZD > 0
      ? Math.round((totalRetirementInflowNZD / annualLivingBudgetNZD) * 1000) / 10
      : 100;

  // 7. PIE vs Non-PIE Split Calculation
  const pieFixedNetNZD = Math.round(
    fixedInterestItems.filter((i) => i.taxType === 'pie').reduce((acc, i) => acc + i.netAnnualNZD, 0) * 100
  ) / 100;

  const pieDividendsNetNZD = Math.round(
    dividendItems.filter((i) => i.isPie).reduce((acc, i) => acc + i.estimatedNetAnnualNZD, 0) * 100
  ) / 100;

  const totalPieNetNZD = Math.round((pieFixedNetNZD + pieDividendsNetNZD) * 100) / 100;

  const nonPieFixedNetNZD = Math.round(
    fixedInterestItems.filter((i) => i.taxType !== 'pie').reduce((acc, i) => acc + i.netAnnualNZD, 0) * 100
  ) / 100;

  const nonPieDividendsNetNZD = Math.round(
    dividendItems.filter((i) => !i.isPie).reduce((acc, i) => acc + i.estimatedNetAnnualNZD, 0) * 100
  ) / 100;

  const totalNonPieNetNZD = Math.round(
    (nonPieFixedNetNZD + nonPieDividendsNetNZD + totalExternalIncomeNZD) * 100
  ) / 100;

  const safeInflow = totalRetirementInflowNZD > 0 ? totalRetirementInflowNZD : 1;
  const pieInflowPercent = Math.round((totalPieNetNZD / safeInflow) * 1000) / 10;
  const nonPieInflowPercent = Math.round((totalNonPieNetNZD / safeInflow) * 1000) / 10;

  const safeBudget = annualLivingBudgetNZD > 0 ? annualLivingBudgetNZD : 1;
  const pieBudgetPercent = Math.min(100, Math.round((totalPieNetNZD / safeBudget) * 1000) / 10);
  const nonPieBudgetPercent = Math.min(
    Math.max(0, 100 - pieBudgetPercent),
    Math.round((totalNonPieNetNZD / safeBudget) * 1000) / 10
  );
  const drawdownBudgetPercent = Math.max(
    0,
    Math.round((100 - (pieBudgetPercent + nonPieBudgetPercent)) * 10) / 10
  );

  return {
    settings,
    fixedInterestItems,
    dividendItems,
    totalFixedInterestPrincipalNZD,
    totalFixedInterestGrossNZD,
    totalFixedInterestNetNZD,
    totalEquitiesValueNZD,
    totalDividendsGrossNZD,
    totalDividendsNetNZD,
    totalOrganicGrossNZD,
    totalOrganicNetNZD,
    nzSuperGrossAnnualNZD,
    nzSuperNetAnnualNZD,
    nzSuperAnnualNZD,
    otherGrossIncomeAnnualNZD,
    otherNetIncomeAnnualNZD,
    otherIncomeAnnualNZD,
    totalExternalGrossIncomeNZD,
    totalExternalIncomeNZD,
    totalRetirementInflowNZD,
    annualLivingBudgetNZD,
    totalPieNetNZD,
    totalNonPieNetNZD,
    pieFixedNetNZD,
    pieDividendsNetNZD,
    nonPieFixedNetNZD,
    nonPieDividendsNetNZD,
    pieInflowPercent,
    nonPieInflowPercent,
    pieBudgetPercent,
    nonPieBudgetPercent,
    drawdownBudgetPercent,
    netCapitalDrawdownRequiredNZD,
    surplusDeficitNZD,
    isFullyFunded,
    coverageRatioPercent,
  };
}
