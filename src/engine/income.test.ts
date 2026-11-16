/**
 * Test suite for Organic Retirement Income & Cashflow Engine.
 */

import {
  calculateEligiblePirRate,
  calculateFixedInterestItem,
  calculateNzIncomeTax,
  calculateRetirementCashflow,
  parseTermMonthsFromName,
  resolveEffectiveDividendYield,
} from "./income";
import {
  FixedInterestHolding,
  UserPortfolioState,
} from "../types/portfolio";

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export const incomeTestCases: Array<[string, () => void]> = [
  [
    "calculateFixedInterestItem correctly computes gross, tax drag and net for PIE vs RWT",
    () => {
      // 1. PIE Term Deposit: $100,000 at 5.5% with 28% PIR
      const pieTd: FixedInterestHolding = {
        id: "td-pie",
        institution: "Heartland Bank",
        name: "12M PIE TD",
        category: "term_deposit",
        taxType: "pie",
        pirRate: 0.28,
        valueNZD: 100000,
        interestRate: 5.5,
        frequency: "semi-annual",
      };
      const pieResult = calculateFixedInterestItem(pieTd, 0.33);
      assertEq(pieResult.grossAnnualNZD, 5500, "PIE gross annual interest");
      assertEq(pieResult.effectiveTaxRate, 0.28, "PIE effective tax rate");
      assertEq(pieResult.netAnnualNZD, 3960, "PIE net annual interest (5500 * (1 - 0.28))");

      // 2. Corporate Bond: $50,000 at 6.0% (Non-PIE RWT)
      const corpBond: FixedInterestHolding = {
        id: "bond-cen",
        institution: "Contact Energy",
        name: "CEN060 Bond",
        category: "bond",
        taxType: "rwt",
        valueNZD: 50000,
        interestRate: 6.0,
        frequency: "semi-annual",
      };
      const bondResult = calculateFixedInterestItem(corpBond);
      assertEq(bondResult.grossAnnualNZD, 3000, "Bond gross coupon");
      assertEq(bondResult.effectiveTaxRate, 0, "Bond effective tax rate at source is 0 (taxed in brackets)");
      assertEq(bondResult.netAnnualNZD, 3000, "Bond gross flows to non-PIE pool");
    },
  ],

  [
    "parseTermMonthsFromName extracts valid terms from common naming conventions",
    () => {
      assertEq(parseTermMonthsFromName("6M PIE TD"), 6, "6M");
      assertEq(parseTermMonthsFromName("Heartland 9 Month Term Deposit"), 9, "9 Month");
      assertEq(parseTermMonthsFromName("12M Term Deposit"), 12, "12M");
      assertEq(parseTermMonthsFromName("1 Year PIE TD"), 12, "1 Year");
      assertEq(parseTermMonthsFromName("2 Years Bond"), 24, "2 Years");
      assertEq(parseTermMonthsFromName("CEN060 Bond"), undefined, "No term in name");
    },
  ],

  [
    "calculateFixedInterestItem calculates 12-month annual run-rate assuming rollover",
    () => {
      // TD of $100,000 at 5.0%
      const tdHolding: FixedInterestHolding = {
        id: "td-6m",
        institution: "Kiwibank",
        name: "6M PIE Term Deposit",
        category: "term_deposit",
        taxType: "pie",
        pirRate: 0.28,
        valueNZD: 100000,
        interestRate: 5.0,
      };

      const result = calculateFixedInterestItem(tdHolding, 0.33);
      assertEq(result.grossAnnualNZD, 5000, "Earns full 12M annualized ($5,000)");
      assertEq(result.netAnnualNZD, 3600, "Net after 28% PIR ($3,600)");
      assertEq(result.termFactor, 1.0, "Term factor is 1.0");
      assertEq(result.isTermAdjusted, false, "Not term adjusted");
    },
  ],

  [
    "resolveEffectiveDividendYield prioritizes user overrides over catalog defaults",
    () => {
      // Catalog default for DIV is 5.5%
      const defaultDiv = resolveEffectiveDividendYield("DIV");
      assertEq(defaultDiv.yieldPercent, 5.5, "Default DIV yield");
      assertEq(defaultDiv.isOverride, false, "Not an override");

      // Holding property override
      const directOverride = resolveEffectiveDividendYield("DIV", undefined, 6.2);
      assertEq(directOverride.yieldPercent, 6.2, "Direct holding override takes precedence");
      assertEq(directOverride.isOverride, true, "Is an override");

      // Settings override takes highest precedence
      const settingsOverride = resolveEffectiveDividendYield("DIV", 7.0, 6.2);
      assertEq(settingsOverride.yieldPercent, 7.0, "Settings override takes highest precedence");
      assertEq(settingsOverride.isOverride, true, "Is an override");

      // Unknown ticker falls back to 3.0%
      const unknownTicker = resolveEffectiveDividendYield("UNKNOWN.NZ");
      assertEq(unknownTicker.yieldPercent, 3.0, "Fallback generic yield");
    },
  ],

  [
    "calculateRetirementCashflow correctly computes total organic inflows and net drawdown",
    () => {
      const mockState: UserPortfolioState = {
        version: 2,
        timestamp: "2026-11-14T00:00:00Z",
        audNzdRate: 1.10,
        fundBalances: {
          TWF: 100000, // 2.0% default yield -> $2,000 gross
        },
        directHoldings: [
          {
            isin: "NZCENE0001S6",
            ticker: "CEN.NZ",
            name: "Contact Energy",
            exchange: "NZX",
            country: "New Zealand",
            sector: "Utilities",
            currency: "NZD",
            shares: 10000,
            price: 8.50,
            value: 85000, // $85,000 at 5.2% default yield -> $4,420 gross
          },
        ],
        fixedInterest: [
          {
            id: "td-1",
            institution: "ANZ",
            name: "1-Year PIE TD",
            category: "term_deposit",
            taxType: "pie",
            pirRate: 0.28,
            valueNZD: 100000,
            interestRate: 5.0, // $5,000 gross, $3,600 net
          },
        ],
        cashDeposits: [],
        buckets: [],
        bucketAssignments: {},
      };

      // Case 1: Living budget = $80,000 with Couple NZ Super ($52,050 gross)
      const res1 = calculateRetirementCashflow({
        portfolioState: mockState,
        settings: {
          annualLivingBudget: 80000,
          nzSuperType: "couple_both",
          nzSuperCustomAnnual: 0,
          otherGrossIncomeAnnual: 10000, // e.g. rental income
        },
      });

      assertEq(res1.nzSuperGrossAnnualNZD, 52050, "NZ Super couple gross amount");
      assertEq(res1.otherGrossIncomeAnnualNZD, 10000, "Other gross income amount");
      assertTrue(res1.totalNonPieGrossAnnualNZD > 60000, "Total non-pie gross income includes Super, other, and CEN dividends");
      assertTrue(res1.nonPieGrossTaxPayableNZD > 0, "Tax calculated in progressive brackets");
      assertTrue(res1.nzImputationCreditsNZD > 0, "Imputation credits attached to CEN direct shares");
      assertTrue(res1.totalNonPieNetNZD > 50000, "Total non-pie net cashflow after bracket tax");
      assertEq(res1.totalFixedInterestGrossNZD, 5000, "Gross fixed interest");
      assertEq(res1.totalFixedInterestNetNZD, 3600, "Net fixed interest after 28% PIR");
      assertTrue(res1.totalDividendsGrossNZD > 6000, "Gross dividends calculated");

      // Total retirement inflow > 55k
      assertTrue(res1.totalRetirementInflowNZD > 55000, "Total retirement inflow includes external + organic");
      assertEq(
        res1.netCapitalDrawdownRequiredNZD,
        Math.round(Math.max(0, 80000 - res1.totalRetirementInflowNZD) * 100) / 100,
        "Drawdown math"
      );

      // Verify PIE vs Non-PIE calculations
      assertTrue(res1.totalPieNetNZD > 5000, "PIE net inflow includes PIE TD and pooled fund");
      assertTrue(res1.totalNonPieNetNZD > 50000, "Non-PIE net inflow includes direct share and external income");
      assertEq(
        Math.round((res1.totalPieNetNZD + res1.totalNonPieNetNZD) * 100) / 100,
        res1.totalRetirementInflowNZD,
        "PIE + Non-PIE equals total retirement inflow"
      );

      // Case 2: Surplus situation (budget lower than guaranteed income + organic)
      const res2 = calculateRetirementCashflow({
        portfolioState: mockState,
        settings: {
          annualLivingBudget: 50000,
          nzSuperType: "couple_both",
          nzSuperCustomAnnual: 0,
          otherGrossIncomeAnnual: 20000,
        },
      });

      assertTrue(res2.isFullyFunded, "Portfolio is fully funded");
      assertEq(res2.netCapitalDrawdownRequiredNZD, 0, "Zero capital drawdown needed");
      assertTrue(res2.surplusDeficitNZD > 0, "Positive surplus exists");
    },
  ],

  [
    "calculateRetirementCashflow correctly applies investor global PIR to PIE TDs and unlisted funds while keeping listed ETFs at 28%",
    () => {
      const mockState: UserPortfolioState = {
        version: 2,
        timestamp: "2026-11-14T00:00:00Z",
        audNzdRate: 1.10,
        fundBalances: {
          KERNEL_NZ20: 100000, // 4.0% yield -> $4,000 gross
        },
        directHoldings: [
          {
            isin: "NZSMTE0001S8",
            ticker: "USF.NZ",
            name: "Smartshares US500 (Listed PIE ETF)",
            exchange: "NZX",
            country: "New Zealand",
            sector: "Funds",
            currency: "NZD",
            shares: 10000,
            price: 10.0,
            value: 100000,
            isEtf: true, // Listed ETF: 1.5% yield -> $1,500 gross
          },
        ],
        fixedInterest: [
          {
            id: "td-pie",
            institution: "Kiwibank",
            name: "PIE Term Deposit",
            category: "term_deposit",
            taxType: "pie",
            valueNZD: 100000,
            interestRate: 6.0, // $6,000 gross
          },
        ],
        cashDeposits: [],
        buckets: [],
        bucketAssignments: {},
      };

      // With PIR = 17.5%
      const res = calculateRetirementCashflow({
        portfolioState: mockState,
        settings: {
          annualLivingBudget: 60000,
          nzSuperType: "none",
          nzSuperCustomAnnual: 0,
          otherIncomeAnnual: 0,
          marginalTaxRate: 0.33,
          pirRate: 0.175,
          dividendYieldOverrides: {
            KERNEL_NZ20: 4.0,
            USF: 1.5,
          },
        },
      });

      // 1. PIE TD: $6,000 * (1 - 0.175) = $4,950 net
      assertEq(res.totalFixedInterestNetNZD, 4950, "PIE TD taxed at investor's 17.5% PIR");

      // 2. Unlisted Kernel Fund: $4,000 * (1 - 0.175) = $3,300 net
      const kernelItem = res.dividendItems.find((i) => i.key === "fund:KERNEL_NZ20")!;
      assertEq(kernelItem.estimatedNetAnnualNZD, 3300, "Kernel multi-rate fund taxed at investor's 17.5% PIR");

      // 3. Listed ETF (USF): $1,500 * (1 - 0.28) = $1,080 net (fixed at 28%)
      const usfItem = res.dividendItems.find((i) => i.key.includes("USF") || i.ticker === "USF.NZ")!;
      assertEq(usfItem.estimatedNetAnnualNZD, 1080, "Listed ETF taxed at statutory 28% flat rate");
    },
  ],

  [
    "calculateNzIncomeTax calculates correct progressive tax across all 2024+ NZ statutory brackets",
    () => {
      // Bracket 1: $15,600 @ 10.5% = $1,638.00
      assertEq(calculateNzIncomeTax(15600), 1638.00, "$15,600 tax");

      // Bracket 2: $53,500 = $1,638 + (37,900 * 0.175) = $8,270.50
      assertEq(calculateNzIncomeTax(53500), 8270.50, "$53,500 tax");

      // Bracket 3: $78,100 = $8,270.50 + (24,600 * 0.30) = $15,650.50
      assertEq(calculateNzIncomeTax(78100), 15650.50, "$78,100 tax");

      // Bracket 4: $180,000 = $15,650.50 + (101,900 * 0.33) = $49,277.50
      assertEq(calculateNzIncomeTax(180000), 49277.50, "$180,000 tax");

      // Bracket 5: $200,000 = $49,277.50 + (20,000 * 0.39) = $57,077.50
      assertEq(calculateNzIncomeTax(200000), 57077.50, "$200,000 tax");
    },
  ],

  [
    "calculateEligiblePirRate accurately evaluates NZ IRD 10.5%, 17.5%, and 28% criteria and defaults correctly",
    () => {
      // 10.5% PIR: Taxable <= 14k AND Total <= 48k
      assertEq(calculateEligiblePirRate(10000, 30000), 0.105, "10.5% PIR when low taxable and low total");
      assertEq(calculateEligiblePirRate(14000, 48000), 0.105, "10.5% PIR at boundary");

      // 17.5% PIR: Taxable <= 48k AND Total <= 70k (and not 10.5%)
      assertEq(calculateEligiblePirRate(35000, 55000), 0.175, "17.5% PIR when taxable <= 48k and total <= 70k");
      assertEq(calculateEligiblePirRate(12000, 55000), 0.175, "17.5% PIR when taxable <= 14k but total > 48k");
      assertEq(calculateEligiblePirRate(48000, 70000), 0.175, "17.5% PIR at 70k total boundary");

      // 28.0% PIR: Taxable > 48k OR Total > 70k
      assertEq(calculateEligiblePirRate(50000, 65000), 0.28, "28.0% PIR when taxable > 48k");
      assertEq(calculateEligiblePirRate(30000, 72000), 0.28, "28.0% PIR when total > 70k");

      // Verify calculateRetirementCashflow defaults to eligible PIR when unselected
      const state: UserPortfolioState = {
        version: 2,
        timestamp: "2026-11-15T00:00:00Z",
        audNzdRate: 1.10,
        fundBalances: {},
        directHoldings: [],
        fixedInterest: [
          {
            id: "pie-td-1",
            name: "PIE TD 1",
            institution: "BNZ",
            category: "term_deposit",
            taxType: "pie",
            valueNZD: 100000,
            interestRate: 5.0,
            frequency: "maturity",
          },
        ],
        cashDeposits: [],
        buckets: [],
        bucketAssignments: {},
      };

      // $5,000 PIE TD gross + $25,000 Super net = $30,000 total income (well under $70k total, taxable under $48k)
      const res = calculateRetirementCashflow({
        portfolioState: state,
        settings: {
          annualLivingBudget: 40000,
          nzSuperType: "single_alone",
        },
      });

      assertEq(res.eligiblePirRate, 0.175, "eligible PIR is 17.5% for sub-$70k total income");
      assertEq(res.pirRate, 0.175, "pirRate defaults to eligible 17.5% PIR");
      assertEq(res.totalFixedInterestNetNZD, 4125, "$5,000 gross * (1 - 0.175) = $4,125 net");
    },
  ],
];
