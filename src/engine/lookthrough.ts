/**
 * Core Look-Through Aggregation & Calculation Engine.
 */

import {
  CategoryBreakdown,
  ConsolidatedHolding,
  Constituent,
  DirectHolding,
  FundMetadata,
  LiquidityBreakdown,
  SubCategorySegment,
} from "../types/portfolio";

export interface CalculationInput {
  fundBalances: Record<string, number>; // fundCode -> NZD balance (Bf)
  directHoldings: DirectHolding[]; // direct shares
  audNzdRate: number; // custom user FX rate (e.g. 1.10)
  fundsRegistry: FundMetadata[];
  constituentsMap: Record<string, Constituent[]>;
}

export interface CalculationResult {
  denominatorD: number;
  liquidity: LiquidityBreakdown;
  holdings: ConsolidatedHolding[];
  sectorBreakdown: CategoryBreakdown[];
  countryBreakdown: CategoryBreakdown[];
}

export function calculatePortfolioLookthrough(input: CalculationInput): CalculationResult {
  const { fundBalances, directHoldings, audNzdRate, fundsRegistry, constituentsMap } = input;

  const fundMetaMap = new Map<string, FundMetadata>();
  for (const fm of fundsRegistry) {
    fundMetaMap.set(fm.code, fm);
  }

  // 1. Calculate Denominator D and direct holdings in NZD
  let sumBf = 0;
  for (const balance of Object.values(fundBalances)) {
    if (balance > 0) {
      sumBf += balance;
    }
  }

  let sumDirectNZD = 0;
  const directNZDValues: { holding: DirectHolding; valueNZD: number }[] = [];
  for (const dh of directHoldings) {
    const valueNZD = dh.currency === "AUD" ? dh.value * audNzdRate : dh.value;
    if (valueNZD > 0) {
      sumDirectNZD += valueNZD;
      directNZDValues.push({ holding: dh, valueNZD });
    }
  }

  const denominatorD = sumBf + sumDirectNZD;

  // 2. Segregate Cash and Hedging Contracts
  let totalCashNZD = 0;
  let totalHedgingNZD = 0;

  for (const [code, balance] of Object.entries(fundBalances)) {
    if (balance > 0) {
      const meta = fundMetaMap.get(code);
      if (meta) {
        totalCashNZD += balance * (meta.cash_ratio || 0);
        totalHedgingNZD += balance * Math.max(0, meta.hedging_ratio || 0);
      }
    }
  }

  const totalEquitiesNZD = Math.max(0, denominatorD - totalCashNZD - totalHedgingNZD);

  const liquidity: LiquidityBreakdown = {
    totalPortfolioNZD: denominatorD,
    totalEquitiesNZD,
    totalCashNZD,
    totalHedgingNZD,
    equitiesPercentage: denominatorD > 0 ? (totalEquitiesNZD / denominatorD) * 100 : 0,
    cashPercentage: denominatorD > 0 ? (totalCashNZD / denominatorD) * 100 : 0,
    hedgingPercentage: denominatorD > 0 ? (totalHedgingNZD / denominatorD) * 100 : 0,
  };

  if (denominatorD <= 0) {
    return {
      denominatorD: 0,
      liquidity,
      holdings: [],
      sectorBreakdown: [],
      countryBreakdown: [],
    };
  }

  // 3. Consolidate Company Exposure by Canonical ISIN
  const holdingsMap = new Map<string, ConsolidatedHolding>();

  // A. Ingest from funds
  for (const [fundCode, balance] of Object.entries(fundBalances)) {
    if (balance <= 0) continue;
    const constituents = constituentsMap[fundCode] || [];
    const meta = fundMetaMap.get(fundCode);

    for (const c of constituents) {
      const isin = c.isin || `SYNTH_${c.ticker || c.name}`;
      const exposureNZD = balance * c.weight;

      let record = holdingsMap.get(isin);
      if (!record) {
        record = {
          isin,
          name: c.name,
          ticker: c.ticker || "",
          country: c.country || "Global",
          sector: c.sector || "Unclassified",
          valueNZD: 0,
          portfolioWeight: 0,
          equityWeight: 0,
          sources: [],
        };
        holdingsMap.set(isin, record);
      }

      record.valueNZD += exposureNZD;
      record.sources.push({
        sourceType: "fund",
        fundCode,
        fundName: meta?.name || fundCode,
        valueNZD: exposureNZD,
        weightInFund: c.weight,
        effectiveDate: meta?.effective_date,
      });
    }
  }

  // B. Ingest direct holdings
  for (const { holding, valueNZD } of directNZDValues) {
    const isin = holding.isin || `SYNTH_${holding.ticker}`;
    let record = holdingsMap.get(isin);
    if (!record) {
      record = {
        isin,
        name: holding.name,
        ticker: holding.ticker,
        country: holding.country,
        sector: holding.sector,
        valueNZD: 0,
        portfolioWeight: 0,
        equityWeight: 0,
        sources: [],
      };
      holdingsMap.set(isin, record);
    }

    record.valueNZD += valueNZD;
    record.sources.push({
      sourceType: "direct",
      valueNZD,
      effectiveDate: new Date().toISOString().split("T")[0],
    });
  }

  // Compute final weights and sort descending by valueNZD
  const consolidatedHoldings = Array.from(holdingsMap.values()).map((h) => {
    h.portfolioWeight = h.valueNZD / denominatorD;
    h.equityWeight = totalEquitiesNZD > 0 ? h.valueNZD / totalEquitiesNZD : 0;
    // Sort sources descending by value
    h.sources.sort((a, b) => b.valueNZD - a.valueNZD);
    return h;
  });

  consolidatedHoldings.sort((a, b) => b.valueNZD - a.valueNZD);

  // 4. Compute Macro Sector Breakdown (broken down by Country subcategories)
  const sectorMap = new Map<string, { total: number; countryMap: Map<string, number> }>();
  // 5. Compute Macro Country Breakdown (broken down by Sector subcategories)
  const countryMap = new Map<string, { total: number; sectorMap: Map<string, number> }>();

  for (const h of consolidatedHoldings) {
    const sector = h.sector || "Unclassified";
    const country = h.country || "Global";

    // Sector breakdown
    if (!sectorMap.has(sector)) {
      sectorMap.set(sector, { total: 0, countryMap: new Map() });
    }
    const secEntry = sectorMap.get(sector)!;
    secEntry.total += h.valueNZD;
    secEntry.countryMap.set(country, (secEntry.countryMap.get(country) || 0) + h.valueNZD);

    // Country breakdown
    if (!countryMap.has(country)) {
      countryMap.set(country, { total: 0, sectorMap: new Map() });
    }
    const ctryEntry = countryMap.get(country)!;
    ctryEntry.total += h.valueNZD;
    ctryEntry.sectorMap.set(sector, (ctryEntry.sectorMap.get(sector) || 0) + h.valueNZD);
  }

  const sectorBreakdown: CategoryBreakdown[] = Array.from(sectorMap.entries())
    .map(([secName, data]) => {
      const subcategories: SubCategorySegment[] = Array.from(data.countryMap.entries())
        .map(([ctryName, val]) => ({
          name: ctryName,
          valueNZD: val,
          percentage: data.total > 0 ? (val / data.total) * 100 : 0,
        }))
        .sort((a, b) => b.valueNZD - a.valueNZD);

      return {
        name: secName,
        valueNZD: data.total,
        portfolioPercentage: (data.total / denominatorD) * 100,
        subcategories,
      };
    })
    .sort((a, b) => b.valueNZD - a.valueNZD);

  const countryBreakdown: CategoryBreakdown[] = Array.from(countryMap.entries())
    .map(([ctryName, data]) => {
      const subcategories: SubCategorySegment[] = Array.from(data.sectorMap.entries())
        .map(([secName, val]) => ({
          name: secName,
          valueNZD: val,
          percentage: data.total > 0 ? (val / data.total) * 100 : 0,
        }))
        .sort((a, b) => b.valueNZD - a.valueNZD);

      return {
        name: ctryName,
        valueNZD: data.total,
        portfolioPercentage: (data.total / denominatorD) * 100,
        subcategories,
      };
    })
    .sort((a, b) => b.valueNZD - a.valueNZD);

  return {
    denominatorD,
    liquidity,
    holdings: consolidatedHoldings,
    sectorBreakdown,
    countryBreakdown,
  };
}

