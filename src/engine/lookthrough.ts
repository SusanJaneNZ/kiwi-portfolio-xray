/**
 * Core Look-Through Aggregation, Asset Split & Institutional Rollup Engine.
 */

import {
  CategoryBreakdown,
  ConsolidatedHolding,
  Constituent,
  DirectHolding,
  FixedInterestHolding,
  FundMetadata,
  IssuerRollupEntry,
  LiquidityBreakdown,
} from "../types/portfolio";
import { directHoldingValueNZD } from "../utils/format";

export interface CalculationInput {
  fundBalances: Record<string, number>;
  directHoldings: DirectHolding[];
  fixedInterest?: FixedInterestHolding[];
  cashDeposits?: FixedInterestHolding[];
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
  { key: "ISSUER_CEN", name: "Contact Energy", regexes: [/\bcontact energy\b/i, /\bcontact\b/i, /\bcen\b/i] },
  { key: "ISSUER_IFT", name: "Infratil", regexes: [/\binfratil\b/i, /\bift\b/i] },
  { key: "ISSUER_SPK", name: "Spark New Zealand", regexes: [/\bspark\b/i, /\bspk\b/i] },
  { key: "ISSUER_MEL", name: "Meridian Energy", regexes: [/\bmeridian\b/i, /\bmel\b/i] },
  { key: "ISSUER_MCY", name: "Mercury NZ", regexes: [/\bmercury\b/i, /\bmcy\b/i] },
  { key: "ISSUER_NZ_GOV", name: "New Zealand Government", regexes: [/\bnew zealand government\b/i, /\bnz government\b/i, /\bnz gov\b/i] },
  { key: "ISSUER_AKL_COUNCIL", name: "Auckland Council", regexes: [/\bauckland council\b/i] },
];

export function resolveDepositIssuer(
  institution: string,
  explicitIssuerKey?: string
): { issuerKey: string; issuerName: string } {
  if (explicitIssuerKey) {
    return { issuerKey: explicitIssuerKey, issuerName: institution };
  }
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

function buildCategoryBreakdown(
  equityHoldings: ConsolidatedHolding[],
  primaryField: "sector" | "country",
  secondaryField: "sector" | "country",
  totalEquitiesNZD: number
): CategoryBreakdown[] {
  const primaryFallback = primaryField === "sector" ? "Unclassified" : "Global";
  const secondaryFallback = secondaryField === "sector" ? "Unclassified" : "Global";
  const groupMap = new Map<string, { total: number; subMap: Map<string, number> }>();

  for (const h of equityHoldings) {
    const primary = h[primaryField] || primaryFallback;
    const secondary = h[secondaryField] || secondaryFallback;
    let group = groupMap.get(primary);
    if (!group) {
      group = { total: 0, subMap: new Map() };
      groupMap.set(primary, group);
    }
    group.total += h.valueNZD;
    group.subMap.set(secondary, (group.subMap.get(secondary) || 0) + h.valueNZD);
  }

  const equityBase = totalEquitiesNZD > 0 ? totalEquitiesNZD : 1;
  return Array.from(groupMap.entries())
    .map(([name, data]) => ({
      name,
      valueNZD: data.total,
      portfolioPercentage: totalEquitiesNZD > 0 ? (data.total / equityBase) * 100 : 0,
      subcategories: Array.from(data.subMap.entries())
        .map(([subName, val]) => ({
          name: subName,
          valueNZD: val,
          percentage: data.total > 0 ? (val / data.total) * 100 : 0,
        }))
        .sort((a, b) => b.valueNZD - a.valueNZD),
    }))
    .sort((a, b) => b.valueNZD - a.valueNZD);
}

function buildCrossAssetIssuerRollup(
  allHoldings: ConsolidatedHolding[],
  fixedInterestList: FixedInterestHolding[],
  denominatorD: number
): IssuerRollupEntry[] {
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
    const entry = ensureIssuer(h.issuerKey || h.isin, h.issuerName || h.name);

    if (h.assetClass === "equity") entry.equityNZD += h.valueNZD;
    else if (h.assetClass === "fixed_interest") entry.bondNZD += h.valueNZD;
    else if (h.assetClass === "term_deposit") entry.depositNZD += h.valueNZD;

    for (const s of h.sources) {
      entry.sources.push({ ...s, assetClass: h.assetClass });
    }
  }

  for (const dep of fixedInterestList) {
    if (dep.valueNZD <= 0) continue;
    const cat = dep.category || dep.type || "term_deposit";
    if (cat === "bond") continue; // Direct bonds are already incorporated in allHoldings
    const { issuerKey, issuerName } = resolveDepositIssuer(dep.institution, dep.issuerKey);
    const entry = ensureIssuer(issuerKey, issuerName);
    entry.depositNZD += dep.valueNZD;
    entry.sources.push({
      sourceType: "deposit",
      fundName: `${dep.institution} · ${dep.name || dep.label || dep.institution}`,
      depositId: dep.depositId,
      assetClass: cat === "term_deposit" ? "term_deposit" : undefined,
      valueNZD: dep.valueNZD,
      effectiveDate: dep.maturityDate,
    });
  }

  return Array.from(rollupMap.values())
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
}

