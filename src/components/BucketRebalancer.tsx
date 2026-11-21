import React, { useMemo, useState } from 'react';
import { CollapsiblePanel } from './CollapsiblePanel';
import { calculateBucketRebalance } from '../engine/rebalance';
import { PortfolioBucket, UserPortfolioState } from '../types/portfolio';
import { formatNZD } from '../utils/format';

interface BucketRebalancerProps {
  portfolioState: UserPortfolioState;
  onUpdateState: (state: UserPortfolioState) => void;
  suggestedDrawdownNZD?: number;
  activeWithdrawal?: number;
}

const STARTER_PRESET: PortfolioBucket[] = [
  { id: 'bkt-growth', name: 'Growth', targetPercent: 60 },
  { id: 'bkt-defensive', name: 'Defensive', targetPercent: 40 },
];

const fmtMoney = (v: number) => formatNZD(v, 2);

export const BucketRebalancer: React.FC<BucketRebalancerProps> = ({
  portfolioState,
  onUpdateState,
  suggestedDrawdownNZD,
  activeWithdrawal,
}) => {
  const [withdrawalInput, setWithdrawalInput] = useState<string>(() =>
    activeWithdrawal !== undefined ? String(activeWithdrawal) : '0'
  );

  React.useEffect(() => {
    if (activeWithdrawal !== undefined && !isNaN(activeWithdrawal)) {
      setWithdrawalInput(String(activeWithdrawal));
    }
  }, [activeWithdrawal]);
  const [newBucketName, setNewBucketName] = useState<string>('');
  const [newBucketTarget, setNewBucketTarget] = useState<string>('20');

  const plannedWithdrawalNZD = Math.max(0, parseFloat(withdrawalInput) || 0);

  const rebalanceResult = useMemo(
    () =>
      calculateBucketRebalance({
        buckets: portfolioState.buckets,
        bucketAssignments: portfolioState.bucketAssignments,
        fundBalances: portfolioState.fundBalances,
        directHoldings: portfolioState.directHoldings,
        fixedInterest: portfolioState.fixedInterest || portfolioState.cashDeposits,
        audNzdRate: portfolioState.audNzdRate,
        plannedWithdrawalNZD,
      }),
    [portfolioState, plannedWithdrawalNZD]
  );

  const handleApplyPreset = () => {
    if (
      portfolioState.buckets.length > 0 &&
      !window.confirm('Replace your existing buckets with the 60% Growth / 40% Defensive preset?')
    ) {
      return;
    }
    const nextAssignments: Record<string, string> = {};
    // Convenience auto-assign fixed interest & cash into Defensive bucket when applying starter preset
    const fiList = portfolioState.fixedInterest || portfolioState.cashDeposits || [];
    for (const dep of fiList) {
      nextAssignments[`fi:${dep.id}`] = 'bkt-defensive';
    }
    onUpdateState({
      ...portfolioState,
      buckets: STARTER_PRESET.map((b) => ({ ...b })),
      bucketAssignments: nextAssignments,
    });
  };

  const handleAddBucket = () => {
    const name = newBucketName.trim();
    if (!name) return;
    const targetPercent = Math.max(0, Math.min(100, parseFloat(newBucketTarget) || 0));
    const id = `bkt-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    onUpdateState({
      ...portfolioState,
      buckets: [...portfolioState.buckets, { id, name, targetPercent }],
    });
    setNewBucketName('');
    setNewBucketTarget('20');
  };

  const handleUpdateBucket = (id: string, patch: Partial<PortfolioBucket>) => {
    const updated = portfolioState.buckets.map((b) => (b.id === id ? { ...b, ...patch } : b));
    onUpdateState({ ...portfolioState, buckets: updated });
  };

  const handleDeleteBucket = (id: string) => {
    const updatedBuckets = portfolioState.buckets.filter((b) => b.id !== id);
    const updatedAssignments: Record<string, string> = {};
    for (const [k, bId] of Object.entries(portfolioState.bucketAssignments)) {
      if (bId !== id) updatedAssignments[k] = bId;
    }
    onUpdateState({
      ...portfolioState,
      buckets: updatedBuckets,
      bucketAssignments: updatedAssignments,
    });
  };

  const handleNormalizeTargets = () => {
    if (portfolioState.buckets.length === 0) return;
    const sum = portfolioState.buckets.reduce((acc, b) => acc + Math.max(0, b.targetPercent), 0);
    let scaled: number[];

    if (sum <= 0) {
      // If all targets are 0, distribute equally across buckets
      const base = Math.floor((100 / portfolioState.buckets.length) * 100) / 100;
      scaled = portfolioState.buckets.map(() => base);
      const roundedSum = scaled.reduce((a, b) => a + b, 0);
      scaled[0] = Math.round((scaled[0] + (100 - roundedSum)) * 100) / 100;
    } else {
      scaled = portfolioState.buckets.map((b) => Math.round(((Math.max(0, b.targetPercent) / sum) * 100) * 100) / 100);
      const roundedSum = scaled.reduce((a, b) => a + b, 0);
      const diff = Math.round((100 - roundedSum) * 100) / 100;
      const largestIdx = scaled.reduce((best, val, i, arr) => (val > arr[best] ? i : best), 0);
      scaled[largestIdx] = Math.round((scaled[largestIdx] + diff) * 100) / 100;
    }

    onUpdateState({
      ...portfolioState,
      buckets: portfolioState.buckets.map((b, i) => ({ ...b, targetPercent: scaled[i] })),
    });
  };

  const handleAssignUnassigned = (key: string, bucketId: string) => {
    if (!bucketId) return;
    onUpdateState({
      ...portfolioState,
      bucketAssignments: {
        ...portfolioState.bucketAssignments,
        [key]: bucketId,
      },
    });
  };

  const targetSumValid = Math.abs(rebalanceResult.targetSumPercent - 100) <= 0.01;
  const anyCombinedLiquidation = rebalanceResult.rows.some((r) => r.withdrawNZD > 0 && r.sellNZD > 0);
  const anyTermDepositOutflow = rebalanceResult.rows.some(
    (r) => r.hasTermDeposits && r.withdrawNZD + r.sellNZD > 0
  );

  return (
    <CollapsiblePanel
      id="bucket-rebalancer"
      title={<span>Buckets &amp; Withdrawal Rebalancer</span>}
      subtitle="Group holdings into target buckets to calculate minimum-turnover withdrawals and rebalance trades."
      className="md:p-5"
    >
      <div className="space-y-4">

      {/* Bucket Configuration Bar */}
      <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-slate-400 text-[11px]">
            Bucket Targets
          </span>
          {portfolioState.buckets.length > 0 && (
            <div className="flex items-center gap-2">
              <span
                className={`font-mono px-2 py-0.5 rounded-full text-[11px] border ${
                  targetSumValid
                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50'
                    : 'bg-amber-950/60 text-amber-300 border-amber-700/50'
                }`}
              >
                Target Sum: {rebalanceResult.targetSumPercent.toFixed(1)}%
              </span>
              {!targetSumValid && (
                <button
                  onClick={handleNormalizeTargets}
                  className="text-[11px] bg-amber-600 hover:bg-amber-500 text-white px-2 py-0.5 rounded font-medium"
                >
                  Normalize to 100%
                </button>
              )}
            </div>
          )}
        </div>

        {portfolioState.buckets.length === 0 && (
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <span>No buckets configured yet. Add custom buckets below, or load the starter preset.</span>
            <button
              onClick={handleApplyPreset}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 whitespace-nowrap font-medium"
            >
              Load 60 / 40 Preset
            </button>
          </div>
        )}

        {portfolioState.buckets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {portfolioState.buckets.map((bucket) => (
              <div
                key={bucket.id}
                className="bg-slate-900 border border-slate-800 rounded-lg p-2 flex items-center gap-2 text-xs"
              >
                <input
                  type="text"
                  value={bucket.name}
                  onChange={(e) => handleUpdateBucket(bucket.id, { name: e.target.value })}
                  className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white font-medium focus:outline-none focus:border-indigo-500"
                />
                <div className="w-20 relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={bucket.targetPercent}
                    onChange={(e) =>
                      handleUpdateBucket(bucket.id, {
                        targetPercent: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)),
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded pl-2 pr-5 py-1 text-right text-sky-300 font-mono focus:outline-none"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 text-[11px]">%</span>
                </div>
                <button
                  onClick={() => handleDeleteBucket(bucket.id)}
                  className="text-slate-500 hover:text-rose-400 p-1"
                  title="Delete bucket"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="text"
            value={newBucketName}
            onChange={(e) => setNewBucketName(e.target.value)}
            placeholder="New bucket name (e.g. Growth Equities)"
            className="flex-1 min-w-[200px] bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white placeholder-slate-500"
          />
          <div className="w-24 relative">
            <input
              type="number"
              min="0"
              max="100"
              aria-label="New bucket target percent"
              value={newBucketTarget}
              onChange={(e) => setNewBucketTarget(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-2.5 pr-6 py-1.5 text-right text-white font-mono"
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">%</span>
          </div>
          <button
            onClick={handleAddBucket}
            disabled={!newBucketName.trim()}
            className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg font-medium"
          >
            + Add Bucket
          </button>
        </div>
      </div>

      {/* Unassigned Holdings Quick-Assigner */}
      {portfolioState.buckets.length > 0 && rebalanceResult.unassignedHoldings.length > 0 && (
        <div className="bg-amber-950/25 border border-amber-700/40 rounded-xl p-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-amber-300">
              ⚠ ${fmtMoney(rebalanceResult.totalUnassignedNZD)} NZD in Unassigned Holdings (excluded from rebalance targets)
            </span>
            <span className="text-[11px] text-amber-200/70">Assign directly below or in Portfolio:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {rebalanceResult.unassignedHoldings.map((item) => (
              <div
                key={item.key}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 flex items-center gap-2"
              >
                <span className="text-slate-200 font-medium">{item.label}</span>
                <span className="font-mono text-slate-400">${fmtMoney(item.valueNZD)}</span>
                <select
                  value=""
                  aria-label={`Assign bucket for ${item.label}`}
                  onChange={(e) => handleAssignUnassigned(item.key, e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-amber-300"
                >
                  <option value="">Assign...</option>
                  {portfolioState.buckets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Planned Withdrawal & Rebalance Output */}
      {portfolioState.buckets.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-3 flex-wrap">
              <label htmlFor="planned-withdrawal-input" className="font-semibold text-white">
                Planned Withdrawal (NZD):
              </label>
              <div className="w-44 sm:w-48 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  id="planned-withdrawal-input"
                  type="number"
                  min="0"
                  step="100"
                  value={withdrawalInput}
                  onChange={(e) => setWithdrawalInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-right text-sm text-amber-300 font-mono font-bold focus:outline-none focus:border-amber-500"
                />
              </div>

              {suggestedDrawdownNZD !== undefined && suggestedDrawdownNZD > 0 && Math.abs(plannedWithdrawalNZD - suggestedDrawdownNZD) > 1 && (
                <button
                  type="button"
                  onClick={() => setWithdrawalInput(String(suggestedDrawdownNZD))}
                  className="text-[11px] bg-amber-900/40 hover:bg-amber-800/60 text-amber-200 border border-amber-700/50 rounded-lg px-2.5 py-1.5 transition-colors font-medium flex items-center gap-1 shadow-sm"
                  title="Sync with capital drawdown calculated in Projected Organic Cashflow above"
                >
                  <span>⚡ Use Capital Drawdown (${fmtMoney(suggestedDrawdownNZD)})</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 font-mono text-slate-300">
              <span>Assigned: <strong className="text-white">${fmtMoney(rebalanceResult.totalAssignedNZD)}</strong></span>
              <span>After Withdrawal: <strong className="text-emerald-400">${fmtMoney(rebalanceResult.postWithdrawalTotalNZD)}</strong></span>
            </div>
          </div>

          {!rebalanceResult.isValid ? (
            <div className="bg-rose-950/30 border border-rose-700/40 rounded-xl p-3 text-xs text-rose-300">
              {rebalanceResult.errorReason}
            </div>
          ) : (
            <>
              {!rebalanceResult.rebalanceRequired && (
                <div className="bg-emerald-950/30 border border-emerald-700/40 rounded-xl p-3 text-xs text-emerald-300 font-medium">
                  ✓ No additional rebalancing buys or sells required after withdrawal.
                </div>
              )}

              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
                <table className="w-full text-left text-xs min-w-[760px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-2.5 px-4">Bucket &amp; Holdings</th>
                      <th className="py-2.5 px-4 text-right">Current ($ / %)</th>
                      <th className="py-2.5 px-4 text-right">Target % (Drift)</th>
                      <th className="py-2.5 px-4 text-right">Withdraw (NZD)</th>
                      <th className="py-2.5 px-4 text-right">Rebalance Action</th>
                      <th className="py-2.5 px-4 text-right">Post-Rebalance ($ / %)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {rebalanceResult.rows.map((row) => (
                      <tr key={row.bucket.id} className="hover:bg-slate-900/50">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{row.bucket.name}</div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {row.assignedHoldings.length === 0
                              ? 'No holdings assigned'
                              : row.assignedHoldings.map((h) => h.label).join(', ')}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          <div className="text-white font-semibold">${fmtMoney(row.currentNZD)}</div>
                          <div className="text-[11px] text-slate-400">{row.currentAssignedPercent.toFixed(1)}%</div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          <div className="text-sky-300">{row.bucket.targetPercent.toFixed(1)}%</div>
                          <div
                            className={`text-[11px] ${
                              Math.abs(row.driftPercent) < 0.05
                                ? 'text-slate-500'
                                : row.driftPercent > 0
                                  ? 'text-amber-400'
                                  : 'text-sky-400'
                            }`}
                          >
                            {row.driftPercent >= 0 ? '+' : ''}
                            {row.driftPercent.toFixed(1)}%
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {row.withdrawNZD > 0 ? (
                            <span className="bg-amber-950/70 text-amber-300 border border-amber-700/50 px-2 py-0.5 rounded font-semibold">
                              -${fmtMoney(row.withdrawNZD)}
                            </span>
                          ) : (
                            <span className="text-slate-600">$0.00</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          {row.action === 'buy' && (
                            <span className="bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded font-semibold">
                              Buy +${fmtMoney(row.buyNZD)}
                            </span>
                          )}
                          {row.action === 'sell' && (
                            <span className="bg-rose-950/70 text-rose-300 border border-rose-700/50 px-2 py-0.5 rounded font-semibold">
                              Sell -${fmtMoney(row.sellNZD)}
                            </span>
                          )}
                          {row.action === 'hold' && (
                            <span className="text-slate-500">Hold</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono">
                          <div className="text-white">${fmtMoney(row.postBalanceNZD)}</div>
                          <div className="text-[11px] text-emerald-400">{row.postPercent.toFixed(1)}%</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="text-[11px] text-slate-400 space-y-1">
                <p>• Before rebalancing, ensure your share prices and current dollar balances for managed funds, KiwiSaver, and deposits are up to date in Portfolio above.</p>
                {anyCombinedLiquidation && (
                  <p>• Where both a Withdraw and Sell appear in a bucket, total cash to liquidate from that bucket is Withdraw + Sell.</p>
                )}
                {anyTermDepositOutflow && (
                  <p>• Note: Term Deposits normally cannot be withdrawn or sold before maturity without bank break fees — apply withdrawals from maturing deposits.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
      </div>
    </CollapsiblePanel>
  );
};

