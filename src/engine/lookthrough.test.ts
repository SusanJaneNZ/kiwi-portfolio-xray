/**
 * Look-through calculation engine test suite.
 */

import { calculatePortfolioLookthrough, CalculationInput } from "./lookthrough";
import { Constituent, DirectHolding, FundMetadata } from "../types/portfolio";

export function runLookthroughTests(): void {
  console.log("Running lookthrough engine tests...");

  const fundsRegistry: FundMetadata[] = [
    {
      code: "TWF",
      name: "Smartshares Total World ETF",
      provider: "Smartshares",
      effective_date: "2026-10-31",
      cash_ratio: 0.015,
      hedging_ratio: 0.01,
      constituent_count: 2,
    },
    {
      code: "FNZ",
      name: "Smartshares NZ Top 50 ETF",
      provider: "Smartshares",
      effective_date: "2026-10-31",
      cash_ratio: 0.02,
      hedging_ratio: 0.0,
      constituent_count: 2,
    },
  ];

  const constituentsMap: Record<string, Constituent[]> = {
    TWF: [
      { isin: "US5949181045", name: "Microsoft", ticker: "MSFT", country: "US", sector: "Information Technology", weight: 0.60 },
      { isin: "NZFPHE0001S2", name: "Fisher & Paykel", ticker: "FPH.NZ", country: "NZ", sector: "Health Care", weight: 0.375 },
    ],
    FNZ: [
      { isin: "NZFPHE0001S2", name: "Fisher & Paykel", ticker: "FPH.NZ", country: "NZ", sector: "Health Care", weight: 0.68 },
      { isin: "NZMCYE0001S8", name: "Mercury NZ", ticker: "MCY.NZ", country: "NZ", sector: "Utilities", weight: 0.30 },
    ],
  };

  const directHoldings: DirectHolding[] = [
    {
      isin: "NZMCYE0001S8",
      name: "Mercury NZ",
      ticker: "MCY.NZ",
      exchange: "NZX",
      country: "NZ",
      sector: "Utilities",
      currency: "NZD",
      value: 1000,
    },
    {
      isin: "AU000000BHP4",
      name: "BHP Group",
      ticker: "BHP.AX",
      exchange: "ASX",
      country: "AU",
      sector: "Materials",
      currency: "AUD",
      value: 1000, // at 1.10 rate = 1100 NZD
    },
  ];

  const input: CalculationInput = {
    fundBalances: { TWF: 10000, FNZ: 10000 },
    directHoldings,
    audNzdRate: 1.10,
    fundsRegistry,
    constituentsMap,
  };

  const res = calculatePortfolioLookthrough(input);

  // Expected Denominator D: 10000 (TWF) + 10000 (FNZ) + 1000 (MCY) + 1100 (BHP @ 1.10) = 22100
  if (Math.abs(res.denominatorD - 22100) > 0.01) {
    throw new Error(`Denominator D mismatch: got ${res.denominatorD}, expected 22100`);
  }

  // Expected Cash: TWF (10000 * 0.015 = 150) + FNZ (10000 * 0.02 = 200) = 350
  if (Math.abs(res.liquidity.totalCashNZD - 350) > 0.01) {
    throw new Error(`Cash mismatch: got ${res.liquidity.totalCashNZD}, expected 350`);
  }

  // Expected Hedging: TWF (10000 * 0.01 = 100)
  if (Math.abs(res.liquidity.totalHedgingNZD - 100) > 0.01) {
    throw new Error(`Hedging mismatch: got ${res.liquidity.totalHedgingNZD}, expected 100`);
  }

  // Check Fisher & Paykel aggregation (from both TWF and FNZ):
  // TWF contribution: 10000 * 0.375 = 3750
  // FNZ contribution: 10000 * 0.68 = 6800
  // Total FPH = 3750 + 6800 = 10550
  const fph = res.holdings.find((h) => h.isin === "NZFPHE0001S2");
  if (!fph || Math.abs(fph.valueNZD - 10550) > 0.01) {
    throw new Error(`FPH aggregation mismatch: got ${fph?.valueNZD}, expected 10550`);
  }

  // Check Mercury aggregation (from FNZ + Direct):
  // FNZ contribution: 10000 * 0.30 = 3000
  // Direct contribution: 1000
  // Total MCY = 4000
  const mcy = res.holdings.find((h) => h.isin === "NZMCYE0001S8");
  if (!mcy || Math.abs(mcy.valueNZD - 4000) > 0.01) {
    throw new Error(`Mercury aggregation mismatch: got ${mcy?.valueNZD}, expected 4000`);
  }

  // Check BHP AUD conversion:
  // 1000 AUD * 1.10 = 1100 NZD
  const bhp = res.holdings.find((h) => h.isin === "AU000000BHP4");
  if (!bhp || Math.abs(bhp.valueNZD - 1100) > 0.01) {
    throw new Error(`BHP FX conversion mismatch: got ${bhp?.valueNZD}, expected 1100`);
  }

  console.log("All lookthrough engine tests passed successfully!");
}

