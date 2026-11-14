/**
 * Look-through, Asset Split, and Cross-Asset Institutional Rollup test suite.
 */

import { calculatePortfolioLookthrough, CalculationInput, resolveDepositIssuer } from "./lookthrough";
import { Constituent, DirectHolding, FixedInterestHolding, FundMetadata } from "../types/portfolio";

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
      shares: 200,
      price: 5.0,
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
      shares: 20,
      price: 50.0,
      value: 1000, // 1100 NZD @ 1.10
    },
  ];

  const cashDeposits: FixedInterestHolding[] = [
    {
      id: "td-1",
      depositId: "TD-04192",
      institution: "ANZ",
      name: "6-Month Term Deposit",
      label: "6-Month Term Deposit",
      category: "term_deposit",
      type: "term_deposit",
      taxType: "pie",
      pirRate: 0.28,
      valueNZD: 5000,
    },
    {
      id: "cash-1",
      institution: "Kiwibank",
      name: "Call Account",
      label: "Call Account",
      category: "cash",
      type: "cash",
      taxType: "rwt",
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

  // PHASE 1 VERIFICATION: Direct Corporate Bonds & Cross-Asset Issuer Rollup
  const directBondsInput: CalculationInput = {
    fundBalances: {},
    directHoldings: [
      {
        isin: "NZCENE0001S6",
        name: "Contact Energy Limited",
        ticker: "CEN.NZ",
        exchange: "NZX",
        country: "New Zealand",
        sector: "Utilities",
        issuer_key: "ISSUER_CEN",
        issuer_name: "Contact Energy",
        currency: "NZD",
        shares: 1000,
        price: 8.50,
        value: 8500,
      },
    ],
    fixedInterest: [
      {
        id: "bond-cen060",
        depositId: "CEN060",
        institution: "Contact Energy",
        name: "CEN060 5.80% 2028",
        category: "bond",
        taxType: "rwt",
        valueNZD: 15000,
        interestRate: 5.80,
        maturityDate: "2028-04-15",
        frequency: "semi-annual",
      },
      {
        id: "td-heartland",
        depositId: "HLD-01",
        institution: "Heartland",
        name: "Heartland PIE Term Deposit",
        category: "term_deposit",
        taxType: "pie",
        pirRate: 0.175,
        valueNZD: 20000,
        interestRate: 5.25,
      },
    ],
    audNzdRate: 1.10,
    fundsRegistry: input.fundsRegistry,
    constituentsMap: input.constituentsMap,
  };

  const bondRes = calculatePortfolioLookthrough(directBondsInput);
  // Denominator: 8500 (equity) + 15000 (bond) + 20000 (TD) = 43500
  assertTrue(Math.abs(bondRes.denominatorD - 43500) < 0.01, `Bond test D mismatch: ${bondRes.denominatorD}`);
  assertTrue(Math.abs(bondRes.liquidity.totalBondsNZD - 15000) < 0.01, `Direct bond not counted in totalBondsNZD: ${bondRes.liquidity.totalBondsNZD}`);
  assertTrue(Math.abs(bondRes.liquidity.totalTermDepositsNZD - 20000) < 0.01, `TD mismatch: ${bondRes.liquidity.totalTermDepositsNZD}`);

  // Direct bond must appear in bondIssuerHoldings
  const cenBondHolding = bondRes.bondIssuerHoldings.find((b) => b.isin === "CEN060");
  if (!cenBondHolding) throw new Error("Direct corporate bond CEN060 missing from bondIssuerHoldings");
  assertTrue(cenBondHolding.valueNZD === 15000, "CEN060 valueNZD mismatch");
  assertTrue(cenBondHolding.assetClass === "fixed_interest", "CEN060 assetClass is fixed_interest");

  // Contact Energy cross-asset rollup combining equity and bond under ISSUER_CEN
  const cenRollup = bondRes.issuerRollup.find((r) => r.issuerKey === "ISSUER_CEN");
  if (!cenRollup) throw new Error("Contact Energy missing from cross-asset issuerRollup");
  assertTrue(Math.abs(cenRollup.equityNZD - 8500) < 0.01, `CEN equity mismatch: ${cenRollup.equityNZD}`);
  assertTrue(Math.abs(cenRollup.bondNZD - 15000) < 0.01, `CEN bond mismatch: ${cenRollup.bondNZD}`);
  assertTrue(Math.abs(cenRollup.totalNZD - 23500) < 0.01, `CEN total mismatch: ${cenRollup.totalNZD}`);
  assertTrue(cenRollup.assetClassCount === 2, `Expected 2 CEN asset classes (equity + bond), got ${cenRollup.assetClassCount}`);

  // PHASE 1 VERIFICATION: Listed ETF Constituent Unwrapping
  const etfUnwrapInput: CalculationInput = {
    fundBalances: {},
    directHoldings: [
      {
        isin: "NZTWFE0001S9",
        name: "Smartshares Total World ETF",
        ticker: "TWF.NZ",
        exchange: "NZX",
        country: "Global",
        sector: "Unclassified",
        currency: "NZD",
        shares: 2000,
        price: 3.50,
        value: 7000, // 7000 NZD
        isEtf: true,
        fundCode: "TWF",
      },
    ],
    fixedInterest: [],
    audNzdRate: 1.10,
    fundsRegistry: input.fundsRegistry,
    constituentsMap: input.constituentsMap,
  };

  const etfRes = calculatePortfolioLookthrough(etfUnwrapInput);
  // TWF has 60% US Tech, 37.5% ANZ Bank, 1.5% Cash, 1.0% Hedging
  // 7000 * 0.60 = 4200 in US Tech
  // 7000 * 0.375 = 2625 in ANZ Bank
  assertTrue(Math.abs(etfRes.denominatorD - 7000) < 0.01, `ETF test D mismatch: ${etfRes.denominatorD}`);
  const msft = etfRes.holdings.find((h) => h.isin === "US5949181045");
  if (!msft) throw new Error("Listed ETF did not unwrap Microsoft constituent!");
  assertTrue(Math.abs(msft.valueNZD - 4200) < 0.01, `Unwrapped Microsoft value mismatch: ${msft.valueNZD}`);
  assertTrue(msft.sources.length === 1, "Microsoft should have exactly 1 source");
  assertTrue(msft.sources[0].sourceType === "fund", `Expected sourceType 'fund', got ${msft.sources[0].sourceType}`);
  assertTrue(msft.sources[0].fundCode === "TWF", `Expected fundCode 'TWF', got ${msft.sources[0].fundCode}`);
  assertTrue(
    Boolean(msft.sources[0].fundName?.includes("TWF") || msft.sources[0].fundName?.includes("Total World")),
    `Expected fundName to mention TWF or Total World, got ${msft.sources[0].fundName}`
  );
  assertTrue(Math.abs((msft.sources[0].weightInFund || 0) - 0.60) < 0.001, "Weight in fund should be 60%");

  const anzInEtf = etfRes.holdings.find((h) => h.isin === "AU000000ANZ3");
  if (!anzInEtf) throw new Error("Listed ETF did not unwrap ANZ Bank constituent!");
  assertTrue(Math.abs(anzInEtf.valueNZD - 2625) < 0.01, `Unwrapped ANZ value mismatch: ${anzInEtf.valueNZD}`);
  assertTrue(anzInEtf.sources[0].sourceType === "fund", "ANZ source should be 'fund'");
  assertTrue(anzInEtf.sources[0].fundCode === "TWF", "ANZ fundCode should be 'TWF'");

  // Test dual contributing sources: stock held BOTH directly and through an ETF
  const dualSourceInput: CalculationInput = {
    fundBalances: {},
    directHoldings: [
      {
        isin: "NZTWFE0001S9",
        name: "Smartshares Total World ETF",
        ticker: "TWF.NZ",
        exchange: "NZX",
        country: "Global",
        sector: "Unclassified",
        currency: "NZD",
        shares: 2000,
        price: 3.50,
        value: 7000,
        isEtf: true,
        fundCode: "TWF",
      },
      {
        isin: "AU000000ANZ3",
        name: "ANZ Group Holdings Limited",
        ticker: "ANZ.AX",
        exchange: "ASX",
        country: "Australia",
        sector: "Financials",
        currency: "AUD",
        shares: 100,
        price: 30.0,
        value: 3000, // 3300 NZD @ 1.10
      },
    ],
    fixedInterest: [],
    audNzdRate: 1.10,
    fundsRegistry: input.fundsRegistry,
    constituentsMap: input.constituentsMap,
  };

  const dualRes = calculatePortfolioLookthrough(dualSourceInput);
  const dualAnz = dualRes.holdings.find((h) => h.isin === "AU000000ANZ3");
  if (!dualAnz) throw new Error("Dual ANZ holding missing from lookthrough");
  // Total ANZ = 3300 (direct) + 2625 (from TWF ETF) = 5925 NZD
  assertTrue(Math.abs(dualAnz.valueNZD - 5925) < 0.01, `Expected 5925 ANZ total, got ${dualAnz.valueNZD}`);
  assertTrue(dualAnz.sources.length === 2, `Expected 2 sources for dual ANZ, got ${dualAnz.sources.length}`);

  const directSrc = dualAnz.sources.find((s) => s.sourceType === "direct");
  const fundSrc = dualAnz.sources.find((s) => s.sourceType === "fund");
  if (!directSrc) throw new Error("Missing direct source on dual ANZ holding");
  if (!fundSrc) throw new Error("Missing fund source on dual ANZ holding");

  assertTrue(Math.abs(directSrc.valueNZD - 3300) < 0.01, `Direct ANZ value mismatch: ${directSrc.valueNZD}`);
  assertTrue(!directSrc.fundCode, "Direct source must not have a fundCode");

  assertTrue(Math.abs(fundSrc.valueNZD - 2625) < 0.01, `Fund ANZ value mismatch: ${fundSrc.valueNZD}`);
  assertTrue(fundSrc.fundCode === "TWF", `Fund source should have fundCode 'TWF', got ${fundSrc.fundCode}`);
  assertTrue(
    Boolean(fundSrc.fundName?.includes("TWF") || fundSrc.fundName?.includes("Total World")),
    `Fund source should name TWF, got ${fundSrc.fundName}`
  );
}
