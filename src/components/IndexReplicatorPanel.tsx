import React, { useEffect, useMemo, useState } from 'react';
import {
  ConsolidatedHolding,
  Constituent,
  DEFAULT_STARTER_BUCKETS,
  DirectEquityCatalogItem,
  DirectHolding,
  UserPortfolioState,
} from '../types/portfolio';
import {
  REPLICATOR_INDEX_MODELS,
  ReplicationMode,
  formatTradeOrderList,
  generateReplicationPlan,
} from '../engine/replicator';
import { formatNZD } from '../utils/format';
import { fetchNzxPrices, loadStoredDailyPrices } from '../utils/prices';
import { CollapsiblePanel } from './CollapsiblePanel';

interface IndexReplicatorPanelProps {
  portfolioState: UserPortfolioState;
  constituentsMap: Record<string, Constituent[]>;
  lookThroughHoldings: ConsolidatedHolding[];
  directEquitiesCatalog: DirectEquityCatalogItem[];
  onUpdateState: (state: UserPortfolioState) => void;
}

export const IndexReplicatorPanel: React.FC<IndexReplicatorPanelProps> = ({
  portfolioState,
  constituentsMap,
  lookThroughHoldings,
  directEquitiesCatalog,
  onUpdateState,
}) => {
  const [selectedCode, setSelectedCode] = useState<string>('DIV');
  const [depth, setDepth] = useState<number>(8);
  const [budgetInput, setBudgetInput] = useState<string>('50000');
  const [brokerageInput, setBrokerageInput] = useState<string>('4.50');
  const [mode, setMode] = useState<ReplicationMode>('portfolio_aware');
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [applyFeedback, setApplyFeedback] = useState<string | null>(null);

  const availableModels = useMemo(() => {
    const present = REPLICATOR_INDEX_MODELS.filter(
      (m) => (constituentsMap[m.code] || []).length > 0
    );
    return present.length > 0 ? present : REPLICATOR_INDEX_MODELS;
  }, [constituentsMap]);

  const activeModel = useMemo(
    () => availableModels.find((m) => m.code === selectedCode) || availableModels[0],
    [availableModels, selectedCode]
  );

  useEffect(() => {
    const stored = loadStoredDailyPrices();
    if (stored?.prices) {
      setPriceOverrides((prev) => ({ ...stored.prices, ...prev }));
    }
  }, [portfolioState.directHoldings]);

  const budgetNZD = Math.max(0, parseFloat(budgetInput) || 0);
  const brokeragePerTrade = Math.max(0, parseFloat(brokerageInput) || 0);

  const plan = useMemo(() => {
    const constituents = constituentsMap[activeModel.code] || [];
    return generateReplicationPlan({
      model: activeModel,
      constituents,
      depth,
      budgetNZD,
      mode,
      existingDirectHoldings: portfolioState.directHoldings || [],
      lookThroughHoldings,
      directCatalog: directEquitiesCatalog,
      pricesByTicker: priceOverrides,
      audNzdRate: portfolioState.audNzdRate || 1.09,
      brokeragePerTradeNZD: brokeragePerTrade,
    });
  }, [
    activeModel,
    constituentsMap,
    depth,
    budgetNZD,
    mode,
    portfolioState.directHoldings,
    portfolioState.audNzdRate,
    lookThroughHoldings,
    directEquitiesCatalog,
    priceOverrides,
    brokeragePerTrade,
  ]);

  const handleFetchLivePrices = async () => {
    const tickers = plan.rows.map((r) => r.ticker).filter(Boolean);
    if (!tickers.length) return;
    setIsFetchingPrices(true);
    try {
      const res = await fetchNzxPrices(tickers, true);
      if (res.prices && Object.keys(res.prices).length > 0) {
        setPriceOverrides((prev) => ({ ...prev, ...res.prices }));
      }
    } catch {
      // Offline / static fallback: user can type prices inline
    } finally {
      setIsFetchingPrices(false);
    }
  };

  const handleCopyTrades = async () => {
    const text = formatTradeOrderList(plan);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('Copied trade sheet!');
      setTimeout(() => setCopyFeedback(null), 2500);
    } catch {
      setCopyFeedback('Copy failed — select text manually');
      setTimeout(() => setCopyFeedback(null), 2500);
    }
  };

  const handleApplyToPortfolio = () => {
    const actionable = plan.rows.filter((r) => r.targetShares > 0 && r.priceNative > 0);
    if (!actionable.length) {
      setApplyFeedback('Enter or fetch share prices first so share counts can be calculated.');
      setTimeout(() => setApplyFeedback(null), 3500);
      return;
    }

    const nextDirect = [...(portfolioState.directHoldings || [])];
    const nextAssignments = { ...(portfolioState.bucketAssignments || {}) };
    const buckets =
      portfolioState.buckets.length > 0 ? portfolioState.buckets : DEFAULT_STARTER_BUCKETS;
    const preferredBucket =
      buckets.find((b) => /div|income|yield/i.test(b.name)) ||
      buckets.find((b) => /growth|equit/i.test(b.name)) ||
      buckets[0];

    let updatedCount = 0;
    for (const row of actionable) {
      const existingIdx = nextDirect.findIndex(
        (d) =>
          !d.isEtf &&
          (d.isin === row.isin ||
            d.ticker.toUpperCase().replace(/\.(NZ|AX)$/i, '') ===
              row.ticker.toUpperCase().replace(/\.(NZ|AX)$/i, ''))
      );

      const newHolding: DirectHolding = {
        isin: row.isin,
        name: row.name,
        ticker: row.ticker,
        exchange: row.exchange,
        country: row.country,
        sector: row.sector,
        currency: row.currency,
        shares: row.targetShares,
        price: row.priceNative,
        value: Number((row.targetShares * row.priceNative).toFixed(2)),
      };

      if (existingIdx >= 0) {
        nextDirect[existingIdx] = {
          ...nextDirect[existingIdx],
          shares: row.targetShares,
          price: row.priceNative,
          value: newHolding.value,
        };
      } else {
        nextDirect.push(newHolding);
      }

      const bKey = `direct:${row.isin}`;
      if (!nextAssignments[bKey] && preferredBucket) {
        nextAssignments[bKey] = preferredBucket.id;
      }
      updatedCount++;
    }

    onUpdateState({
      ...portfolioState,
      directHoldings: nextDirect,
      bucketAssignments: nextAssignments,
      timestamp: new Date().toISOString(),
    });
    setApplyFeedback(`Applied ${updatedCount} direct shareholdings to Panel 1.`);
    setTimeout(() => setApplyFeedback(null), 3500);
  };

  const missingPriceCount = plan.rows.filter((r) => r.priceNative <= 0).length;
  const breakevenLabel = !Number.isFinite(plan.breakeven.breakevenMonths)
    ? '—'
    : plan.breakeven.breakevenMonths < 1
      ? '< 1 month'
      : `${plan.breakeven.breakevenMonths.toFixed(1)} months`;

  return (
    <CollapsiblePanel
      id="index-replicator"
      defaultOpen={false}
      title="⚡ DIY Direct Index Rebalancer (DIV / ASD)"
      subtitle="Replicate top-heavy NZX/ASX indices directly to save on ongoing ETF management fees"
      className="md:p-5"
    >
      <div className="space-y-4 text-xs pt-1">
        {/* Step 1: Configuration */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              1. Index Model, Capital &amp; Overlap Mode
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Target Index</label>
              <select
                value={activeModel.code}
                onChange={(e) => setSelectedCode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs"
              >
                {availableModels.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Holding Depth (Top {depth} = {(plan.rawIndexCoverage * 100).toFixed(1)}% of index)
              </label>
              <select
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs"
              >
                <option value={6}>Top 6 Holdings (Fewest Trades)</option>
                <option value={8}>Top 8 Holdings (Recommended)</option>
                <option value={10}>Top 10 Holdings</option>
                <option value={12}>Top 12 Holdings</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Target Holding (NZD)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Est. Brokerage / Trade (NZD)
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={brokerageInput}
                onChange={(e) => setBrokerageInput(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-200">
                <input
                  type="radio"
                  name="panel-replication-mode"
                  checked={mode === 'portfolio_aware'}
                  onChange={() => setMode('portfolio_aware')}
                  className="accent-indigo-500"
                />
                <span>Whole-Portfolio Aware (trims overlap with KiwiSaver / Funds)</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="radio"
                  name="panel-replication-mode"
                  checked={mode === 'standalone'}
                  onChange={() => setMode('standalone')}
                  className="accent-indigo-500"
                />
                <span>Standalone Holding</span>
              </label>
            </div>

            <button
              type="button"
              onClick={handleFetchLivePrices}
              disabled={isFetchingPrices}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 text-[11px] font-medium disabled:opacity-50"
            >
              {isFetchingPrices ? '⏳ Updating Prices...' : '↻ Update Prices'}
            </button>
          </div>

          {missingPriceCount > 0 && (
            <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-1.5 text-amber-200 text-[11px]">
              ⚠️ {missingPriceCount} stock(s) need a share price to compute share counts. Click{' '}
              <strong>Update Prices</strong> above or enter a price inline.
            </div>
          )}
        </div>

        {/* Breakeven KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <div className="text-[11px] text-slate-400">
              Annual Passive Fee Drag ({(activeModel.merRate * 100).toFixed(2)}% MER)
            </div>
            <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">
              ${formatNZD(plan.breakeven.annualFeeDragNZD)} / yr
            </div>
            <div className="text-[11px] text-slate-500">
              5-yr net savings: ${formatNZD(plan.breakeven.fiveYearNetSavingsNZD)}
            </div>
          </div>

          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <div className="text-[11px] text-slate-400">
              Est. Setup Brokerage ({plan.breakeven.activeTradeCount} trades)
            </div>
            <div className="text-lg font-bold font-mono text-slate-100 mt-0.5">
              ${formatNZD(plan.breakeven.estimatedBrokerageNZD)}
            </div>
            <div className="text-[11px] text-slate-500">
              One-off @ ${formatNZD(plan.breakeven.brokeragePerTradeNZD)} / order
            </div>
          </div>

          <div className="bg-slate-950/70 border border-emerald-900/50 rounded-xl p-3">
            <div className="text-[11px] text-slate-400">Breakeven Payoff Time</div>
            <div className="text-lg font-bold font-mono text-emerald-400 mt-0.5">
              {breakevenLabel}
            </div>
            <div className="text-[11px] text-slate-400">
              Year 1 net gain:{' '}
              <span
                className={
                  plan.breakeven.yearOneNetSavingsNZD >= 0
                    ? 'text-emerald-300 font-mono'
                    : 'text-amber-300 font-mono'
                }
              >
                {plan.breakeven.yearOneNetSavingsNZD < 0 ? '-' : ''}${formatNZD(Math.abs(plan.breakeven.yearOneNetSavingsNZD))}
              </span>
            </div>
          </div>
        </div>

        {/* Step 2: Constituent Table */}
        <div className="border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/90 text-[11px] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Constituent</th>
                <th className="py-2 px-2 text-right">Target %</th>
                <th className="py-2 px-2 text-right">Target $</th>
                <th className="py-2 px-2 text-right">Held in Funds</th>
                <th className="py-2 px-2 text-right">Held Directly</th>
                <th className="py-2 px-2 text-right">Price ({activeModel.currency})</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {plan.rows.map((r) => {
                const displayTargetNZD =
                  mode === 'portfolio_aware'
                    ? r.targetAllocationNZD + Math.min(r.existingIndirectNZD, r.baselineTargetNZD)
                    : r.targetAllocationNZD;
                const fundSourcesOnly = r.existingSourcesLabel
                  .split(' + ')
                  .filter((s) => s && s !== 'Direct')
                  .join(', ');
                return (
                <tr key={r.isin + r.ticker} className="hover:bg-slate-800/40">
                  <td className="py-2 px-3">
                    <div className="font-medium text-slate-100">
                      {r.name}{' '}
                      <span className="font-mono text-[11px] text-sky-400">({r.ticker})</span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {r.sector} · Index: {(r.originalIndexWeight * 100).toFixed(2)}%
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-slate-200">
                    {(r.adjustedSleeveWeight * 100).toFixed(1)}%
                  </td>
                  <td
                    className="py-2 px-2 text-right font-mono text-slate-100"
                    title={
                      mode === 'portfolio_aware' && r.existingIndirectNZD > 0
                        ? `Total target: $${formatNZD(displayTargetNZD)} ($${formatNZD(r.targetAllocationNZD)} direct + $${formatNZD(Math.min(r.existingIndirectNZD, r.baselineTargetNZD))} in funds)`
                        : `Direct target: $${formatNZD(r.targetAllocationNZD)}`
                    }
                  >
                    ${formatNZD(displayTargetNZD)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono">
                    {r.existingIndirectNZD > 0 ? (
                      <div>
                        <span className={mode === 'portfolio_aware' ? 'text-indigo-300' : 'text-slate-400'}>
                          ${formatNZD(r.existingIndirectNZD)}
                        </span>
                        {fundSourcesOnly && (
                          <div className="text-[10px] text-slate-500">{fundSourcesOnly}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600">$0</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right font-mono">
                    {r.existingDirectNZD > 0 ? (
                      <div>
                        <span className="text-amber-300">${formatNZD(r.existingDirectNZD)}</span>
                        {r.existingDirectShares > 0 && (
                          <div className="text-[10px] text-slate-500">
                            {r.existingDirectShares.toLocaleString()} sh
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-600">$0</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={r.priceNative > 0 ? r.priceNative : ''}
                      placeholder="0.00"
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setPriceOverrides((prev) => ({
                          ...prev,
                          [r.ticker]: Number.isFinite(val) && val > 0 ? val : 0,
                        }));
                      }}
                      className="w-20 text-right bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 font-mono text-xs text-slate-100"
                    />
                  </td>
                  <td className="py-2 px-3 text-right font-mono">
                    {r.priceNZD <= 0 ? (
                      <span className="text-slate-500">Need price</span>
                    ) : r.action === 'BUY' ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-700/50">
                        BUY {r.deltaShares.toLocaleString()}
                      </span>
                    ) : r.action === 'SELL' ? (
                      <span className="px-2 py-0.5 rounded bg-rose-950/70 text-rose-300 border border-rose-700/50">
                        SELL {Math.abs(r.deltaShares).toLocaleString()}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        {r.driftSuppressed ? 'HOLD (±2.5%)' : 'HOLD'}
                      </span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-950/80 border-t border-slate-700 font-mono text-slate-200">
                <td className="py-2 px-3 font-sans font-semibold">
                  Total ({plan.rows.length} holdings)
                </td>
                <td className="py-2 px-2 text-right">100.0%</td>
                <td className="py-2 px-2 text-right">
                  ${formatNZD(
                    plan.rows.reduce(
                      (acc, r) =>
                        acc +
                        (mode === 'portfolio_aware'
                          ? r.targetAllocationNZD + Math.min(r.existingIndirectNZD, r.baselineTargetNZD)
                          : r.targetAllocationNZD),
                      0
                    )
                  )}
                </td>
                <td className="py-2 px-2 text-right text-indigo-300">
                  ${formatNZD(plan.rows.reduce((acc, r) => acc + r.existingIndirectNZD, 0))}
                </td>
                <td className="py-2 px-2 text-right text-amber-300">
                  ${formatNZD(plan.rows.reduce((acc, r) => acc + r.existingDirectNZD, 0))}
                </td>
                <td colSpan={2} className="py-2 px-3 text-right text-slate-400">
                  Est. Trade Value: ${formatNZD(plan.totalTradeValueNZD)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="text-xs text-emerald-300">
            {applyFeedback || copyFeedback || (
              <span className="text-slate-500">
                Educational planning tool — verify prices &amp; brokerage before placing orders.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyTrades}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium"
            >
              📋 Copy Trade Orders
            </button>
            <button
              type="button"
              onClick={handleApplyToPortfolio}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              ➕ Apply Direct Shares to Panel 1
            </button>
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  );
};
