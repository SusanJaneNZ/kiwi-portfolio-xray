/**
 * Core Look-Through Aggregation, Asset Split & Institutional Rollup Engine.
 */

import {
  CashDepositHolding,
  CategoryBreakdown,
  ConsolidatedHolding,
  Constituent,
  DirectHolding,
  FundMetadata,
  IssuerRollupEntry,
  LiquidityBreakdown,
} from "../types/portfolio";

export interface CalculationInput {
  fundBalances: Record<string, number>;
  directHoldings: DirectHolding[];
  cashDeposits: CashDepositHolding[];
  audNzdRate: number;
  fundsRegistry: FundMetadata[];
  constituentsMap: Record<string, Constituent[]>;
}

export interface CalculationResult {
  denominatorD: number;
  liquidity: LiquidityBreakdown;
  holdings: ConsolidatedHolding[]; // Equity look-through holdings (keeps backwards-friendly name)
  bondIssuerHoldings: ConsolidatedHolding[];
  issuerRollup: IssuerRollupEntry[];
  sectorBreakdown: CategoryBreakdown[];
  countryBreakdown: CategoryBreakdown[];
}

const NZ_BANK_ALIAS_RES: { key: string; name: string; regexes: RegExp[] }[] = [
  { key: "ISSUER_ANZ", name: "ANZ Group", regexes: [/\banz\b/i, /\baustralia and new zealand\b/i] },
  { key: "ISSUER_WBC", name: "Westpac Banking Group", regexes: [/\bwestpac\b/i, /\bwbc\b/i] },
  { key: "ISSUER_CBA_ASB", name: "Commonwealth Bank / ASB", regexes: [/\basb\b/i, /\bcommonwealth bank\b/i, /\bcba\b/i] },
  { key: "ISSUER_NAB_BNZ", name: "NAB / Bank of New Zealand", regexes: [/\bbnz\b/i, /\bbank of new zealand\b/i, /\bnab\b/i] },
  { key: "ISSUER_KIWIBANK", name: "Kiwibank", regexes: [/\bkiwibank\b/i, /\bkiwi bank\b/i] },
  { key: "ISSUER_HEARTLAND", name: "Heartland Group", regexes: [/\bheartland\b/i] },
  { key: "ISSUER_RABOBANK", name: "Rabobank", regexes: [/\brabobank\b/i] },
  { key: "ISSUER_TSB", name: "TSB Bank", regexes: [/\btsb bank\b/i, /\btsb nz\b/i, /\btsb\b/i] },
  { key: "ISSUER_SBS", name: "SBS Bank", regexes: [/\bsbs bank\b/i, /\bsouthland building\b/i, /\bsbs\b/i] },
];

export function resolveDepositIssuer(institution: string): { issuerKey: string; issuerName: string } {
  const clean = institution.trim();
  for (const bank of NZ_BANK_ALIAS_RES) {
    if (bank.regexes.some((rx) => rx.test(clean))) {
      return { issuerKey: bank.key, issuerName: bank.name };
    }
  }
  const slug = clean.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "BANK";
  return { issuerKey: `DEPOSIT_${slug}`, issuerName: clean || "Bank Deposit" };
}

function isNzOrAuCountry(country: string): boolean {
  const norm = (country || "").trim().toLowerCase();
  return norm === "new zealand" || norm === "australia" || norm === "nz" || norm === "au";
}

