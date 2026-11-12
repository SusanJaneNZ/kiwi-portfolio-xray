import React, { useMemo, useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import { DirectEquityCatalogItem, UserPortfolioState } from '../../types/portfolio';
import { directHoldingValueNZD, formatNZD } from '../../utils/format';

interface DirectSharesPanelProps {
  portfolioState: UserPortfolioState;
  directEquitiesCatalog: DirectEquityCatalogItem[];
  totalPortfolioNZD: number;
  directSumNZD: number;
  onAssignBucket: (instrumentKey: string, bucketId: string) => void;
  onUpdateState: (state: UserPortfolioState) => void;
}

export const DirectSharesPanel: React.FC<DirectSharesPanelProps> = ({
  portfolioState,
  directEquitiesCatalog,
  totalPortfolioNZD,
  directSumNZD,
  onAssignBucket,
  onUpdateState,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEquity, setSelectedEquity] = useState<DirectEquityCatalogItem | null>(null);
  const [newShareValue, setNewShareValue] = useState<string>('1000');

  const hasASXHoldings = portfolioState.directHoldings.some(
    (h) => h.exchange === 'ASX' || h.currency === 'AUD'
  );

  const sortedDirectHoldings = useMemo(
    () => [...portfolioState.directHoldings].sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [portfolioState.directHoldings]
  );

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matches = directEquitiesCatalog.filter(
      (eq) =>
        eq.name.toLowerCase().includes(q) ||
        eq.ticker.toLowerCase().includes(q) ||
        eq.isin.toLowerCase().includes(q)
    );
    const rankMatch = (eq: DirectEquityCatalogItem) => {
      const t = eq.ticker.toLowerCase();
      const baseTicker = t.split('.')[0];
      if (t === q || baseTicker === q || eq.isin.toLowerCase() === q) return 0;
      if (t.startsWith(q)) return 1;
      if (eq.name.toLowerCase().startsWith(q)) return 2;
      return 3;
    };
    return matches.sort((a, b) => rankMatch(a) - rankMatch(b) || a.ticker.localeCompare(b.ticker)).slice(0, 6);
  }, [searchQuery, directEquitiesCatalog]);

  const handleDirectHoldingChange = (isin: string, value: string) => {
    const parsed = parseFloat(value);
    const num = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    const updated = portfolioState.directHoldings.map((h) => (h.isin === isin ? { ...h, value: num } : h));
    onUpdateState({ ...portfolioState, directHoldings: updated });
  };

  const handleRemoveDirect = (isin: string) => {
    const updated = portfolioState.directHoldings.filter((h) => h.isin !== isin);
    const nextAssignments = { ...portfolioState.bucketAssignments };
    delete nextAssignments[`direct:${isin}`];
    onUpdateState({ ...portfolioState, directHoldings: updated, bucketAssignments: nextAssignments });
  };

  const handleAddDirect = () => {
    if (!selectedEquity) return;
    const parsedVal = parseFloat(newShareValue);
    const val = Number.isFinite(parsedVal) && parsedVal > 0 ? parsedVal : 0;
    if (val <= 0) return;
    const existingIndex = portfolioState.directHoldings.findIndex(
      (h) =>
        h.isin === selectedEquity.isin ||
        (h.exchange === selectedEquity.exchange &&
          h.ticker.toUpperCase() === selectedEquity.ticker.toUpperCase())
    );
    const updated = [...portfolioState.directHoldings];
    if (existingIndex >= 0) {
      updated[existingIndex] = { ...updated[existingIndex], value: updated[existingIndex].value + val };
    } else {
      updated.push({
        ...selectedEquity,
        currency: selectedEquity.exchange === 'ASX' ? 'AUD' : 'NZD',
        value: val,
      });
    }
    onUpdateState({ ...portfolioState, directHoldings: updated });
    setSelectedEquity(null);
    setSearchQuery('');
  };

  return (
    <CollapsiblePanel
      id="input-direct"
      title={
        <span className="text-xs uppercase tracking-wider text-slate-300">
          2. Direct Shares by Ticker (NZX / ASX)
        </span>
      }
      headerRight={
        <span className="text-xs text-emerald-400 font-mono">
          {totalPortfolioNZD > 0 ? ((directSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
        </span>
      }
    >
      <div className="space-y-3">
        {hasASXHoldings && (
          <div className="bg-amber-950/30 border border-amber-600/40 rounded-xl p-2.5 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">💱</span>
              <div>
                <span className="font-semibold text-amber-300">ASX Holdings Detected:</span>
                <p className="text-[11px] text-amber-200/70">Custom AUD / NZD Exchange Rate</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400">1 AUD =</span>
              <input
                type="number"
                min="0.01"
                value={portfolioState.audNzdRate}
                step="0.005"
                onChange={(e) => {
                  const nextRate = parseFloat(e.target.value);
                  if (Number.isFinite(nextRate) && nextRate > 0) {
                    onUpdateState({ ...portfolioState, audNzdRate: nextRate });
                  }
                }}
                className="w-24 bg-slate-950 border border-amber-500/50 rounded px-2.5 py-1.5 text-right text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-400"
              />
              <span className="text-xs text-amber-300 font-mono">NZD</span>
            </div>
          </div>
        )}

        <div className="space-y-2 text-xs">
          {sortedDirectHoldings.map((dh) => {
            const isAud = dh.currency === 'AUD';
            const convertedNZD = directHoldingValueNZD(dh, portfolioState.audNzdRate);

            return (
              <div
                key={dh.isin}
                className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white flex items-center gap-1.5 truncate">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                        dh.exchange === 'ASX'
                          ? 'bg-amber-950 text-amber-300 border-amber-700/50'
                          : 'bg-teal-950 text-teal-300 border-teal-700/50'
                      }`}
                    >
                      {dh.ticker}
                    </span>
                    <span className="truncate">{dh.name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {dh.exchange} · {dh.isin}
                    {isAud && ` (${dh.value.toFixed(2)} AUD -> $${formatNZD(convertedNZD, 2)} NZD)`}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <BucketSelect
                    instrumentKey={`direct:${dh.isin}`}
                    buckets={portfolioState.buckets}
                    bucketAssignments={portfolioState.bucketAssignments}
                    onAssign={onAssignBucket}
                  />
                  <div className="w-36 sm:w-44 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                      {isAud ? 'A$' : '$'}
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={dh.value > 0 ? dh.value : ''}
                      placeholder="0"
                      onChange={(e) => handleDirectHoldingChange(dh.isin, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-right text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500 font-mono"
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveDirect(dh.isin)}
                    className="text-slate-500 hover:text-rose-400 text-xs p-1"
                    title="Remove holding"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          <div className="pt-2 relative">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedEquity(null);
                }}
                placeholder="Search direct share e.g. AIA, CSL..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
              {selectedEquity && (
                <div className="w-36 sm:w-44 relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                    {selectedEquity.exchange === 'ASX' ? 'A$' : '$'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={newShareValue}
                    onChange={(e) => setNewShareValue(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-right text-xs sm:text-sm text-white font-mono"
                  />
                </div>
              )}
              <button
                disabled={!selectedEquity}
                onClick={handleAddDirect}
                className="bg-indigo-600 disabled:opacity-40 hover:bg-indigo-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                + Add
              </button>
            </div>

            {filteredCatalog.length > 0 && !selectedEquity && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden divide-y divide-slate-800">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.isin}
                    onClick={() => {
                      setSelectedEquity(item);
                      setSearchQuery(`${item.ticker} - ${item.name}`);
                    }}
                    className="p-2 text-xs hover:bg-slate-800 cursor-pointer flex justify-between items-center"
                  >
                    <div>
                      <strong className="text-white font-mono">{item.ticker}</strong> · {item.name}
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">{item.exchange}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </CollapsiblePanel>
  );
};

