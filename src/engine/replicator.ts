import {
  ConsolidatedHolding,
  Constituent,
  DirectEquityCatalogItem,
  DirectHolding,
} from '../types/portfolio';

export type ReplicationMode = 'portfolio_aware' | 'standalone';

export interface ReplicatorIndexModel {
  code: string;
  name: string;
  merRate: number; // Annual management fee (e.g. 0.0054 for 0.54%)
  exchange: 'NZX' | 'ASX';
  currency: 'NZD' | 'AUD';
  taxBadge: string;
  taxSummary: string;
}

export const REPLICATOR_INDEX_MODELS: ReplicatorIndexModel[] = [
  {
    code: 'DIV',
    name: 'Smartshares NZ Dividend ETF (DIV)',
    merRate: 0.0054,
    exchange: 'NZX',
    currency: 'NZD',
    taxBadge: 'NZ Imputation Credits · Zero FIF',
    taxSummary:
      'NZX equities are FIF-exempt and pass 28% company imputation credits directly to your IRD return.',
  },
  {
    code: 'ASD',
    name: 'Smartshares Australian Dividend ETF (ASD)',
    merRate: 0.0054,
    exchange: 'ASX',
    currency: 'AUD',
    taxBadge: 'Trans-Tasman FIF Exempt (ASX)',
    taxSummary:
      'Qualifying ASX All Ordinaries shares are exempt from NZ FIF tax; only declared dividends are taxed.',
  },
  {
    code: 'TNZ',
    name: 'Smartshares NZ Top 10 ETF (TNZ)',
    merRate: 0.006,
    exchange: 'NZX',
    currency: 'NZD',
    taxBadge: 'NZ Imputation Credits · Zero FIF',
    taxSummary:
      'Top 10 NZX blue chips; zero FIF tax and direct imputation credit pass-through.',
  },
  {
    code: 'OZY',
    name: 'Smartshares Australian Top 20 ETF (OZY)',
    merRate: 0.006,
    exchange: 'ASX',
    currency: 'AUD',
    taxBadge: 'Trans-Tasman FIF Exempt (ASX)',
    taxSummary:
      'Top 20 ASX leaders; exempt from NZ FIF tax under the Trans-Tasman exemption.',
  },
];

export interface ReplicationRow {
  isin: string;
  ticker: string;
  name: string;
  sector: string;
  country: string;
  exchange: 'NZX' | 'ASX';
  currency: 'NZD' | 'AUD';
  originalIndexWeight: number;
  normalizedSleeveWeight: number;
  adjustedSleeveWeight: number;
  baselineTargetNZD: number;
  targetAllocationNZD: number;
  existingDirectNZD: number;
  existingIndirectNZD: number;
  existingTotalNZD: number;
  existingDirectShares: number;
  existingSourcesLabel: string;
  overlapTrimmed: boolean;
  priceNative: number;
  priceNZD: number;
  targetShares: number;
  deltaShares: number;
  deltaValueNZD: number;
  action: 'BUY' | 'SELL' | 'HOLD';
  driftSuppressed: boolean;
}

export interface BreakevenMetrics {
  budgetNZD: number;
  merRate: number;
  annualFeeDragNZD: number;
  activeTradeCount: number;
  brokeragePerTradeNZD: number;
  estimatedBrokerageNZD: number;
  breakevenMonths: number;
  yearOneNetSavingsNZD: number;
  fiveYearNetSavingsNZD: number;
}

export interface ReplicationPlan {
  model: ReplicatorIndexModel;
  depth: number;
  mode: ReplicationMode;
  rawIndexCoverage: number;
  rows: ReplicationRow[];
  totalAllocatedNZD: number;
  totalTradeValueNZD: number;
  overlapCount: number;
  breakeven: BreakevenMetrics;
}

export interface GenerateReplicationParams {
  model: ReplicatorIndexModel;
  constituents: Constituent[];
  depth: number;
  budgetNZD: number;
  mode: ReplicationMode;
  existingDirectHoldings: DirectHolding[];
  lookThroughHoldings: ConsolidatedHolding[];
  directCatalog: DirectEquityCatalogItem[];
  pricesByTicker: Record<string, number>;
  audNzdRate: number;
  brokeragePerTradeNZD?: number;
  driftBandPct?: number;
}

