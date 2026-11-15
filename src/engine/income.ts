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

export interface TaxBracket {
  threshold: number;
  cap: number;
  rate: number;
}

/** Official New Zealand Individual Income Tax Brackets (effective 31 July 2024 onwards) */
export const NZ_INCOME_TAX_BRACKETS: TaxBracket[] = [
  { threshold: 0, cap: 15600, rate: 0.105 },
  { threshold: 15600, cap: 53500, rate: 0.175 },
  { threshold: 53500, cap: 78100, rate: 0.30 },
  { threshold: 78100, cap: 180000, rate: 0.33 },
  { threshold: 180000, cap: Infinity, rate: 0.39 },
];

/**
 * Calculates progressive New Zealand individual income tax across official statutory brackets.
 */
export function calculateNzIncomeTax(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (const b of NZ_INCOME_TAX_BRACKETS) {
    if (taxableIncome > b.threshold) {
      const taxableInBracket = Math.min(taxableIncome, b.cap) - b.threshold;
      tax += taxableInBracket * b.rate;
    }
  }
  return Math.round(tax * 100) / 100;
}

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
  imputationCreditsNZD?: number;
}

export interface RetirementCashflowResult {
  settings: RetirementCashflowSettings;
  fixedInterestItems: FixedInterestCashflowItem[];
  dividendItems: DividendCashflowItem[];

  // Fixed Interest Rollups
  totalFixedInterestPrincipalNZD: number;
  totalFixedInterestGrossNZD: number;
  totalFixedInterestNetNZD: number;
  pieFixedGrossNZD: number;
  pieFixedNetNZD: number;
  nonPieFixedGrossNZD: number;
  nonPieFixedNetNZD: number;

  // Equities & Funds Rollups
  totalEquitiesValueNZD: number;
  totalDividendsGrossNZD: number;
  totalDividendsNetNZD: number;
  pieDividendsGrossNZD: number;
  pieDividendsNetNZD: number;
  nonPieDividendsGrossNZD: number;
  nonPieDividendsNetNZD: number;

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

  // Progressive Personal Tax on Non-PIE Income
  totalNonPieGrossAnnualNZD: number;
  nonPieTaxpayerCount: number;
  nonPieGrossTaxPayableNZD: number;
  nzImputationCreditsNZD: number;
  nonPieNetTaxPayableNZD: number;
  effectivePersonalTaxRate: number;

  // Total Retirement Cashflow (Net)
  totalRetirementInflowNZD: number;
  annualLivingBudgetNZD: number;

