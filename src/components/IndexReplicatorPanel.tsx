import React, { useEffect, useMemo, useState } from 'react';
import {
  ConsolidatedHolding,
  Constituent,
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
  onUpdateState: (action: UserPortfolioState | ((prev: UserPortfolioState) => UserPortfolioState)) => void;
}

const normBase = (t: string) => t.trim().toUpperCase().replace(/\.(NZ|AX)$/i, '');

export const IndexReplicatorPanel: React.FC<IndexReplicatorPanelProps> = ({
  portfolioState,
  constituentsMap,
  lookThroughHoldings,
  directEquitiesCatalog,
  onUpdateState,
}) => {
  const savedSettings = portfolioState.replicatorSettings;
  const [selectedCode, setSelectedCode] = useState<string>(() => savedSettings?.selectedCode || 'DIV');
  const [depth, setDepth] = useState<number>(() => savedSettings?.depth || 8);
  const [budgetInput, setBudgetInput] = useState<string>(() =>
    savedSettings?.targetHoldingNZD !== undefined ? String(savedSettings.targetHoldingNZD) : '50000'
  );
  const [brokerageInput, setBrokerageInput] = useState<string>(() =>
    savedSettings?.brokerageNZD !== undefined ? String(savedSettings.brokerageNZD) : '4.50'
  );
  const [mode, setMode] = useState<ReplicationMode>(() => savedSettings?.mode || 'portfolio_aware');
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [priceFeedback, setPriceFeedback] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [applyFeedback, setApplyFeedback] = useState<string | null>(null);

  // Sync local state if replicatorSettings change externally (e.g. backup import/restore)
  useEffect(() => {
    if (!savedSettings) return;
    if (savedSettings.selectedCode && savedSettings.selectedCode !== selectedCode) {
      setSelectedCode(savedSettings.selectedCode);
    }
    if (savedSettings.depth !== undefined && savedSettings.depth !== depth) {
      setDepth(savedSettings.depth);
    }
    if (savedSettings.targetHoldingNZD !== undefined) {
      const parsed = parseFloat(budgetInput);
      if (!Number.isFinite(parsed) || parsed !== savedSettings.targetHoldingNZD) {
        setBudgetInput(String(savedSettings.targetHoldingNZD));
      }
    }
    if (savedSettings.brokerageNZD !== undefined) {
      const parsed = parseFloat(brokerageInput);
      if (!Number.isFinite(parsed) || parsed !== savedSettings.brokerageNZD) {
        setBrokerageInput(String(savedSettings.brokerageNZD));
      }
    }
    if (savedSettings.mode && savedSettings.mode !== mode) {
      setMode(savedSettings.mode);
    }
  }, [savedSettings]);

  const persistReplicatorSettings = (patch: Partial<NonNullable<UserPortfolioState['replicatorSettings']>>) => {
    onUpdateState((prev) => ({
      ...prev,
      replicatorSettings: {
        selectedCode: prev.replicatorSettings?.selectedCode || selectedCode,
        depth: prev.replicatorSettings?.depth ?? depth,
        targetHoldingNZD:
          prev.replicatorSettings?.targetHoldingNZD ?? (Math.max(0, parseFloat(budgetInput) || 0)),
        brokerageNZD:
          prev.replicatorSettings?.brokerageNZD ?? (Math.max(0, parseFloat(brokerageInput) || 0)),
        mode: prev.replicatorSettings?.mode || mode,
        ...patch,
      },
    }));
  };

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
    setPriceFeedback(null);
    try {
      const res = await fetchNzxPrices(tickers, true);
      if (res.prices && Object.keys(res.prices).length > 0) {
        setPriceOverrides((prev) => ({ ...prev, ...res.prices }));
        setPriceFeedback(`Updated ${Object.keys(res.prices).length} price(s) (as of ${res.date}).`);
      } else {
        setPriceFeedback(res.error || 'No end-of-day prices found for these stocks. Enter prices manually.');
      }
    } catch (err) {
      setPriceFeedback(`Could not load prices: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsFetchingPrices(false);
    }
  };

  const handleCopyTrades = async () => {
    const text = formatTradeOrderList(plan);
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('Trade orders copied.');
      setTimeout(() => setCopyFeedback(null), 2500);
    } catch {
      setCopyFeedback('Copy failed — clipboard access unavailable.');
      setTimeout(() => setCopyFeedback(null), 2500);
    }
  };

  const handleApplyToPortfolio = () => {
    if (budgetNZD <= 0 && !plan.rows.some((r) => r.existingDirectShares > 0)) {
      setApplyFeedback('Enter a Target Holding amount greater than $0 first.');
      setTimeout(() => setApplyFeedback(null), 3500);
      return;
    }

    const actionable = plan.rows.filter(
      (r) => r.priceNative > 0 && (r.targetShares > 0 || r.existingDirectShares > 0)
    );
    if (!actionable.length) {
      setApplyFeedback('Enter or update share prices first to calculate share counts.');
      setTimeout(() => setApplyFeedback(null), 3500);
      return;
    }

    const buysOrUpdates = actionable.filter((r) => r.targetShares > 0).length;
    const removals = actionable.filter((r) => r.targetShares === 0 && r.existingDirectShares > 0).length;
    const summaryParts: string[] = [];
    if (buysOrUpdates > 0) summaryParts.push(`update/add ${buysOrUpdates} direct stock(s)`);
    if (removals > 0) summaryParts.push(`remove ${removals} sold-to-zero stock(s)`);

    if (
      !window.confirm(
        `Apply this plan to your live Portfolio? This will ${summaryParts.join(' and ')} in Direct Shares & ETFs.`
      )
    ) {
      return;
    }

    const catalogByExchangeIsin = new Map(
      directEquitiesCatalog.filter((c) => !c.isEtf).map((c) => [`${c.exchange}:${c.isin}`, c])
    );
    let updatedCount = 0;

    onUpdateState((prev) => {
      const nextDirect = [...(prev.directHoldings || [])];
      const nextAssignments = { ...(prev.bucketAssignments || {}) };
      const preferredBucket =
        prev.buckets.length > 0
          ? prev.buckets.find((b) => /div|income|yield/i.test(b.name)) ||
            prev.buckets.find((b) => /growth|equit/i.test(b.name)) ||
            prev.buckets[0]
          : undefined;

      for (const row of actionable) {
        const existingIdx = nextDirect.findIndex(
          (d) =>
            !d.isEtf &&
            d.exchange === row.exchange &&
            (d.isin === row.isin || normBase(d.ticker) === normBase(row.ticker))
        );

        if (row.targetShares === 0) {
          if (existingIdx >= 0) {
            const removed = nextDirect[existingIdx];
            nextDirect.splice(existingIdx, 1);
            delete nextAssignments[`direct:${removed.isin}`];
            updatedCount++;
          }
          continue;
        }

        const catItem = catalogByExchangeIsin.get(`${row.exchange}:${row.isin}`);
        const newHolding: DirectHolding = {
          isin: row.isin,
          name: row.name,
          ticker: row.ticker,
          exchange: row.exchange,
          country: row.country,
          sector: row.sector,
          issuer_key: catItem?.issuer_key,
          issuer_name: catItem?.issuer_name,
          currency: row.currency,
          shares: row.targetShares,
          price: row.priceNative,
          value: Number((row.targetShares * row.priceNative).toFixed(2)),
        };

        let assignedIsin = row.isin;
        if (existingIdx >= 0) {
          const existing = nextDirect[existingIdx];
          assignedIsin = existing.isin;
          nextDirect[existingIdx] = {
            ...existing,
            exchange: row.exchange,
            currency: row.currency,
            shares: row.targetShares,
            price: row.priceNative,
            value: newHolding.value,
          };
        } else {
          nextDirect.push(newHolding);
        }

        const bKey = `direct:${assignedIsin}`;
        if (!nextAssignments[bKey] && preferredBucket) {
          nextAssignments[bKey] = preferredBucket.id;
        }
        updatedCount++;
      }

      return {
        ...prev,
        directHoldings: nextDirect,
        bucketAssignments: nextAssignments,
        timestamp: new Date().toISOString(),
      };
    });

    setApplyFeedback(
      `Applied ${actionable.length} direct ${actionable.length === 1 ? 'stock' : 'stocks'} to Portfolio.`
    );
    setTimeout(() => setApplyFeedback(null), 3500);
  };

  const missingPriceCount = plan.rows.filter((r) => r.priceNative <= 0).length;
  const effectiveFx = portfolioState.audNzdRate > 0 ? portfolioState.audNzdRate : 1.09;
  const rowTargets = plan.rows.map((r) => r.baselineTargetNZD);
  const totalDisplayTargetNZD = rowTargets.reduce((acc, v) => acc + v, 0);

  const breakevenLabel = !Number.isFinite(plan.breakeven.breakevenMonths)
    ? '—'
    : plan.breakeven.breakevenMonths < 1
      ? '< 1 month'
      : `${plan.breakeven.breakevenMonths.toFixed(1)} months`;

  return (
    <CollapsiblePanel
      id="index-replicator"
      defaultOpen={false}
      title="DIY Direct Index Replicator"
      subtitle="Buy top NZX/ASX index stocks directly to avoid ongoing ETF management fees."
      className="md:p-5"
    >
      <div className="space-y-4 text-xs pt-1">
        {/* Plan Settings */}
        <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Plan Settings
            </span>
            {activeModel.currency === 'AUD' && (
              <span className="text-[11px] font-mono text-sky-300 bg-sky-950/50 border border-sky-800/40 rounded px-2 py-0.5">
                FX: 1 AUD = {effectiveFx.toFixed(4)} NZD (all $ columns in NZD)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Target Index</label>
              <select
                value={activeModel.code}
                onChange={(e) => {
                  const code = e.target.value;
                  setSelectedCode(code);
                  persistReplicatorSettings({ selectedCode: code });
                }}
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
                Stocks to Hold (Top {plan.depth} = {(plan.rawIndexCoverage * 100).toFixed(1)}% of index)
              </label>
              <select
                value={depth}
                onChange={(e) => {
                  const nextDepth = Number(e.target.value);
                  setDepth(nextDepth);
                  persistReplicatorSettings({ depth: nextDepth });
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 text-xs"
              >
                <option value={6}>Top 6 stocks (fewest trades)</option>
                <option value={8}>Top 8 stocks (recommended)</option>
                <option value={10}>Top 10 stocks</option>
                <option value={12}>Top 12 stocks</option>
                {(constituentsMap[activeModel.code] || []).filter((c) => c.asset_class === 'equity' && c.weight > 0).length > 12 && (
                  <option
                    value={(constituentsMap[activeModel.code] || []).filter((c) => c.asset_class === 'equity' && c.weight > 0).length}
                  >
                    All {(constituentsMap[activeModel.code] || []).filter((c) => c.asset_class === 'equity' && c.weight > 0).length} stocks (full index)
                  </option>
                )}
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
                onChange={(e) => {
                  const val = e.target.value;
                  setBudgetInput(val);
                  const parsed = parseFloat(val);
                  if (Number.isFinite(parsed) && parsed >= 0) {
                    persistReplicatorSettings({ targetHoldingNZD: parsed });
                  } else if (val === '') {
                    persistReplicatorSettings({ targetHoldingNZD: 0 });
                  }
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Brokerage / Trade (NZD)
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={brokerageInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setBrokerageInput(val);
                  const parsed = parseFloat(val);
                  if (Number.isFinite(parsed) && parsed >= 0) {
                    persistReplicatorSettings({ brokerageNZD: parsed });
                  }
                }}
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
                  onChange={() => {
                    setMode('portfolio_aware');
                    persistReplicatorSettings({ mode: 'portfolio_aware' });
                  }}
                  className="accent-indigo-500"
                />
                <span>Portfolio-Aware (trims overlap with KiwiSaver &amp; funds)</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="radio"
                  name="panel-replication-mode"
                  checked={mode === 'standalone'}
                  onChange={() => {
                    setMode('standalone');
                    persistReplicatorSettings({ mode: 'standalone' });
                  }}
                  className="accent-indigo-500"
                />
                <span>Standalone (ignore existing funds)</span>
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

          {priceFeedback && (
            <div className="bg-slate-900/80 border border-slate-700/70 rounded-lg px-3 py-1.5 text-slate-300 text-[11px]">
              {priceFeedback}
            </div>
          )}

          {missingPriceCount > 0 && (
            <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-1.5 text-amber-200 text-[11px]">
              ⚠️ {missingPriceCount} stock(s) missing a price. Click{' '}
              <strong>Update Prices</strong> above or enter a price in the table.
            </div>
          )}
        </div>

        {/* Breakeven KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
            <div className="text-[11px] text-slate-400">
              Annual ETF Fee Saved ({(activeModel.merRate * 100).toFixed(2)}% fee)
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
              One-off @ ${formatNZD(plan.breakeven.brokeragePerTradeNZD)} / trade
            </div>
          </div>

          <div className="bg-slate-950/70 border border-emerald-900/50 rounded-xl p-3">
            <div className="text-[11px] text-slate-400">Breakeven Time</div>
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

        {/* Constituent Table */}
        <div className="border border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/90 text-[11px] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Company</th>
                <th className="py-2 px-2 text-right">Target %</th>
                <th className="py-2 px-2 text-right">Target $ (NZD)</th>
                <th className="py-2 px-2 text-right">
                  Held in Funds{mode === 'standalone' ? ' (ignored)' : ''}
                </th>
                <th className="py-2 px-2 text-right">Held Directly</th>
                <th className="py-2 px-2 text-right">Price ({activeModel.currency})</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {plan.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    No constituent data loaded for {activeModel.code}.
                  </td>
                </tr>
              ) : (
                plan.rows.map((r, rowIdx) => {
                  const displayTargetNZD = rowTargets[rowIdx];
                  const displayTargetPct =
                    totalDisplayTargetNZD > 0 ? (displayTargetNZD / totalDisplayTargetNZD) * 100 : 0;
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
                        {displayTargetPct.toFixed(1)}%
                      </td>
                      <td
                        className="py-2 px-2 text-right font-mono text-slate-100"
                        title={
                          mode === 'portfolio_aware' && r.existingIndirectNZD > 0
                            ? r.existingIndirectNZD > r.baselineTargetNZD + 0.01
                              ? `Ideal target: $${formatNZD(r.baselineTargetNZD)} — already holding $${formatNZD(r.existingIndirectNZD)} in funds ($0 direct needed)`
                              : `Ideal target: $${formatNZD(displayTargetNZD)} ($${formatNZD(r.targetAllocationNZD)} direct + $${formatNZD(r.existingIndirectNZD)} in funds)`
                            : `Target holding: $${formatNZD(displayTargetNZD)}`
                        }
                      >
                        ${formatNZD(displayTargetNZD)}
                      </td>
                      <td className="py-2 px-2 text-right font-mono">
                        {r.existingIndirectNZD > 0 ? (
                          <div>
                            <span className={mode === 'portfolio_aware' ? 'text-indigo-300' : 'text-slate-500'}>
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
                        {r.existingDirectNZD > 0 || r.existingDirectShares > 0 ? (
                          <div>
                            <span className={r.existingDirectNZD > 0 ? 'text-amber-300' : 'text-slate-400'}>
                              ${formatNZD(r.existingDirectNZD)}
                            </span>
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
                          <span
                            className="px-2 py-0.5 rounded bg-slate-800 text-slate-400"
                            title={
                              r.driftSuppressed
                                ? 'Within ±2.5% of target — trade skipped to save brokerage'
                                : 'Already at target'
                            }
                          >
                            {r.driftSuppressed ? 'HOLD (±2.5%)' : 'HOLD'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-950/80 border-t border-slate-700 font-mono text-slate-200">
                <td className="py-2 px-3 font-sans font-semibold">
                  Total ({plan.rows.length} stocks)
                </td>
                <td className="py-2 px-2 text-right">
                  {totalDisplayTargetNZD > 0 ? '100.0%' : '0.0%'}
                </td>
                <td className="py-2 px-2 text-right">
                  ${formatNZD(totalDisplayTargetNZD)}
                </td>
                <td className={`py-2 px-2 text-right ${mode === 'portfolio_aware' ? 'text-indigo-300' : 'text-slate-500'}`}>
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
                Verify prices and brokerage fees before placing orders.
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyTrades}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium"
            >
              Copy Trade Orders
            </button>
            <button
              type="button"
              onClick={handleApplyToPortfolio}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
            >
              Apply to Portfolio
            </button>
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  );
};
