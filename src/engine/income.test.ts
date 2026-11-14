/**
 * Test suite for Organic Retirement Income & Cashflow Engine.
 */

import {
  calculateFixedInterestItem,
  calculateRetirementCashflow,
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

      // 2. Corporate Bond: $50,000 at 6.0% with 33% standard RWT
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
      const bondResult = calculateFixedInterestItem(corpBond, 0.33);
      assertEq(bondResult.grossAnnualNZD, 3000, "Bond gross coupon");
      assertEq(bondResult.effectiveTaxRate, 0.33, "Bond effective tax rate");
      assertEq(bondResult.netAnnualNZD, 2010, "Bond net coupon (3000 * 0.67)");
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

      // Case 1: Living budget = $80,000 with Couple NZ Super ($44,000)
      const res1 = calculateRetirementCashflow({
        portfolioState: mockState,
        settings: {
          annualLivingBudget: 80000,
          nzSuperType: "couple_both",
          nzSuperCustomAnnual: 0,
          otherIncomeAnnual: 10000, // e.g. rental income
          marginalTaxRate: 0.33,
        },
      });

      assertEq(res1.nzSuperAnnualNZD, 44000, "NZ Super couple amount");
      assertEq(res1.otherIncomeAnnualNZD, 10000, "Other income amount");
      assertEq(res1.totalExternalIncomeNZD, 54000, "Total external income");
      assertEq(res1.totalFixedInterestGrossNZD, 5000, "Gross fixed interest");
      assertEq(res1.totalFixedInterestNetNZD, 3600, "Net fixed interest");
      assertTrue(res1.totalDividendsGrossNZD > 6000, "Gross dividends calculated");

      // Total retirement inflow > 60k
      assertTrue(res1.totalRetirementInflowNZD > 60000, "Total retirement inflow includes external + organic");
      assertEq(res1.netCapitalDrawdownRequiredNZD, Math.max(0, 80000 - res1.totalRetirementInflowNZD), "Drawdown math");

      // Case 2: Surplus situation (budget lower than guaranteed income + organic)
      const res2 = calculateRetirementCashflow({
        portfolioState: mockState,
        settings: {
          annualLivingBudget: 50000,
          nzSuperType: "couple_both", // $44,000
          nzSuperCustomAnnual: 0,
          otherIncomeAnnual: 20000,   // $20,000 -> external alone is $64k
          marginalTaxRate: 0.33,
        },
      });

      assertTrue(res2.isFullyFunded, "Portfolio is fully funded");
      assertEq(res2.netCapitalDrawdownRequiredNZD, 0, "Zero capital drawdown needed");
      assertTrue(res2.surplusDeficitNZD > 0, "Positive surplus exists");
    },
  ],
];