  // PIE vs Non-PIE Breakdown of Net Inflows
  totalPieGrossNZD: number;
  totalPieNetNZD: number;
  totalNonPieNetNZD: number;
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
 * Non-PIE deposits and bonds are reported at gross interest (their tax is calculated
 * globally in the investor's progressive personal tax brackets).
 */
export function calculateFixedInterestItem(
  holding: FixedInterestHolding,
  marginalOrPirRate?: number,
  optionalPirRate?: number
): FixedInterestCashflowItem {
  const principalNZD = Math.max(0, holding.valueNZD || 0);
  const interestRate = Math.max(0, holding.interestRate ?? 0);
  const grossAnnualNZD = Math.round((principalNZD * (interestRate / 100)) * 100) / 100;
  const isPie = holding.category !== 'bond' && holding.taxType === 'pie';

  // Determine effective PIR rate:
  let pirRate = 0.28;
  if (optionalPirRate !== undefined) {
    pirRate = optionalPirRate;
  } else if (marginalOrPirRate !== undefined && (marginalOrPirRate === 0.105 || marginalOrPirRate === 0.175 || marginalOrPirRate === 0.28)) {
    pirRate = marginalOrPirRate;
  }

  // Effective tax rate: PIE uses investor's PIR (10.5%, 17.5%, 28%).
  // Non-PIE is 0% at source because it is taxed progressively at year-end across personal tax brackets.
  const effectiveTaxRate = isPie ? (holding.pirRate ?? pirRate) : 0;
  const netAnnualNZD = isPie
    ? Math.round((grossAnnualNZD * (1 - effectiveTaxRate)) * 100) / 100
    : grossAnnualNZD;

  return {
    id: holding.id,
    name: holding.name || holding.label || 'Fixed Interest',
    institution: holding.institution || 'Bank / Issuer',
    category: holding.category || 'term_deposit',
    taxType: isPie ? 'pie' : 'rwt',
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
    let imputationCreditsNZD = 0;

    if (isPie) {
      // Listed PIE ETF (e.g. Smartshares on NZX) - tax deducted at source at flat 28% PIR
      estimatedNetAnnualNZD = Math.round((grossAnnualNZD * (1 - 0.28)) * 100) / 100;
    } else {
      // Direct shares: non-PIE gross dividend flows into progressive personal tax brackets
      estimatedNetAnnualNZD = grossAnnualNZD;
      if (dh.country === 'New Zealand') {
        // NZ company dividends carry 28% imputation credits to offset personal income tax
        imputationCreditsNZD = Math.round((grossAnnualNZD * 0.28) * 100) / 100;
      }
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
      imputationCreditsNZD,
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
      imputationCreditsNZD: 0,
    });
  }

  const totalEquitiesValueNZD = dividendItems.reduce((acc, i) => acc + i.valueNZD, 0);
  const totalDividendsGrossNZD = Math.round(dividendItems.reduce((acc, i) => acc + i.grossAnnualNZD, 0) * 100) / 100;

  // 4. External Guaranteed Inflows (Gross)
  const superRateMeta = NZ_SUPER_RATES[settings.nzSuperType] || { gross: 0, netM: 0 };
  const nzSuperGrossAnnualNZD =
    settings.nzSuperType === 'custom'
      ? Math.max(0, settings.nzSuperCustomAnnual || 0)
      : superRateMeta.gross;

  const otherGrossIncomeAnnualNZD = Math.max(
    0,
    settings.otherGrossIncomeAnnual ?? settings.otherIncomeAnnual ?? 0
  );

  const totalExternalGrossIncomeNZD = Math.round((nzSuperGrossAnnualNZD + otherGrossIncomeAnnualNZD) * 100) / 100;

  // 5. Non-PIE Gross Inflows & Progressive Personal Income Tax
  const nonPieFixedGrossNZD = Math.round(
    fixedInterestItems.filter((i) => i.taxType !== 'pie').reduce((acc, i) => acc + i.grossAnnualNZD, 0) * 100
  ) / 100;

  const nonPieDividendsGrossNZD = Math.round(
    dividendItems.filter((i) => !i.isPie).reduce((acc, i) => acc + i.grossAnnualNZD, 0) * 100
  ) / 100;

  const totalNonPieGrossAnnualNZD = Math.round(
    (nzSuperGrossAnnualNZD + otherGrossIncomeAnnualNZD + nonPieFixedGrossNZD + nonPieDividendsGrossNZD) * 100
  ) / 100;

  // Taxpayer count: 2 if couple_both (split income across spouses for progressive brackets), 1 otherwise
  const nonPieTaxpayerCount = settings.nzSuperType === 'couple_both' ? 2 : 1;
  const taxablePerPerson = totalNonPieGrossAnnualNZD / nonPieTaxpayerCount;
  const grossTaxPerPerson = calculateNzIncomeTax(taxablePerPerson);
  const nonPieGrossTaxPayableNZD = Math.round((grossTaxPerPerson * nonPieTaxpayerCount) * 100) / 100;

  // NZ company dividends attach 28% imputation credits to offset personal tax
  const nzImputationCreditsNZD = Math.round(
    dividendItems.reduce((acc, i) => acc + (i.imputationCreditsNZD || 0), 0) * 100
  ) / 100;

  const nonPieNetTaxPayableNZD = Math.max(
    0,
    Math.round((nonPieGrossTaxPayableNZD - nzImputationCreditsNZD) * 100) / 100
  );

  const effectivePersonalTaxRate =
    totalNonPieGrossAnnualNZD > 0
      ? Math.round((nonPieNetTaxPayableNZD / totalNonPieGrossAnnualNZD) * 1000) / 10
      : 0;

  // Net Non-PIE Spendable Cash
  const totalNonPieNetNZD = Math.max(
    0,
    Math.round((totalNonPieGrossAnnualNZD - nonPieNetTaxPayableNZD) * 100) / 100
  );

  // Pro-rate net cashflow among non-PIE streams for reporting
  const nonPieNetFactor = totalNonPieGrossAnnualNZD > 0 ? totalNonPieNetNZD / totalNonPieGrossAnnualNZD : 1;
  const nonPieFixedNetNZD = Math.round((nonPieFixedGrossNZD * nonPieNetFactor) * 100) / 100;
  const nonPieDividendsNetNZD = Math.round((nonPieDividendsGrossNZD * nonPieNetFactor) * 100) / 100;
  const nzSuperNetAnnualNZD = Math.round((nzSuperGrossAnnualNZD * nonPieNetFactor) * 100) / 100;
  const otherNetIncomeAnnualNZD = Math.round((otherGrossIncomeAnnualNZD * nonPieNetFactor) * 100) / 100;
  const totalExternalIncomeNZD = Math.round((nzSuperNetAnnualNZD + otherNetIncomeAnnualNZD) * 100) / 100;

  // Backwards compatibility aliases
  const nzSuperAnnualNZD = nzSuperNetAnnualNZD;
  const otherIncomeAnnualNZD = otherNetIncomeAnnualNZD;

  // 6. PIE Income (Tax Deducted at Source)
  const pieFixedGrossNZD = Math.round(
    fixedInterestItems.filter((i) => i.taxType === 'pie').reduce((acc, i) => acc + i.grossAnnualNZD, 0) * 100
  ) / 100;
  const pieFixedNetNZD = Math.round(
    fixedInterestItems.filter((i) => i.taxType === 'pie').reduce((acc, i) => acc + i.netAnnualNZD, 0) * 100
  ) / 100;

  const pieDividendsGrossNZD = Math.round(
    dividendItems.filter((i) => i.isPie).reduce((acc, i) => acc + i.grossAnnualNZD, 0) * 100
  ) / 100;
  const pieDividendsNetNZD = Math.round(
    dividendItems.filter((i) => i.isPie).reduce((acc, i) => acc + i.estimatedNetAnnualNZD, 0) * 100
  ) / 100;

  const totalPieGrossNZD = Math.round((pieFixedGrossNZD + pieDividendsGrossNZD) * 100) / 100;
  const totalPieNetNZD = Math.round((pieFixedNetNZD + pieDividendsNetNZD) * 100) / 100;

  // Rollup totals
  const totalDividendsNetNZD = Math.round((pieDividendsNetNZD + nonPieDividendsNetNZD) * 100) / 100;
  const totalFixedInterestNetNZD = Math.round((pieFixedNetNZD + nonPieFixedNetNZD) * 100) / 100;
  const totalOrganicGrossNZD = Math.round((totalFixedInterestGrossNZD + totalDividendsGrossNZD) * 100) / 100;
  const totalOrganicNetNZD = Math.round((totalFixedInterestNetNZD + totalDividendsNetNZD) * 100) / 100;

  // 7. Combined Retirement Cashflow & Drawdown
  const totalRetirementInflowNZD = Math.round((totalPieNetNZD + totalNonPieNetNZD) * 100) / 100;
  const annualLivingBudgetNZD = Math.max(0, settings.annualLivingBudget || 0);

  const surplusDeficitNZD = Math.round((totalRetirementInflowNZD - annualLivingBudgetNZD) * 100) / 100;
  const netCapitalDrawdownRequiredNZD = Math.max(0, -surplusDeficitNZD);
  const isFullyFunded = surplusDeficitNZD >= 0;
  const coverageRatioPercent =
    annualLivingBudgetNZD > 0
      ? Math.round((totalRetirementInflowNZD / annualLivingBudgetNZD) * 1000) / 10
      : 100;

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
    totalNonPieGrossAnnualNZD,
    nonPieTaxpayerCount,
    nonPieGrossTaxPayableNZD,
    nzImputationCreditsNZD,
    nonPieNetTaxPayableNZD,
    effectivePersonalTaxRate,
    totalRetirementInflowNZD,
    annualLivingBudgetNZD,
    totalPieGrossNZD,
    totalPieNetNZD,
    totalNonPieNetNZD,
    pieFixedGrossNZD,
    pieFixedNetNZD,
    pieDividendsGrossNZD,
    pieDividendsNetNZD,
    nonPieFixedGrossNZD,
    nonPieFixedNetNZD,
    nonPieDividendsGrossNZD,
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
