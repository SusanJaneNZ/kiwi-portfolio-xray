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
  estimatedYield: number; // Est. annual gross dividend yield (e.g. 0.055 for 5.5%)
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
    estimatedYield: 0.055,
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
    estimatedYield: 0.055,
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
    estimatedYield: 0.035,
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
    estimatedYield: 0.045,
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
  estimatedYield: number;
  marginalTaxRate: number;
  annualFeeDragNZD: number;
  annualTaxDragNZD: number;
  netAnnualSavingNZD: number;
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
  marginalTaxRate?: number;
}

function normTicker(t?: string): string {
  return (t || '').trim().toUpperCase().replace(/\.(NZ|AX)$/i, '');
}

function resolveNativePrice(
  ticker: string,
  exchange: 'NZX' | 'ASX',
  currency: 'NZD' | 'AUD',
  pricesByTicker: Record<string, number>,
  existingDirect?: DirectHolding
): number {
  const upper = ticker.trim().toUpperCase();
  const base = normTicker(ticker);
  const suffix = exchange === 'ASX' ? '.AX' : '.NZ';
  const suffixed = `${base}${suffix}`;

  // Explicit 0 in pricesByTicker means the user intentionally cleared the inline price input
  if (pricesByTicker[upper] === 0 || pricesByTicker[suffixed] === 0) {
    return 0;
  }

  const candidates = [upper, suffixed, base];
  for (const key of candidates) {
    const p = pricesByTicker[key];
    if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
      return p;
    }
  }
  if (existingDirect && existingDirect.currency === currency && existingDirect.price > 0) {
    return existingDirect.price;
  }
  return 0;
}