function normTicker(t?: string): string {
  return (t || '').trim().toUpperCase().replace(/\.(NZ|AX)$/i, '');
}

function resolveNativePrice(
  ticker: string,
  exchange: 'NZX' | 'ASX',
  pricesByTicker: Record<string, number>,
  existingDirect?: DirectHolding
): number {
  const base = normTicker(ticker);
  const suffix = exchange === 'ASX' ? '.AX' : '.NZ';
  const candidates = [ticker, ticker.toUpperCase(), `${base}${suffix}`, base];
  for (const key of candidates) {
    const p = pricesByTicker[key];
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return p;
    }
  }
  if (existingDirect && existingDirect.price > 0) {
    return existingDirect.price;
  }
  return 0;
}

export function calculateBreakevenMetrics(
  budgetNZD: number,
  merRate: number,
  activeTradeCount: number,
  brokeragePerTradeNZD = 4.5
): BreakevenMetrics {
  const safeBudget = Math.max(0, Number.isFinite(budgetNZD) ? budgetNZD : 0);
  const safeBrokerage = Math.max(0, Number.isFinite(brokeragePerTradeNZD) ? brokeragePerTradeNZD : 0);
  const annualFeeDragNZD = safeBudget * merRate;
  const estimatedBrokerageNZD = activeTradeCount * safeBrokerage;
  const monthlyFeeDrag = annualFeeDragNZD / 12;
  const breakevenMonths = monthlyFeeDrag > 0 ? estimatedBrokerageNZD / monthlyFeeDrag : Infinity;

  return {
    budgetNZD: safeBudget,
    merRate,
    annualFeeDragNZD,
    activeTradeCount,
    brokeragePerTradeNZD: safeBrokerage,
    estimatedBrokerageNZD,
    breakevenMonths,
    yearOneNetSavingsNZD: annualFeeDragNZD - estimatedBrokerageNZD,
    fiveYearNetSavingsNZD: annualFeeDragNZD * 5 - estimatedBrokerageNZD,
  };
}

