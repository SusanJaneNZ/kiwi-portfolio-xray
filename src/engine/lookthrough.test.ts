/**
 * Look-through, Asset Split, and Cross-Asset Institutional Rollup test suite.
 */

import { calculatePortfolioLookthrough, CalculationInput, resolveDepositIssuer } from "./lookthrough";
import { CashDepositHolding, Constituent, DirectHolding, FundMetadata } from "../types/portfolio";

function assertTrue(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function runLookthroughTests(): void {
  const fundsRegistry: FundMetadata[] = [
    {
      code: "TWF",
      name: "Smartshares Total World ETF",
      provider: "Smartshares",
      effective_date: "2026-10-31",
      cash_ratio: 0.015,
      hedging_ratio: 0.01,
      constituent_count: 2,
      asset_class: "equity",
    },
    {
      code: "NZB",
      name: "Smartshares NZ Bond ETF",
      provider: "Smartshares",
      effective_date: "2026-10-31",
      cash_ratio: 0.02,
      hedging_ratio: 0.0,
      constituent_count: 2,
      asset_class: "fixed_interest",
    },
  ];

  const constituentsMap: Record<string, Constituent[]> = {
    TWF: [
      {
        isin: "US5949181045",
        name: "Microsoft",
        ticker: "MSFT",
        country: "United States",
        sector: "Information Technology",
        weight: 0.60,
        asset_class: "equity",
      },
      {
        isin: "AU000000ANZ3",
        name: "ANZ Group Holdings Limited",
        ticker: "ANZ.AX",
        country: "Australia",
        sector: "Financials",
        weight: 0.375,
        asset_class: "equity",
        issuer_key: "ISSUER_ANZ",
        issuer_name: "ANZ Group",
      },
    ],
    NZB: [
      {
        isin: "BOND:ISSUER_NZ_GOVT",
        name: "New Zealand Government",
        country: "New Zealand",
        sector: "Sovereign",
        weight: 0.68,
        asset_class: "fixed_interest",
        issuer_key: "ISSUER_NZ_GOVT",
        issuer_name: "New Zealand Government",
        tranche_count: 4,
      },
      {
        isin: "BOND:ISSUER_ANZ",
        name: "ANZ Group",
        country: "New Zealand",
        sector: "Financial",
        weight: 0.30,
        asset_class: "fixed_interest",
        issuer_key: "ISSUER_ANZ",
        issuer_name: "ANZ Group",
        tranche_count: 2,
      },
    ],
  };

  const directHoldings: DirectHolding[] = [
    {
      isin: "NZMCYE0001S8",
      name: "Mercury NZ Limited",
      ticker: "MCY.NZ",
      exchange: "NZX",
      country: "New Zealand",
      sector: "Utilities",
      issuer_key: "ISSUER_MCY",
      issuer_name: "Mercury NZ",
      currency: "NZD",
      value: 1000,
    },
    {
      isin: "AU000000BHP4",
      name: "BHP Group Limited",
      ticker: "BHP.AX",
      exchange: "ASX",
      country: "Australia",
      sector: "Materials",
      currency: "AUD",
      value: 1000, // 1100 NZD @ 1.10
    },
  ];

  const cashDeposits: CashDepositHolding[] = [
    {
      id: "td-1",
      depositId: "TD-04192",
      institution: "ANZ",
      label: "6-Month Term Deposit",
      type: "term_deposit",
      valueNZD: 5000,
    },
    {
      id: "cash-1",
      institution: "Kiwibank",
      label: "Call Account",
      type: "cash",
      valueNZD: 2900,
    },
  ];

  const input: CalculationInput = {
    fundBalances: { TWF: 10000, NZB: 10000 },
    directHoldings,
    cashDeposits,
    audNzdRate: 1.10,
    fundsRegistry,
    constituentsMap,
  };

  const res = calculatePortfolioLookthrough(input);

  // Denominator D: 10000 + 10000 + 1000 + 1100 + 5000 + 2900 = 30000
  assertTrue(Math.abs(res.denominatorD - 30000) < 0.01, `D mismatch: ${res.denominatorD}`);

  // Asset Split: Equities = 6000 (US) + 3750 (ANZ) + 1000 (MCY) + 1100 (BHP) = 11850
  assertTrue(Math.abs(res.liquidity.totalEquitiesNZD - 11850) < 0.01, `Equities mismatch: ${res.liquidity.totalEquitiesNZD}`);
  assertTrue(Math.abs(res.liquidity.nzAuEquitiesNZD - 5850) < 0.01, `NZ/AU equities mismatch: ${res.liquidity.nzAuEquitiesNZD}`);
  assertTrue(Math.abs(res.liquidity.intlEquitiesNZD - 6000) < 0.01, `Intl equities mismatch: ${res.liquidity.intlEquitiesNZD}`);
  assertTrue(Math.abs(res.liquidity.totalBondsNZD - 9800) < 0.01, `Bonds mismatch: ${res.liquidity.totalBondsNZD}`);
  assertTrue(Math.abs(res.liquidity.totalTermDepositsNZD - 5000) < 0.01, `TD mismatch: ${res.liquidity.totalTermDepositsNZD}`);
  // Cash = 2900 direct + 150 (TWF) + 200 (NZB) = 3250; Hedging = 100
  assertTrue(Math.abs(res.liquidity.totalCashNZD - 3250) < 0.01, `Cash mismatch: ${res.liquidity.totalCashNZD}`);
  assertTrue(Math.abs(res.liquidity.totalHedgingNZD - 100) < 0.01, `Hedging mismatch: ${res.liquidity.totalHedgingNZD}`);
  assertTrue(Math.abs(res.liquidity.growthPercentage + res.liquidity.defensivePercentage - 100) < 0.01, "Growth+Defensive != 100%");

  // Sector breakdown strictly scoped to Equities = 100%
  const totalSectorPct = res.sectorBreakdown.reduce((acc, s) => acc + s.portfolioPercentage, 0);
  assertTrue(Math.abs(totalSectorPct - 100) < 0.01, `Sector pct sum mismatch: ${totalSectorPct}`);
  assertTrue(!res.sectorBreakdown.some((s) => s.name === "Sovereign"), "Sovereign leaked into equity sector breakdown");

  // ANZ cross-asset rollup: 3750 Equity + 3000 Bond + 5000 TD = 11750 across 3 asset classes
  const anzRollup = res.issuerRollup.find((r) => r.issuerKey === "ISSUER_ANZ");
  if (!anzRollup) throw new Error("Missing ANZ rollup entry");
  assertTrue(Math.abs(anzRollup.equityNZD - 3750) < 0.01, `ANZ equity mismatch: ${anzRollup.equityNZD}`);
  assertTrue(Math.abs(anzRollup.bondNZD - 3000) < 0.01, `ANZ bond mismatch: ${anzRollup.bondNZD}`);
  assertTrue(Math.abs(anzRollup.depositNZD - 5000) < 0.01, `ANZ deposit mismatch: ${anzRollup.depositNZD}`);
  assertTrue(Math.abs(anzRollup.totalNZD - 11750) < 0.01, `ANZ total mismatch: ${anzRollup.totalNZD}`);
  assertTrue(anzRollup.assetClassCount === 3, `Expected 3 ANZ asset classes, got ${anzRollup.assetClassCount}`);

  // Bank alias word-boundary check: "Allianz" must NOT resolve to ISSUER_ANZ
  const allianz = resolveDepositIssuer("Allianz");
  assertTrue(allianz.issuerKey !== "ISSUER_ANZ", `False bank alias match: ${allianz.issuerKey}`);
  const anz = resolveDepositIssuer("ANZ Bank New Zealand");
  assertTrue(anz.issuerKey === "ISSUER_ANZ", `Expected ISSUER_ANZ, got ${anz.issuerKey}`);

  // Invalid audNzdRate (<= 0) falls back cleanly instead of dropping ASX direct holdings
  const badFxRes = calculatePortfolioLookthrough({ ...input, audNzdRate: -1 });
  assertTrue(badFxRes.denominatorD > 29000, "ASX holding should not be dropped on invalid audNzdRate");

  // Empty portfolio edge case (D = 0)
  const emptyRes = calculatePortfolioLookthrough({
    fundBalances: {},
    directHoldings: [],
    cashDeposits: [],
    audNzdRate: 1.10,
    fundsRegistry: input.fundsRegistry,
    constituentsMap: input.constituentsMap,
  });
  assertTrue(emptyRes.denominatorD === 0, "denominatorD is 0");
  assertTrue(emptyRes.holdings.length === 0, "no holdings");
  assertTrue(emptyRes.liquidity.growthPercentage === 0, "growthPercentage safe 0");
  assertTrue(emptyRes.liquidity.defensivePercentage === 0, "defensivePercentage safe 0");

  // Custom bank fallback slug resolution
  const customBank = resolveDepositIssuer("My Custom Credit Union");
  assertTrue(customBank.issuerKey.startsWith("DEPOSIT_"), "slug starts with DEPOSIT_");
  assertTrue(customBank.issuerName === "My Custom Credit Union", "name preserved");
}