export function calculatePortfolioLookthrough(input: CalculationInput): CalculationResult {
  const { fundBalances, directHoldings, audNzdRate, fundsRegistry, constituentsMap } = input;
  const fiList = input.fixedInterest || input.cashDeposits || [];
  const safeAudNzdRate = Number.isFinite(audNzdRate) && audNzdRate > 0 ? audNzdRate : 1.10;

  const fundMetaMap = new Map<string, FundMetadata>();
  for (const fm of fundsRegistry) {
    fundMetaMap.set(fm.code, fm);
  }

  // 1. Total Denominator D = sum(Bf) + sum(DirectNZD) + sum(BondsNZD) + sum(TDsNZD) + sum(CashNZD)
  let sumBf = 0;
  for (const balance of Object.values(fundBalances)) {
    if (balance > 0) sumBf += balance;
  }

  let sumDirectNZD = 0;
  const directNZDValues: { holding: DirectHolding; valueNZD: number }[] = [];
  for (const dh of directHoldings) {
    const valueNZD = directHoldingValueNZD(dh, safeAudNzdRate);
    if (valueNZD > 0) {
      sumDirectNZD += valueNZD;
      directNZDValues.push({ holding: dh, valueNZD });
    }
  }

  let directBondsNZD = 0;
  let directTermDepositsNZD = 0;
  let directCashNZD = 0;
  for (const dep of fiList) {
    if (dep.valueNZD > 0) {
      const cat = dep.category || dep.type || "term_deposit";
      if (cat === "bond") {
        directBondsNZD += dep.valueNZD;
      } else if (cat === "term_deposit") {
        directTermDepositsNZD += dep.valueNZD;
      } else {
        directCashNZD += dep.valueNZD;
      }
    }
  }

  const denominatorD = sumBf + sumDirectNZD + directBondsNZD + directTermDepositsNZD + directCashNZD;

  // 2. Fund-level Cash & Hedging Reserves (from both unlisted funds and unwrapped listed ETFs)
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
  for (const { holding, valueNZD } of directNZDValues) {
    const baseTicker = holding.ticker.split(".")[0].trim().toUpperCase();
    const etfCode = holding.fundCode || (holding.isEtf ? baseTicker : undefined) || (constituentsMap[baseTicker] ? baseTicker : undefined);
    if (etfCode && constituentsMap[etfCode]) {
      const meta = fundMetaMap.get(etfCode);
      if (meta) {
        fundCashNZD += valueNZD * (meta.cash_ratio || 0);
        totalHedgingNZD += valueNZD * Math.max(0, meta.hedging_ratio || 0);
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

    if (constituents.length === 0) {
      const isKiwi = Boolean(meta?.isKiwiSaver || meta?.provider?.toLowerCase().includes("kiwi") || meta?.provider?.toLowerCase().includes("fisher"));
      const fundName = meta?.name || fundCode;
      const isin = `FUND_${fundCode}`;
      const exposureNZD = balance * (1 - (meta?.cash_ratio || 0));

      if (meta?.asset_class === "mixed") {
        const equityPortion = 0.80 * exposureNZD;
        const bondPortion = 0.20 * exposureNZD;

        const eqKey = `equity:${isin}_EQ`;
        let eqRecord = holdingsMap.get(eqKey);
        if (!eqRecord) {
          eqRecord = {
            isin: `${isin}_EQ`,
            name: `${fundName} (Growth Equities)`,
            ticker: fundCode,
            country: "New Zealand",
            sector: isKiwi ? "KiwiSaver Scheme" : "Managed Fund",
            assetClass: "equity",
            valueNZD: 0,
            portfolioWeight: 0,
            equityWeight: 0,
            sources: [],
          };
          holdingsMap.set(eqKey, eqRecord);
        }
        eqRecord.valueNZD += equityPortion;
        eqRecord.sources.push({
          sourceType: "fund",
          fundCode,
          fundName: `${fundName} (Growth Equities)`,
          assetClass: "equity",
          valueNZD: equityPortion,
          weightInFund: 0.80,
          effectiveDate: meta?.effective_date || new Date().toISOString().split("T")[0],
        });

        const bondKey = `fixed_interest:${isin}_FI`;
        let bondRecord = holdingsMap.get(bondKey);
        if (!bondRecord) {
          bondRecord = {
            isin: `${isin}_FI`,
            name: `${fundName} (Fixed Interest)`,
            ticker: fundCode,
            country: "New Zealand",
            sector: "Fixed Interest",
            assetClass: "fixed_interest",
            valueNZD: 0,
            portfolioWeight: 0,
            equityWeight: 0,
            sources: [],
          };
          holdingsMap.set(bondKey, bondRecord);
        }
        bondRecord.valueNZD += bondPortion;
        bondRecord.sources.push({
          sourceType: "fund",
          fundCode,
          fundName: `${fundName} (Fixed Interest)`,
          assetClass: "fixed_interest",
          valueNZD: bondPortion,
          weightInFund: 0.20,
          effectiveDate: meta?.effective_date || new Date().toISOString().split("T")[0],
        });
        continue;
      }

      const assetClass = meta?.asset_class === "fixed_interest" ? "fixed_interest" : "equity";
      const holdingKey = `${assetClass}:${isin}`;
      let record = holdingsMap.get(holdingKey);
      if (!record) {
        record = {
          isin,
          name: fundName,
          ticker: fundCode,
          country: "New Zealand",
          sector: isKiwi ? "KiwiSaver Scheme" : "Managed Fund",
          assetClass,
          valueNZD: 0,
          portfolioWeight: 0,
          equityWeight: 0,
          sources: [],
        };
        holdingsMap.set(holdingKey, record);
      }
      record.valueNZD += exposureNZD;
      record.sources.push({
        sourceType: "fund",
        fundCode,
        fundName,
        assetClass,
        valueNZD: exposureNZD,
        weightInFund: 1.0,
        effectiveDate: meta?.effective_date || new Date().toISOString().split("T")[0],
      });
      continue;
    }

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
    const baseTicker = holding.ticker.split(".")[0].toUpperCase();
    const etfCode = holding.fundCode || (holding.isEtf ? baseTicker : undefined) || (constituentsMap[baseTicker] ? baseTicker : undefined);
    const etfConstituents = etfCode ? constituentsMap[etfCode] : undefined;
    const etfMeta = etfCode ? fundMetaMap.get(etfCode) : undefined;

    if (etfConstituents && etfConstituents.length > 0) {
      // UNWRAP listed ETF into its underlying constituents!
      for (const c of etfConstituents) {
        const assetClass = c.asset_class || "equity";
        const isin = c.isin || `SYNTH_${c.ticker || c.name}`;
        const holdingKey = `${assetClass}:${isin}`;
        const exposureNZD = valueNZD * c.weight;

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
        const code = etfCode || baseTicker;
        const resolvedFundName = etfMeta?.name || holding.name || code;
        const displayFundName = resolvedFundName.toUpperCase().includes(code.toUpperCase())
          ? resolvedFundName
          : `${code} - ${resolvedFundName}`;

        record.sources.push({
          sourceType: "fund",
          fundCode: code,
          fundName: displayFundName,
          assetClass,
          valueNZD: exposureNZD,
          weightInFund: c.weight,
          effectiveDate: etfMeta?.effective_date || new Date().toISOString().split("T")[0],
        });
      }
    } else {
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
  }

  // Add direct corporate/government bonds into holdingsMap
  for (const fi of fiList) {
    const cat = fi.category || fi.type || "term_deposit";
    if (cat === "bond" && fi.valueNZD > 0) {
      const isin = fi.depositId || `BOND_${fi.id}`;
      const holdingKey = `fixed_interest:${isin}`;
      let record = holdingsMap.get(holdingKey);
      if (!record) {
        const { issuerKey, issuerName } = resolveDepositIssuer(fi.institution, fi.issuerKey);
        record = {
          isin,
          name: fi.name || fi.label || `${fi.institution} Bond`,
          ticker: (fi.name || fi.institution).split(" ")[0],
          country: "New Zealand",
          sector: "Fixed Interest",
          assetClass: "fixed_interest",
          issuerKey,
          issuerName,
          valueNZD: 0,
          portfolioWeight: 0,
          equityWeight: 0,
          sources: [],
        };
        holdingsMap.set(holdingKey, record);
      }

      record.valueNZD += fi.valueNZD;
      record.sources.push({
        sourceType: "deposit",
        depositId: fi.id,
        fundName: `${fi.institution} · ${fi.name || fi.label || fi.institution}`,
        assetClass: "fixed_interest",
        valueNZD: fi.valueNZD,
        effectiveDate: fi.maturityDate,
      });
    }
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

  // 4. Cross-Asset Institution Rollup & 5. Equity-Only Macro Breakdowns
  const issuerRollup = buildCrossAssetIssuerRollup(allHoldings, fiList, denominatorD);
  const sectorBreakdown = buildCategoryBreakdown(equityHoldings, "sector", "country", totalEquitiesNZD);
  const countryBreakdown = buildCategoryBreakdown(equityHoldings, "country", "sector", totalEquitiesNZD);

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