export function calculateBreakevenMetrics(
  budgetNZD: number,
  merRate: number,
  activeTradeCount: number,
  brokeragePerTradeNZD = 4.5,
  marginalTaxRate = 0.28,
  estimatedYield = 0.055
): BreakevenMetrics {
  const safeBudget = Math.max(0, Number.isFinite(budgetNZD) ? budgetNZD : 0);
  const safeBrokerage = Math.max(0, Number.isFinite(brokeragePerTradeNZD) ? brokeragePerTradeNZD : 0);
  const safeMarginal = Math.max(0, Number.isFinite(marginalTaxRate) ? marginalTaxRate : 0.28);
  const safeYield = Math.max(0, Number.isFinite(estimatedYield) ? estimatedYield : 0);

  const annualFeeDragNZD = safeBudget * merRate;
  // Listed PIE ETFs cap dividend tax at 28%; holding direct shares above 28% incurs (marginalRate - 28%) on gross dividends
  const extraTaxRate = Math.max(0, safeMarginal - 0.28);
  const annualTaxDragNZD = safeBudget * safeYield * extraTaxRate;
  const netAnnualSavingNZD = annualFeeDragNZD - annualTaxDragNZD;

  const estimatedBrokerageNZD = activeTradeCount * safeBrokerage;
  const monthlyNetSaving = netAnnualSavingNZD / 12;
  const breakevenMonths = monthlyNetSaving > 0 ? estimatedBrokerageNZD / monthlyNetSaving : Infinity;

  return {
    budgetNZD: safeBudget,
    merRate,
    estimatedYield: safeYield,
    marginalTaxRate: safeMarginal,
    annualFeeDragNZD,
    annualTaxDragNZD,
    netAnnualSavingNZD,
    activeTradeCount,
    brokeragePerTradeNZD: safeBrokerage,
    estimatedBrokerageNZD,
    breakevenMonths,
    yearOneNetSavingsNZD: netAnnualSavingNZD - estimatedBrokerageNZD,
    fiveYearNetSavingsNZD: netAnnualSavingNZD * 5 - estimatedBrokerageNZD,
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
    marginalTaxRate = 0.28,
  } = params;

  const safeBudget = Math.max(0, Number.isFinite(budgetNZD) ? budgetNZD : 0);
  const safeFx = audNzdRate > 0 ? audNzdRate : 1.09;

  const equityRows = (constituents || [])
    .filter((c) => c.asset_class === 'equity' && c.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  const clampedDepth = Math.max(1, Math.min(depth, equityRows.length || depth));
  const topK = equityRows.slice(0, clampedDepth);
  const rawIndexCoverage = topK.reduce((acc, c) => acc + c.weight, 0);

  const directByExchangeIsin = new Map<string, DirectHolding>();
  const directByExchangeTicker = new Map<string, DirectHolding>();
  for (const dh of existingDirectHoldings || []) {
    if (dh.isEtf) continue;
    directByExchangeIsin.set(`${dh.exchange}:${dh.isin}`, dh);
    if (dh.ticker) {
      directByExchangeTicker.set(`${dh.exchange}:${normTicker(dh.ticker)}`, dh);
    }
  }

  const ltByIsin = new Map<string, ConsolidatedHolding>();
  const ltByBaseTicker = new Map<string, ConsolidatedHolding>();
  for (const h of lookThroughHoldings || []) {
    if (h.assetClass !== 'equity') continue;
    ltByIsin.set(h.isin, h);
    if (h.ticker) ltByBaseTicker.set(normTicker(h.ticker), h);
  }

  const catalogByExchangeIsin = new Map<string, DirectEquityCatalogItem>();
  const catalogByExchangeTicker = new Map<string, DirectEquityCatalogItem>();
  for (const item of directCatalog || []) {
    if (item.isEtf) continue;
    catalogByExchangeIsin.set(`${item.exchange}:${item.isin}`, item);
    if (item.ticker) {
      catalogByExchangeTicker.set(`${item.exchange}:${normTicker(item.ticker)}`, item);
    }
  }

  const prelim = topK.map((c) => {
    const normalizedWeight = rawIndexCoverage > 0 ? c.weight / rawIndexCoverage : 0;
    const baseTicker = normTicker(c.ticker);
    const catItem =
      catalogByExchangeIsin.get(`${model.exchange}:${c.isin}`) ||
      (baseTicker ? catalogByExchangeTicker.get(`${model.exchange}:${baseTicker}`) : undefined);
    const exchange: 'NZX' | 'ASX' = catItem?.exchange || model.exchange;
    const currency: 'NZD' | 'AUD' = exchange === 'ASX' ? 'AUD' : 'NZD';
    const existingDirect =
      directByExchangeIsin.get(`${exchange}:${c.isin}`) ||
      (baseTicker ? directByExchangeTicker.get(`${exchange}:${baseTicker}`) : undefined);
    const ltEntry = ltByIsin.get(c.isin) || (baseTicker ? ltByBaseTicker.get(baseTicker) : undefined);

    const displayTicker = catItem?.ticker || c.ticker || baseTicker;

    const existingDirectSavedNZD = existingDirect
      ? existingDirect.shares * existingDirect.price * (existingDirect.currency === 'AUD' ? safeFx : 1)
      : 0;

    let existingIndirectNZD = 0;
    const fundSourceCodes: string[] = [];
    if (ltEntry) {
      for (const src of ltEntry.sources) {
        if (src.sourceType === 'fund') {
          existingIndirectNZD += src.valueNZD;
          if (src.fundCode && !fundSourceCodes.includes(src.fundCode)) {
            fundSourceCodes.push(src.fundCode);
          }
        }
      }
    }

    const existingTotalNZD = existingDirectSavedNZD + existingIndirectNZD;
    const sourceParts: string[] = [];
    if (existingDirectSavedNZD > 0) sourceParts.push('Direct');
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
      existingDirectSavedNZD,
      existingIndirectNZD,
      existingTotalNZD,
      existingSourcesLabel: sourceParts.join(' + '),
    };
  });

  const targetDollars = prelim.map((p) => p.baselineTargetNZD);
  const trimmedFlags = prelim.map(() => false);

  if (mode === 'portfolio_aware' && safeBudget > 0 && prelim.length > 0) {
    // Target Holding (NZD) represents the total combined exposure (Funds + Direct).
    // Each stock's direct target tops up only the shortfall below its exact index slice:
    //   directTarget_i = max(0, TargetHolding * w_i - existingIndirect_i).
    // Stocks already over-held in funds get $0 direct without shrinking other stocks' slices.
    for (let i = 0; i < prelim.length; i++) {
      const directTarget = Math.max(0, prelim[i].baselineTargetNZD - prelim[i].existingIndirectNZD);
      targetDollars[i] = directTarget;
      trimmedFlags[i] = prelim[i].existingIndirectNZD > 0.01;
    }
  }

  const totalTargetSum = targetDollars.reduce((acc, v) => acc + v, 0);
  const rows: ReplicationRow[] = prelim.map((p, idx) => {
    const targetAllocationNZD = targetDollars[idx];
    const adjustedSleeveWeight = totalTargetSum > 0 ? targetAllocationNZD / totalTargetSum : 0;

    const priceNative = resolveNativePrice(
      p.displayTicker,
      p.exchange,
      p.currency,
      pricesByTicker,
      p.existingDirect
    );
    const priceNZD = priceNative > 0 ? priceNative * (p.currency === 'AUD' ? safeFx : 1) : 0;

    const existingDirectShares = p.existingDirect ? p.existingDirect.shares : 0;
    // Value existing direct shares at current priceNZD when available so drift check is never stale
    const existingDirectNZD =
      existingDirectShares > 0 && priceNZD > 0
        ? existingDirectShares * priceNZD
        : p.existingDirectSavedNZD;
    const existingTotalNZD = existingDirectNZD + p.existingIndirectNZD;

    let targetShares = priceNZD > 0 ? Math.floor(targetAllocationNZD / priceNZD) : existingDirectShares;
    let deltaShares = targetShares - existingDirectShares;
    let driftSuppressed = false;

    if (priceNZD > 0) {
      if (existingDirectShares > 0 && targetAllocationNZD > 0) {
        const driftRatio = Math.abs(existingDirectNZD / targetAllocationNZD - 1.0);
        if (driftRatio <= driftBandPct) {
          targetShares = existingDirectShares;
          deltaShares = 0;
          driftSuppressed = true;
        }
      } else if (
        mode === 'portfolio_aware' &&
        p.existingIndirectNZD > 0 &&
        p.baselineTargetNZD > 0 &&
        deltaShares !== 0
      ) {
        const combinedDriftRatio = Math.abs(existingTotalNZD / p.baselineTargetNZD - 1.0);
        if (combinedDriftRatio <= driftBandPct) {
          targetShares = existingDirectShares;
          deltaShares = 0;
          driftSuppressed = true;
        }
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
      existingDirectNZD,
      existingIndirectNZD: p.existingIndirectNZD,
      existingTotalNZD,
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
  const unpricedBuyRows = rows.filter((r) => r.priceNZD <= 0 && r.targetAllocationNZD > 0);
  const totalAllocatedNZD = rows.reduce((acc, r) => acc + r.targetAllocationNZD, 0);
  const totalTradeValueNZD = activeTrades.reduce((acc, r) => acc + Math.abs(r.deltaValueNZD), 0);
  const overlapCount = rows.filter((r) => r.overlapTrimmed).length;

  // Count priced active trades + unpriced rows with a positive target; 0 when budget is $0 or all priced rows are HOLD
  const estimatedTradeCount =
    totalAllocatedNZD <= 0 ? activeTrades.length : activeTrades.length + unpricedBuyRows.length;

  const breakeven = calculateBreakevenMetrics(
    totalAllocatedNZD,
    model.merRate,
    estimatedTradeCount,
    brokeragePerTradeNZD,
    marginalTaxRate,
    model.estimatedYield
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
    `DIY Direct Index Trade Orders — ${plan.model.name} (Top ${plan.depth})`,
    `Mode: ${plan.mode === 'portfolio_aware' ? 'Portfolio-Aware' : 'Standalone'} | Target Direct Total: $${plan.totalAllocatedNZD.toFixed(0)} NZD`,
    `Est. Annual Fee Saved: $${plan.breakeven.annualFeeDragNZD.toFixed(2)}/yr (${(plan.model.merRate * 100).toFixed(2)}% fee) | Breakeven: ${Number.isFinite(plan.breakeven.breakevenMonths) ? plan.breakeven.breakevenMonths.toFixed(1) + ' months' : 'N/A'}`,
    '',
  ];

  let idx = 1;
  for (const r of plan.rows) {
    if (r.priceNZD > 0 && r.action === 'HOLD') continue;
    if (r.priceNZD <= 0 && r.targetAllocationNZD <= 0) continue;

    const pricePart =
      r.priceNative > 0
        ? `@ ~${r.currency === 'AUD' ? 'A$' : '$'}${r.priceNative.toFixed(2)} ${r.currency} (~$${Math.abs(r.deltaValueNZD).toFixed(0)} NZD)`
        : `(Target: $${r.targetAllocationNZD.toFixed(0)} NZD — price needed)`;
    const fundSources = r.existingSourcesLabel
      .split(' + ')
      .filter((s) => s && s !== 'Direct')
      .join(', ');
    const note = r.overlapTrimmed
      ? ` [Reduced: $${r.existingIndirectNZD.toFixed(0)} held in ${fundSources || 'funds'}]`
      : '';
    if (r.priceNZD > 0) {
      lines.push(`${idx}. ${r.action} ${Math.abs(r.deltaShares).toLocaleString()} ${r.ticker} ${pricePart}${note}`);
    } else {
      lines.push(`${idx}. BUY ${r.ticker} ${pricePart}${note}`);
    }
    idx++;
  }

  if (idx === 1) {
    lines.push('No trades required — portfolio is already aligned with targets.');
  }

  return lines.join('\n');
}