export function calculatePortfolioLookthrough(input: CalculationInput): CalculationResult {
  const { fundBalances, directHoldings, cashDeposits, audNzdRate, fundsRegistry, constituentsMap } = input;
  const safeAudNzdRate = Number.isFinite(audNzdRate) && audNzdRate > 0 ? audNzdRate : 1.10;

  const fundMetaMap = new Map<string, FundMetadata>();
  for (const fm of fundsRegistry) {
    fundMetaMap.set(fm.code, fm);
  }

  // 1. Total Denominator D = sum(Bf) + sum(DirectNZD) + sum(CashDepositsNZD)
  let sumBf = 0;
  for (const balance of Object.values(fundBalances)) {
    if (balance > 0) sumBf += balance;
  }

  let sumDirectNZD = 0;
  const directNZDValues: { holding: DirectHolding; valueNZD: number }[] = [];
  for (const dh of directHoldings) {
    const valueNZD = dh.currency === "AUD" ? dh.value * safeAudNzdRate : dh.value;
    if (valueNZD > 0) {
      sumDirectNZD += valueNZD;
      directNZDValues.push({ holding: dh, valueNZD });
    }
  }

  let directTermDepositsNZD = 0;
  let directCashNZD = 0;
  for (const dep of cashDeposits) {
    if (dep.valueNZD > 0) {
      if (dep.type === "term_deposit") {
        directTermDepositsNZD += dep.valueNZD;
      } else {
        directCashNZD += dep.valueNZD;
      }
    }
  }

  const denominatorD = sumBf + sumDirectNZD + directTermDepositsNZD + directCashNZD;

  // 2. Fund-level Cash & Hedging Reserves
  let fundCashNZD = 0;
  let totalHedgingNZD = 0;
  for (const [code, balance] of Object.entries(fundBalances)) {
    if (balance > 0) {
      const meta = fundMetaMap.get(code);
      if (meta) {
        fundCashNZD += balance * (meta.cash_ratio || 0);
        totalHedgingNZD += balance * Math.max(0, meta.hedging_ratio || 0);
      }
    }
  }
  const totalCashNZD = directCashNZD + fundCashNZD;

  if (denominatorD <= 0) {
    return {
      denominatorD: 0,
      liquidity: {
        totalPortfolioNZD: 0,
        totalEquitiesNZD: 0,
        nzAuEquitiesNZD: 0,
        intlEquitiesNZD: 0,
        totalBondsNZD: 0,
        totalTermDepositsNZD: 0,
        totalCashNZD: 0,
        totalHedgingNZD: 0,
        equitiesPercentage: 0,
        nzAuEquitiesPercentage: 0,
        intlEquitiesPercentage: 0,
        bondsPercentage: 0,
        termDepositsPercentage: 0,
        cashPercentage: 0,
        hedgingPercentage: 0,
        growthPercentage: 0,
        defensivePercentage: 0,
      },
      holdings: [],
      bondIssuerHoldings: [],
      issuerRollup: [],
      sectorBreakdown: [],
      countryBreakdown: [],
    };
  }

  // 3. Unified consolidation across all fund constituents (equity, fixed_interest, term_deposit) and direct equities
  const holdingsMap = new Map<string, ConsolidatedHolding>();

  for (const [fundCode, balance] of Object.entries(fundBalances)) {
    if (balance <= 0) continue;
    const constituents = constituentsMap[fundCode] || [];
    const meta = fundMetaMap.get(fundCode);

    for (const c of constituents) {
      const assetClass = c.asset_class || "equity";
      const isin = c.isin || `SYNTH_${c.ticker || c.name}`;
      const holdingKey = `${assetClass}:${isin}`;
      const exposureNZD = balance * c.weight;

      let record = holdingsMap.get(holdingKey);
      if (!record) {
        record = {
          isin,
          name: c.name,
          ticker: c.ticker || "",
          country: c.country || "Global",
          sector: c.sector || "Unclassified",
          assetClass,
          issuerKey: c.issuer_key,
          issuerName: c.issuer_name,
          trancheCount: c.tranche_count,
          valueNZD: 0,
          portfolioWeight: 0,
          equityWeight: 0,
          sources: [],
        };
        holdingsMap.set(holdingKey, record);
      } else if (c.tranche_count) {
        record.trancheCount = (record.trancheCount || 0) + c.tranche_count;
      }

      record.valueNZD += exposureNZD;
      record.sources.push({
        sourceType: "fund",
        fundCode,
        fundName: meta?.name || fundCode,
        assetClass,
        valueNZD: exposureNZD,
        weightInFund: c.weight,
        effectiveDate: meta?.effective_date,
      });
    }
  }

  for (const { holding, valueNZD } of directNZDValues) {
    const isin = holding.isin || `SYNTH_${holding.ticker}`;
    const holdingKey = `equity:${isin}`;
    let record = holdingsMap.get(holdingKey);
    if (!record) {
      record = {
        isin,
        name: holding.name,
        ticker: holding.ticker,
        country: holding.country,
        sector: holding.sector,
        assetClass: "equity",
        issuerKey: holding.issuer_key,
        issuerName: holding.issuer_name,
        valueNZD: 0,
        portfolioWeight: 0,
        equityWeight: 0,
        sources: [],
      };
      holdingsMap.set(holdingKey, record);
    }

    record.valueNZD += valueNZD;
    record.sources.push({
      sourceType: "direct",
      assetClass: "equity",
      valueNZD,
      effectiveDate: new Date().toISOString().split("T")[0],
    });
  }

  const allHoldings = Array.from(holdingsMap.values());
  let nzAuEquitiesNZD = 0;
  let intlEquitiesNZD = 0;
  let totalBondsNZD = 0;
  let fundTermDepositsNZD = 0;

  for (const h of allHoldings) {
    if (h.assetClass === "equity") {
      if (isNzOrAuCountry(h.country)) {
        nzAuEquitiesNZD += h.valueNZD;
      } else {
        intlEquitiesNZD += h.valueNZD;
      }
    } else if (h.assetClass === "fixed_interest") {
      totalBondsNZD += h.valueNZD;
    } else if (h.assetClass === "term_deposit") {
      fundTermDepositsNZD += h.valueNZD;
    }
  }

  const totalEquitiesNZD = nzAuEquitiesNZD + intlEquitiesNZD;
  const totalTermDepositsNZD = directTermDepositsNZD + fundTermDepositsNZD;

  for (const h of allHoldings) {
    h.portfolioWeight = h.valueNZD / denominatorD;
    h.equityWeight = h.assetClass === "equity" && totalEquitiesNZD > 0 ? h.valueNZD / totalEquitiesNZD : 0;
    h.sources.sort((a, b) => b.valueNZD - a.valueNZD);
  }

  const equityHoldings = allHoldings
    .filter((h) => h.assetClass === "equity")
    .sort((a, b) => b.valueNZD - a.valueNZD);

  const bondIssuerHoldings = allHoldings
    .filter((h) => h.assetClass === "fixed_interest")
    .sort((a, b) => b.valueNZD - a.valueNZD);

  // Normalize Growth vs Defensive cleanly to 100% over classified sum
  const defensiveNZD = totalBondsNZD + totalTermDepositsNZD + totalCashNZD + totalHedgingNZD;
  const splitBase = totalEquitiesNZD + defensiveNZD;

  const liquidity: LiquidityBreakdown = {
    totalPortfolioNZD: denominatorD,
    totalEquitiesNZD,
    nzAuEquitiesNZD,
    intlEquitiesNZD,
    totalBondsNZD,
    totalTermDepositsNZD,
    totalCashNZD,
    totalHedgingNZD,
    equitiesPercentage: (totalEquitiesNZD / denominatorD) * 100,
    nzAuEquitiesPercentage: (nzAuEquitiesNZD / denominatorD) * 100,
    intlEquitiesPercentage: (intlEquitiesNZD / denominatorD) * 100,
    bondsPercentage: (totalBondsNZD / denominatorD) * 100,
    termDepositsPercentage: (totalTermDepositsNZD / denominatorD) * 100,
    cashPercentage: (totalCashNZD / denominatorD) * 100,
    hedgingPercentage: (totalHedgingNZD / denominatorD) * 100,
    growthPercentage: splitBase > 0 ? (totalEquitiesNZD / splitBase) * 100 : 0,
    defensivePercentage: splitBase > 0 ? (defensiveNZD / splitBase) * 100 : 0,
  };

  // 4. Cross-Asset Institution Rollup (Equities with issuerKey + Bonds + Fund TDs + Direct CashDeposits)
  const rollupMap = new Map<string, IssuerRollupEntry>();
  const ensureIssuer = (key: string, name: string): IssuerRollupEntry => {
    let entry = rollupMap.get(key);
    if (!entry) {
      entry = {
        issuerKey: key,
        issuerName: name,
        equityNZD: 0,
        bondNZD: 0,
        depositNZD: 0,
        totalNZD: 0,
        portfolioWeight: 0,
        assetClassCount: 0,
        sources: [],
      };
      rollupMap.set(key, entry);
    }
    return entry;
  };

  for (const h of allHoldings) {
    if (h.assetClass === "equity" && !h.issuerKey) continue;
    const key = h.issuerKey || h.isin;
    const name = h.issuerName || h.name;
    const entry = ensureIssuer(key, name);

    if (h.assetClass === "equity") entry.equityNZD += h.valueNZD;
    else if (h.assetClass === "fixed_interest") entry.bondNZD += h.valueNZD;
    else if (h.assetClass === "term_deposit") entry.depositNZD += h.valueNZD;

    for (const s of h.sources) {
      entry.sources.push({ ...s, assetClass: h.assetClass });
    }
  }

  for (const dep of cashDeposits) {
    if (dep.valueNZD <= 0) continue;
    const { issuerKey, issuerName } = resolveDepositIssuer(dep.institution);
    const entry = ensureIssuer(issuerKey, issuerName);
    entry.depositNZD += dep.valueNZD;
    entry.sources.push({
      sourceType: "deposit",
      fundName: `${dep.institution} · ${dep.label}`,
      depositId: dep.depositId,
      assetClass: dep.type === "term_deposit" ? "term_deposit" : undefined,
      valueNZD: dep.valueNZD,
      effectiveDate: dep.maturityDate,
    });
  }

  const issuerRollup = Array.from(rollupMap.values())
    .map((entry) => {
      entry.totalNZD = entry.equityNZD + entry.bondNZD + entry.depositNZD;
      entry.portfolioWeight = entry.totalNZD / denominatorD;
      entry.assetClassCount =
        (entry.equityNZD > 0 ? 1 : 0) +
        (entry.bondNZD > 0 ? 1 : 0) +
        (entry.depositNZD > 0 ? 1 : 0);
      entry.sources.sort((a, b) => b.valueNZD - a.valueNZD);
      return entry;
    })
    .sort((a, b) => {
      const aMulti = a.assetClassCount >= 2 ? 1 : 0;
      const bMulti = b.assetClassCount >= 2 ? 1 : 0;
      if (bMulti !== aMulti) return bMulti - aMulti;
      return b.totalNZD - a.totalNZD;
    });

  // 5. Equity-Only Macro Sector & Country Breakdowns (reflecting 100% of totalEquitiesNZD)
  const sectorMap = new Map<string, { total: number; countryMap: Map<string, number> }>();
  const countryMap = new Map<string, { total: number; sectorMap: Map<string, number> }>();

  for (const h of equityHoldings) {
    const sector = h.sector || "Unclassified";
    const country = h.country || "Global";

    if (!sectorMap.has(sector)) sectorMap.set(sector, { total: 0, countryMap: new Map() });
    const secEntry = sectorMap.get(sector)!;
    secEntry.total += h.valueNZD;
    secEntry.countryMap.set(country, (secEntry.countryMap.get(country) || 0) + h.valueNZD);

    if (!countryMap.has(country)) countryMap.set(country, { total: 0, sectorMap: new Map() });
    const ctryEntry = countryMap.get(country)!;
    ctryEntry.total += h.valueNZD;
    ctryEntry.sectorMap.set(sector, (ctryEntry.sectorMap.get(sector) || 0) + h.valueNZD);
  }

  const equityBase = totalEquitiesNZD > 0 ? totalEquitiesNZD : 1;

  const sectorBreakdown: CategoryBreakdown[] = Array.from(sectorMap.entries())
    .map(([secName, data]) => ({
      name: secName,
      valueNZD: data.total,
      portfolioPercentage: totalEquitiesNZD > 0 ? (data.total / equityBase) * 100 : 0,
      subcategories: Array.from(data.countryMap.entries())
        .map(([ctryName, val]) => ({
          name: ctryName,
          valueNZD: val,
          percentage: data.total > 0 ? (val / data.total) * 100 : 0,
        }))
        .sort((a, b) => b.valueNZD - a.valueNZD),
    }))
    .sort((a, b) => b.valueNZD - a.valueNZD);

  const countryBreakdown: CategoryBreakdown[] = Array.from(countryMap.entries())
    .map(([ctryName, data]) => ({
      name: ctryName,
      valueNZD: data.total,
      portfolioPercentage: totalEquitiesNZD > 0 ? (data.total / equityBase) * 100 : 0,
      subcategories: Array.from(data.sectorMap.entries())
        .map(([secName, val]) => ({
          name: secName,
          valueNZD: val,
          percentage: data.total > 0 ? (val / data.total) * 100 : 0,
        }))
        .sort((a, b) => b.valueNZD - a.valueNZD),
    }))
    .sort((a, b) => b.valueNZD - a.valueNZD);

  return {
    denominatorD,
    liquidity,
    holdings: equityHoldings,
    bondIssuerHoldings,
    issuerRollup,
    sectorBreakdown,
    countryBreakdown,
  };
}