export function generateReplicationPlan(params: GenerateReplicationParams): ReplicationPlan {
  const {
    model,
    constituents,
    depth,
    budgetNZD,
    mode,
    existingDirectHoldings,
    lookThroughHoldings,
    directCatalog,
    pricesByTicker,
    audNzdRate,
    brokeragePerTradeNZD = 4.5,
    driftBandPct = 0.025,
  } = params;

  const safeBudget = Math.max(0, Number.isFinite(budgetNZD) ? budgetNZD : 0);
  const safeFx = audNzdRate > 0 ? audNzdRate : 1.09;

  const equityRows = (constituents || [])
    .filter((c) => c.asset_class === 'equity' && c.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  const clampedDepth = Math.max(1, Math.min(depth, equityRows.length || depth));
  const topK = equityRows.slice(0, clampedDepth);
  const rawIndexCoverage = topK.reduce((acc, c) => acc + c.weight, 0);

  const directByIsin = new Map<string, DirectHolding>();
  const directByBaseTicker = new Map<string, DirectHolding>();
  for (const dh of existingDirectHoldings || []) {
    if (dh.isEtf) continue;
    directByIsin.set(dh.isin, dh);
    if (dh.ticker) directByBaseTicker.set(normTicker(dh.ticker), dh);
  }

  const ltByIsin = new Map<string, ConsolidatedHolding>();
  const ltByBaseTicker = new Map<string, ConsolidatedHolding>();
  for (const h of lookThroughHoldings || []) {
    if (h.assetClass !== 'equity') continue;
    ltByIsin.set(h.isin, h);
    if (h.ticker) ltByBaseTicker.set(normTicker(h.ticker), h);
  }

  const catalogByIsin = new Map<string, DirectEquityCatalogItem>();
  const catalogByBaseTicker = new Map<string, DirectEquityCatalogItem>();
  for (const item of directCatalog || []) {
    if (item.isEtf) continue;
    catalogByIsin.set(item.isin, item);
    if (item.ticker) catalogByBaseTicker.set(normTicker(item.ticker), item);
  }

  const prelim = topK.map((c) => {
    const normalizedWeight = rawIndexCoverage > 0 ? c.weight / rawIndexCoverage : 0;
    const baseTicker = normTicker(c.ticker);
    const catItem = catalogByIsin.get(c.isin) || (baseTicker ? catalogByBaseTicker.get(baseTicker) : undefined);
    const existingDirect =
      directByIsin.get(c.isin) || (baseTicker ? directByBaseTicker.get(baseTicker) : undefined);
    const ltEntry = ltByIsin.get(c.isin) || (baseTicker ? ltByBaseTicker.get(baseTicker) : undefined);

    const exchange: 'NZX' | 'ASX' = catItem?.exchange || model.exchange;
    const currency: 'NZD' | 'AUD' = exchange === 'ASX' ? 'AUD' : 'NZD';
    const displayTicker = catItem?.ticker || c.ticker || baseTicker;

    const existingDirectNZD = existingDirect
      ? existingDirect.shares * existingDirect.price * (existingDirect.currency === 'AUD' ? safeFx : 1)
      : 0;

    let existingIndirectNZD = 0;
    const fundSourceCodes: string[] = [];
    if (ltEntry) {
      for (const src of ltEntry.sources) {
        if (src.sourceType === 'fund' && src.fundCode?.toUpperCase() !== model.code.toUpperCase()) {
          existingIndirectNZD += src.valueNZD;
          if (src.fundCode && !fundSourceCodes.includes(src.fundCode)) {
            fundSourceCodes.push(src.fundCode);
          }
        }
      }
    }

    const existingTotalNZD = existingDirectNZD + existingIndirectNZD;
    const sourceParts: string[] = [];
    if (existingDirectNZD > 0) sourceParts.push('Direct');
    if (fundSourceCodes.length > 0) sourceParts.push(fundSourceCodes.slice(0, 2).join(', '));

    return {
      c,
      catItem,
      existingDirect,
      exchange,
      currency,
      displayTicker,
      normalizedWeight,
      baselineTargetNZD: safeBudget * normalizedWeight,
      existingDirectNZD,
      existingIndirectNZD,
      existingTotalNZD,
      existingSourcesLabel: sourceParts.join(' + '),
    };
  });

  const targetDollars = prelim.map((p) => p.baselineTargetNZD);
  const trimmedFlags = prelim.map(() => false);

  if (mode === 'portfolio_aware' && safeBudget > 0) {
    let freedBudget = 0;
    const uncappedIndices: number[] = [];

    for (let i = 0; i < prelim.length; i++) {
      const p = prelim[i];
      if (p.existingIndirectNZD > 0.01) {
        const netNeeded = Math.max(0, p.baselineTargetNZD - p.existingIndirectNZD);
        if (netNeeded < p.baselineTargetNZD) {
          freedBudget += p.baselineTargetNZD - netNeeded;
          targetDollars[i] = netNeeded;
          trimmedFlags[i] = true;
        }
      } else {
        uncappedIndices.push(i);
      }
    }

    if (freedBudget > 0 && uncappedIndices.length > 0) {
      const uncappedWeightSum = uncappedIndices.reduce(
        (acc, idx) => acc + prelim[idx].normalizedWeight,
        0
      );
      if (uncappedWeightSum > 0) {
        for (const idx of uncappedIndices) {
          targetDollars[idx] += freedBudget * (prelim[idx].normalizedWeight / uncappedWeightSum);
        }
      }
    }
  }

  const totalTargetSum = targetDollars.reduce((acc, v) => acc + v, 0);
  const rows: ReplicationRow[] = prelim.map((p, idx) => {
    const targetAllocationNZD = targetDollars[idx];
    const adjustedSleeveWeight = totalTargetSum > 0 ? targetAllocationNZD / totalTargetSum : 0;

    const priceNative = resolveNativePrice(
      p.displayTicker,
      p.exchange,
      pricesByTicker,
      p.existingDirect
    );
    const priceNZD = priceNative > 0 ? priceNative * (p.currency === 'AUD' ? safeFx : 1) : 0;

    const existingDirectShares = p.existingDirect ? p.existingDirect.shares : 0;
    let targetShares = priceNZD > 0 ? Math.floor(targetAllocationNZD / priceNZD) : existingDirectShares;
    let deltaShares = targetShares - existingDirectShares;
    let driftSuppressed = false;

    if (existingDirectShares > 0 && targetAllocationNZD > 0 && priceNZD > 0) {
      const driftRatio = Math.abs(p.existingDirectNZD / targetAllocationNZD - 1.0);
      if (driftRatio <= driftBandPct) {
        targetShares = existingDirectShares;
        deltaShares = 0;
        driftSuppressed = true;
      }
    }

    const deltaValueNZD = deltaShares * priceNZD;
    const action: 'BUY' | 'SELL' | 'HOLD' =
      deltaShares > 0 ? 'BUY' : deltaShares < 0 ? 'SELL' : 'HOLD';

    return {
      isin: p.catItem?.isin || p.c.isin,
      ticker: p.displayTicker,
      name: p.catItem?.name || p.c.name,
      sector: p.catItem?.sector || p.c.sector || 'Unclassified',
      country: p.catItem?.country || p.c.country || (p.exchange === 'ASX' ? 'Australia' : 'New Zealand'),
      exchange: p.exchange,
      currency: p.currency,
      originalIndexWeight: p.c.weight,
      normalizedSleeveWeight: p.normalizedWeight,
      adjustedSleeveWeight,
      baselineTargetNZD: p.baselineTargetNZD,
      targetAllocationNZD,
      existingDirectNZD: p.existingDirectNZD,
      existingIndirectNZD: p.existingIndirectNZD,
      existingTotalNZD: p.existingTotalNZD,
      existingDirectShares,
      existingSourcesLabel: p.existingSourcesLabel,
      overlapTrimmed: trimmedFlags[idx],
      priceNative,
      priceNZD,
      targetShares,
      deltaShares,
      deltaValueNZD,
      action,
      driftSuppressed,
    };
  });

  const activeTrades = rows.filter((r) => r.action !== 'HOLD');
  const totalAllocatedNZD = rows.reduce((acc, r) => acc + r.targetAllocationNZD, 0);
  const totalTradeValueNZD = activeTrades.reduce((acc, r) => acc + Math.abs(r.deltaValueNZD), 0);
  const overlapCount = rows.filter((r) => r.overlapTrimmed).length;

  const breakeven = calculateBreakevenMetrics(
    safeBudget,
    model.merRate,
    activeTrades.length || rows.length,
    brokeragePerTradeNZD
  );

  return {
    model,
    depth: clampedDepth,
    mode,
    rawIndexCoverage,
    rows,
    totalAllocatedNZD,
    totalTradeValueNZD,
    overlapCount,
    breakeven,
  };
}

export function formatTradeOrderList(plan: ReplicationPlan): string {
  const lines: string[] = [
    `DIY Index Replicator Trade Plan — ${plan.model.name} (Top ${plan.depth})`,
    `Mode: ${plan.mode === 'portfolio_aware' ? 'Whole-Portfolio Aware' : 'Standalone Sleeve'} | Target Budget: $${plan.breakeven.budgetNZD.toFixed(0)} NZD`,
    `Est. Annual Fee Saved: $${plan.breakeven.annualFeeDragNZD.toFixed(2)}/yr (${(plan.model.merRate * 100).toFixed(2)}% MER) | Breakeven: ${Number.isFinite(plan.breakeven.breakevenMonths) ? plan.breakeven.breakevenMonths.toFixed(1) + ' months' : 'N/A'}`,
    '',
  ];

  let idx = 1;
  for (const r of plan.rows) {
    if (r.action === 'HOLD' && r.priceNZD > 0) continue;
    const pricePart =
      r.priceNative > 0
        ? `@ ~${r.currency === 'AUD' ? 'A$' : '$'}${r.priceNative.toFixed(2)} ${r.currency} (~$${Math.abs(r.deltaValueNZD).toFixed(0)} NZD)`
        : `(Target: $${r.targetAllocationNZD.toFixed(0)} NZD — enter live price)`;
    const note = r.overlapTrimmed
      ? ` [Trimmed: $${r.existingIndirectNZD.toFixed(0)} held in ${r.existingSourcesLabel}]`
      : '';
    if (r.priceNZD > 0) {
      lines.push(`${idx}. ${r.action} ${Math.abs(r.deltaShares).toLocaleString()} ${r.ticker} ${pricePart}${note}`);
    } else {
      lines.push(`${idx}. BUY ${r.ticker} ${pricePart}${note}`);
    }
    idx++;
  }

  return lines.join('\n');
}
