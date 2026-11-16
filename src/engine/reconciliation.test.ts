/**
 * Cross-Engine & Cross-Panel Reconciliation Test Suite.
 *
 * Reconciles financial figures, tax assessments, asset class allocations,
 * and drawdown flows across:
 * - Panel 1 / 3: Portfolio Input (Funds, Direct Equities, Fixed Interest / Term Deposits)
 * - Panel 2: Look-Through Aggregation & Macro Exposure
 * - Panel 4: Bucket Split & Minimum-Turnover Rebalancer
 * - Panel 5: Projected Organic Cashflow & Progressive Tax Engine
 */

import { calculatePortfolioLookthrough } from "./lookthrough";
import { calculateBucketRebalance } from "./rebalance";
import {
  calculateNzIncomeTax,
  calculateRetirementCashflow,
} from "./income";
import {
  Constituent,
  DirectHolding,
  FixedInterestHolding,
  FundMetadata,
  PortfolioBucket,
  UserPortfolioState,
} from "../types/portfolio";

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, msg: string): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`${msg}: expected ${expected} (±${tolerance}), got ${actual} (diff: ${diff})`);
  }
}

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export const reconciliationTestCases: Array<[string, () => void]> = [
  [
    "Reconciliation: Total Portfolio Value is consistent across Inputs, Look-Through, and Bucket Rebalancer",
    () => {
      const audNzdRate = 1.12;

      const directHoldings: DirectHolding[] = [
        {
          isin: "NZFAPE0001S2",
          ticker: "FPH.NZ",
          name: "Fisher & Paykel Healthcare",
          exchange: "NZX",
          currency: "NZD",
          shares: 1000,
          price: 35.5,
          value: 35500,
          country: "New Zealand",
          sector: "Health Care",
        },
        {
          isin: "AU000000BHP4",
          ticker: "BHP.AX",
          name: "BHP Group Limited",
          exchange: "ASX",
          currency: "AUD",
          shares: 500,
          price: 42.0,
          value: 21000, // AUD
          country: "Australia",
          sector: "Materials",
        },
      ];

      const fixedInterest: FixedInterestHolding[] = [
        {
          id: "fi-pie-1",
          name: "ANZ 1-Year PIE TD",
          institution: "ANZ",
          category: "term_deposit",
          taxType: "pie",
          valueNZD: 50000,
          interestRate: 5.2,
          frequency: "maturity",
        },
        {
          id: "fi-bond-1",
          name: "Contact Energy Retail Bond",
          institution: "Contact Energy",
          category: "bond",
          taxType: "rwt",
          valueNZD: 25000,
          interestRate: 6.0,
          frequency: "semi-annual",
        },
      ];

      const fundBalances = {
        FNZ: 40000, // Smartshares NZ Top 50
        USF: 60000, // Smartshares US 500
      };

      const fundsRegistry: FundMetadata[] = [
        {
          code: "FNZ",
          name: "Smartshares NZ Top 50",
          provider: "Smartshares",
          asset_class: "equity",
          effective_date: "2026-09-30",
          cash_ratio: 0,
          hedging_ratio: 0,
          constituent_count: 2,
        },
        {
          code: "USF",
          name: "Smartshares US 500",
          provider: "Smartshares",
          asset_class: "equity",
          effective_date: "2026-09-30",
          cash_ratio: 0,
          hedging_ratio: 0,
          constituent_count: 2,
        },
      ];

      const constituentsMap: Record<string, Constituent[]> = {
        FNZ: [
          { isin: "NZFAPE0001S2", name: "Fisher & Paykel", weight: 0.6, country: "New Zealand", sector: "Health Care", asset_class: "equity" },
          { isin: "NZSPKE0002S1", name: "Spark NZ", weight: 0.4, country: "New Zealand", sector: "Communication Services", asset_class: "equity" },
        ],
        USF: [
          { isin: "US0378331005", name: "Apple Inc.", weight: 0.7, country: "United States", sector: "Information Technology", asset_class: "equity" },
          { isin: "US5949181045", name: "Microsoft Corp", weight: 0.3, country: "United States", sector: "Information Technology", asset_class: "equity" },
        ],
      };

      // 1. Calculate Expected Input Totals
      const expectedFundsNZD = 40000 + 60000;
      const fphValNZD = 35500;
      const bhpValNZD = Math.round(21000 * audNzdRate * 100) / 100; // 23,520
      const expectedDirectNZD = fphValNZD + bhpValNZD;
      const expectedFixedNZD = 50000 + 25000;
      const expectedTotalNZD = expectedFundsNZD + expectedDirectNZD + expectedFixedNZD; // 100k + 59020 + 75k = 234,020

      // 2. Reconcile with Look-Through Engine
      const lookthroughRes = calculatePortfolioLookthrough({
        fundBalances,
        directHoldings,
        fixedInterest,
        audNzdRate,
        fundsRegistry,
        constituentsMap,
      });

      assertEq(lookthroughRes.denominatorD, expectedTotalNZD, "Look-through denominator matches total inputs");
      assertEq(lookthroughRes.liquidity.totalPortfolioNZD, expectedTotalNZD, "Liquidity total invested matches");
      assertEq(lookthroughRes.liquidity.totalTermDepositsNZD + lookthroughRes.liquidity.totalBondsNZD, expectedFixedNZD, "Liquidity fixed interest matches inputs");
      assertEq(lookthroughRes.liquidity.totalEquitiesNZD, expectedFundsNZD + expectedDirectNZD, "Liquidity equities matches funds + direct");

      // 3. Reconcile with Bucket Rebalancer Engine
      const buckets: PortfolioBucket[] = [
        { id: "b-cash", name: "Income / Cash", targetPercent: 30 },
        { id: "b-equity", name: "Core Equities", targetPercent: 70 },
      ];

      const bucketAssignments = {
        "fi:fi-pie-1": "b-cash",
        "fi:fi-bond-1": "b-cash",
        "fund:FNZ": "b-equity",
        "fund:USF": "b-equity",
        "direct:NZFAPE0001S2": "b-equity",
        "direct:AU000000BHP4": "b-equity",
      };

      const rebalanceRes = calculateBucketRebalance({
        buckets,
        bucketAssignments,
        fundBalances,
        directHoldings,
        fixedInterest,
        audNzdRate,
        plannedWithdrawalNZD: 0,
      });

      assertEq(rebalanceRes.totalPortfolioNZD, expectedTotalNZD, "Rebalancer total matches input and look-through");
      const sumBucketCurrent = rebalanceRes.rows.reduce((acc, r) => acc + r.currentNZD, 0);
      assertEq(sumBucketCurrent, expectedTotalNZD, "Sum of bucket allocations equals total portfolio");

      const cashBucket = rebalanceRes.rows.find((r) => r.bucket.id === "b-cash")!;
      assertEq(cashBucket.currentNZD, expectedFixedNZD, "Cash bucket contains exactly fixed interest principal");
    },
  ],

  [
    "Reconciliation: Cashflow Inflow Breakdown, Tax Assessment, and Statutory Bracket Calculations",
    () => {
      // Portfolio with mixed PIE and non-PIE income streams
      const state: UserPortfolioState = {
        version: 2,
        timestamp: "2026-11-16T00:00:00Z",
        audNzdRate: 1.10,
        fundBalances: {
          KERNEL_NZ20: 50000, // Unlisted PIE fund (uses investor PIR)
        },
        directHoldings: [
          {
            isin: "NZCENE0001S6",
            ticker: "CEN.NZ",
            name: "Contact Energy",
            exchange: "NZX",
            currency: "NZD",
            shares: 2000,
            price: 8.5,
            value: 17000,
            country: "New Zealand",
            sector: "Utilities",
            dividendYield: 4.0, // 17,000 * 4% = $680 gross dividend, attaches 28% imputation = $190.40
          },
        ],
        fixedInterest: [
          {
            id: "td-pie",
            name: "Heartland 12M PIE TD",
            institution: "Heartland",
            category: "term_deposit",
            taxType: "pie",
            valueNZD: 100000,
            interestRate: 5.0, // $5,000 gross
            frequency: "maturity",
          },
          {
            id: "td-rwt",
            name: "ANZ 6M Non-PIE TD",
            institution: "ANZ",
            category: "term_deposit",
            taxType: "rwt",
            valueNZD: 40000,
            interestRate: 4.5, // $1,800 gross
            frequency: "maturity",
          },
        ],
        cashDeposits: [],
        buckets: [],
        bucketAssignments: {},
      };

      const res = calculateRetirementCashflow({
        portfolioState: state,
        settings: {
          annualLivingBudget: 60000,
          nzSuperType: "single_alone", // $33,830 gross, $28,600 net "M"
          otherGrossIncomeAnnual: 5000, // consulting / rental
        },
      });

      // 1. Gross Rollup Reconciliation
      // Non-PIE Gross: Super ($33,830) + Other ($5,000) + Non-PIE TD ($1,800) + Direct Shares ($680) = $41,310
      assertEq(res.nzSuperGrossAnnualNZD, 33830, "NZ Super gross matches schedule");
      assertEq(res.otherGrossIncomeAnnualNZD, 5000, "Other gross income matches");
      assertEq(res.nonPieFixedGrossNZD, 1800, "Non-PIE TD gross interest matches");
      assertEq(res.nonPieDividendsGrossNZD, 680, "Direct share dividend gross matches");
      assertEq(res.totalNonPieGrossAnnualNZD, 41310, "Total non-PIE taxable gross matches sum of sources");

      // PIE Gross: PIE TD ($5,000) + Kernel Fund ($50,000 * 2.5% = $1,250) = $6,250
      assertEq(res.pieFixedGrossNZD, 5000, "PIE TD gross matches");
      assertEq(res.pieDividendsGrossNZD, 1250, "Kernel fund gross matches");
      assertEq(res.totalPieGrossNZD, 6250, "Total PIE gross matches sum of PIE sources");

      // 2. PIR Eligibility Reconciliation
      // Total taxable = $41,310 (<= $48,000). Total gross = $41,310 + $6,250 = $47,560 (<= $70,000).
      // Investor strictly qualifies for 17.5% PIR!
      assertEq(res.eligiblePirRate, 0.175, "Eligible PIR defaults to 17.5%");
      assertEq(res.pirRate, 0.175, "Active PIR is 17.5%");

      // PIE Net Reconciliation
      // PIE TD: $5,000 * (1 - 0.175) = $4,125 net
      assertEq(res.pieFixedNetNZD, 4125, "PIE TD net matches 17.5% PIR calculation");
      // Kernel Fund: $1,250 * (1 - 0.175) = $1,031.25 net
      assertEq(res.pieDividendsNetNZD, 1031.25, "Kernel fund net matches 17.5% PIR calculation");
      assertEq(res.totalPieNetNZD, 4125 + 1031.25, "Total PIE net equals sum of PIE net items");

      // 3. Progressive Tax Assessment Reconciliation
      // Taxable income = $41,310.
      // Bracket 1: $15,600 @ 10.5% = $1,638.00
      // Bracket 2: ($41,310 - $15,600) = $25,710 @ 17.5% = $4,499.25
      // Gross tax payable = $1,638.00 + $4,499.25 = $6,137.25
      const expectedGrossTax = calculateNzIncomeTax(41310);
      assertEq(expectedGrossTax, 6137.25, "Progressive statutory tax payable matches IRD brackets");
      assertEq(res.nonPieGrossTaxPayableNZD, 6137.25, "Non-PIE gross tax payable matches");

      // Imputation credits: $680 * 0.28 = $190.40
      assertEq(res.nzImputationCreditsNZD, 190.4, "NZ imputation credits 28% offset matches");

      // Net tax payable: $6,137.25 - $190.40 = $5,946.85
      assertEq(res.nonPieNetTaxPayableNZD, 5946.85, "Net tax payable after imputation credit deduction");

      // Total Non-PIE Net: $41,310 - $5,946.85 = $35,363.15
      assertEq(res.totalNonPieNetNZD, 35363.15, "Total non-PIE net spendable cash matches");

      // 4. Inflow Balance Equation: Total Inflow = Total PIE Net + Total Non-PIE Net
      const expectedTotalInflow = Math.round((res.totalPieNetNZD + res.totalNonPieNetNZD) * 100) / 100;
      assertEq(res.totalRetirementInflowNZD, expectedTotalInflow, "Total inflow matches PIE Net + Non-PIE Net");

      // 5. Asset Class Sum Reconciliation
      // Total Inflows = TDs & Bonds Net + Dividends Net + NZ Super Net + Other Net
      const sumAssetClasses = Math.round(
        (res.totalFixedInterestNetNZD + res.totalDividendsNetNZD + res.nzSuperNetAnnualNZD + res.otherNetIncomeAnnualNZD) * 100
      ) / 100;
      assertClose(sumAssetClasses, res.totalRetirementInflowNZD, 0.02, "Asset class breakdown sums to total inflow");

      // 6. Drawdown Shortfall Reconciliation
      // Living budget: $60,000. Inflow: $40,519.40. Shortfall: $19,480.60
      const expectedShortfall = Math.round((60000 - res.totalRetirementInflowNZD) * 100) / 100;
      assertEq(res.netCapitalDrawdownRequiredNZD, expectedShortfall, "Capital drawdown required matches budget shortfall");
      assertEq(res.isFullyFunded, false, "Marked as not fully funded");
    },
  ],

  [
    "Reconciliation: Couple Taxpayer Income Splitting vs Individual Progressive Taxation",
    () => {
      const state: UserPortfolioState = {
        version: 2,
        timestamp: "2026-11-16T00:00:00Z",
        audNzdRate: 1.10,
        fundBalances: {},
        directHoldings: [],
        fixedInterest: [
          {
            id: "td-1",
            name: "Direct Non-PIE TD",
            institution: "Kiwibank",
            category: "term_deposit",
            taxType: "rwt",
            valueNZD: 1000000,
            interestRate: 6.0, // $60,000 gross interest
            frequency: "maturity",
          },
        ],
        cashDeposits: [],
        buckets: [],
        bucketAssignments: {},
      };

      // 1. Calculate Single Taxpayer tax on $112,050 gross income
      const singleGrossTax = calculateNzIncomeTax(112050);
      assertEq(singleGrossTax, 26854, "Single person tax on $112,050 reaches 33% bracket");

      // 2. Couple Scenario: 2 Taxpayers on $112,050 gross ($52,050 Super couple + $60,000 TD interest)
      // Income splits 50/50 ($56,025 each), keeping both spouses predominantly in lower brackets
      const resCouple = calculateRetirementCashflow({
        portfolioState: state,
        settings: {
          nzSuperType: "couple_both",
        },
      });

      assertEq(resCouple.nonPieTaxpayerCount, 2, "Couple scenario has 2 taxpayers");
      assertEq(resCouple.totalNonPieGrossAnnualNZD, 112050, "Total non-PIE gross is $112,050");

      // Each person: $15,600 @ 10.5% = $1,638
      //              $37,900 @ 17.5% = $6,632.50
      //              $2,525 @ 30.0%  = $757.50
      // Total tax = 2 * $9,028 = $18,056.00
      assertEq(resCouple.nonPieGrossTaxPayableNZD, 18056, "Couple tax splits brackets across 2 spouses");

      // Tax savings from couple progressive bracket utilization = $26,854 - $18,056 = $8,798
      const taxSaving = singleGrossTax - resCouple.nonPieGrossTaxPayableNZD;
      assertEq(taxSaving, 8798, "Income splitting saves exactly $8,798 in progressive tax");
    },
  ],

  [
    "Reconciliation: Cashflow Shortfall integrates cleanly into Minimum-Turnover Bucket Rebalancer",
    () => {
      // Investor has 3 buckets: Cash, Balanced, Growth
      const buckets: PortfolioBucket[] = [
        { id: "b1", name: "Cash Reserve", targetPercent: 20 },
        { id: "b2", name: "Fixed Income", targetPercent: 30 },
        { id: "b3", name: "Growth Equities", targetPercent: 50 },
      ];

      const directHoldings: DirectHolding[] = [
        {
          isin: "NZFAPE0001S2",
          ticker: "FPH.NZ",
          name: "Fisher & Paykel",
          exchange: "NZX",
          currency: "NZD",
          shares: 2000,
          price: 30.0,
          value: 60000,
          country: "New Zealand",
          sector: "Health Care",
        },
      ];

      const fixedInterest: FixedInterestHolding[] = [
        {
          id: "td-1",
          name: "Heartland TD",
          institution: "Heartland",
          category: "term_deposit",
          taxType: "pie",
          valueNZD: 40000,
          interestRate: 5.0,
          frequency: "maturity",
        },
      ];

      const fundBalances = {
        TWF: 100000, // Total World Fund
      };

      const bucketAssignments = {
        "fi:td-1": "b1", // $40,000 (currently 20% of 200k)
        "fund:TWF": "b2",   // $100,000 (currently 50% of 200k -> overweight! target is 30%)
        "direct:NZFAPE0001S2": "b3", // $60,000 (currently 30% of 200k -> underweight! target is 50%)
      };

      const state: UserPortfolioState = {
        version: 2,
        timestamp: "2026-11-16T00:00:00Z",
        audNzdRate: 1.10,
        fundBalances,
        directHoldings,
        fixedInterest,
        cashDeposits: [],
        buckets,
        bucketAssignments,
      };

      // 1. Calculate Cashflow Shortfall
      const cashflowRes = calculateRetirementCashflow({
        portfolioState: state,
        settings: {
          annualLivingBudget: 50000,
          nzSuperType: "none",
        },
      });

      const requiredDrawdown = cashflowRes.netCapitalDrawdownRequiredNZD;
      assertTrue(requiredDrawdown > 0, "Capital drawdown is required to meet budget");

      // 2. Feed Required Drawdown directly into Rebalancer
      const rebalanceRes = calculateBucketRebalance({
        buckets,
        bucketAssignments,
        fundBalances,
        directHoldings,
        fixedInterest,
        audNzdRate: 1.10,
        plannedWithdrawalNZD: requiredDrawdown,
      });

      // Total after withdrawal should equal exactly initial portfolio minus required drawdown
      const initialTotal = 200000;
      assertEq(rebalanceRes.totalPortfolioNZD, initialTotal, "Initial total matches");
      assertEq(rebalanceRes.plannedWithdrawalNZD, requiredDrawdown, "Withdrawal matches shortfall");
      assertEq(
        rebalanceRes.postWithdrawalTotalNZD,
        initialTotal - requiredDrawdown,
        "Total after withdrawal matches initial minus drawdown"
      );

      // Verify withdrawal comes strictly from overweight buckets
      for (const r of rebalanceRes.rows) {
        if (r.withdrawNZD > 0) {
          const postTargetDollars = (rebalanceRes.postWithdrawalTotalNZD * r.bucket.targetPercent) / 100;
          assertTrue(r.currentNZD > postTargetDollars, `Bucket ${r.bucket.name} was overweight when drawn from`);
        }
      }

      // Exact Buy/Sell Parity across rebalancing actions
      const totalBuys = rebalanceRes.rows.reduce((acc, r) => acc + r.buyNZD, 0);
      const totalSells = rebalanceRes.rows.reduce((acc, r) => acc + r.sellNZD, 0);
      assertClose(totalBuys, totalSells, 0.01, "Exact buy/sell parity preserved during drawdown rebalance");
    },
  ],
];
