import React, { useMemo, useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import { FundMetadata, UserPortfolioState } from '../../types/portfolio';

interface FundAllocationsPanelProps {
  portfolioState: UserPortfolioState;
  fundsRegistry: FundMetadata[];
  totalPortfolioNZD: number;
  fundSumNZD: number;
  onAssignBucket: (instrumentKey: string, bucketId: string) => void;
  onUpdateState: (state: UserPortfolioState) => void;
}

export const FundAllocationsPanel: React.FC<FundAllocationsPanelProps> = ({
  portfolioState,
  fundsRegistry,
  totalPortfolioNZD,
  fundSumNZD,
  onAssignBucket,
  onUpdateState,
}) => {
  const [fundFilter, setFundFilter] = useState('');
  const [heldOnly, setHeldOnly] = useState(false);

  const sortedFilteredFunds = useMemo(() => {
    const q = fundFilter.trim().toLowerCase();
    return [...fundsRegistry]
      .sort((a, b) => a.code.localeCompare(b.code))
      .filter((f) => {
        if (heldOnly && (portfolioState.fundBalances[f.code] || 0) <= 0) return false;
        if (!q) return true;
        return (
          f.code.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q) ||
          f.provider.toLowerCase().includes(q)
        );
      });
  }, [fundsRegistry, fundFilter, heldOnly, portfolioState.fundBalances]);

  const handleFundChange = (code: string, value: string) => {
    const num = parseFloat(value) || 0;
    const newBalances = { ...portfolioState.fundBalances };
    const nextAssignments = { ...portfolioState.bucketAssignments };
    if (num <= 0) {
      delete newBalances[code];
      delete nextAssignments[`fund:${code}`];
    } else {
      newBalances[code] = num;
    }
    onUpdateState({ ...portfolioState, fundBalances: newBalances, bucketAssignments: nextAssignments });
  };

  return (
    <CollapsiblePanel
      id="input-funds"
      title={
        <span className="text-xs uppercase tracking-wider text-slate-300">
          1. Fund Allocations by Ticker (NZD)
        </span>
      }
      headerRight={
        <span className="text-xs text-sky-400 font-mono">
          {totalPortfolioNZD > 0 ? ((fundSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
        </span>
      }
    >
      <div className="flex items-center gap-2 mb-2.5 text-xs">
        <input
          type="text"
          value={fundFilter}
          onChange={(e) => setFundFilter(e.target.value)}
          placeholder="Filter fund ticker or name..."
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={heldOnly}
            onChange={(e) => setHeldOnly(e.target.checked)}
            className="rounded border-slate-700 bg-slate-950 text-indigo-600"
          />
          <span>Held only</span>
        </label>
      </div>

      <div className="space-y-2 text-xs max-h-[380px] overflow-y-auto pr-1">
        {sortedFilteredFunds.length === 0 ? (
          <div className="text-center py-4 text-slate-500">No funds match current filter.</div>
        ) : (
          sortedFilteredFunds.map((fund) => {
            const balance = portfolioState.fundBalances[fund.code] || 0;
            return (
              <div
                key={fund.code}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white flex items-center gap-1.5 truncate">
                    <span className="bg-indigo-950 text-indigo-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-indigo-700/50">
                      {fund.code}
                    </span>
                    <span className="truncate">{fund.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {fund.provider} · {fund.asset_class === 'fixed_interest' ? 'Bonds' : fund.asset_class === 'mixed' ? 'Mixed' : 'Equity'} · As Of {fund.effective_date}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <BucketSelect
                    instrumentKey={`fund:${fund.code}`}
                    buckets={portfolioState.buckets}
                    bucketAssignments={portfolioState.bucketAssignments}
                    onAssign={onAssignBucket}
                  />
                  <div className="w-36 sm:w-44 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      min="0"
                      value={balance > 0 ? balance : ''}
                      placeholder="0"
                      onChange={(e) => handleFundChange(fund.code, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2.5 py-1.5 text-right text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </CollapsiblePanel>
  );
};

