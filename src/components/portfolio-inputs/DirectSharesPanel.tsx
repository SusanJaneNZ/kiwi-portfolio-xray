import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CollapsiblePanel } from '../CollapsiblePanel';
import { BucketSelect } from './BucketSelect';
import { DirectEquityCatalogItem, UserPortfolioState } from '../../types/portfolio';
import { directHoldingValueNZD, formatNZD } from '../../utils/format';
import { fetchLiveAudNzdRate } from '../../utils/fx';

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
  const [newShareCurrency, setNewShareCurrency] = useState<'NZD' | 'AUD'>('NZD');

  const [isFetchingFx, setIsFetchingFx] = useState(false);
  const [fxTimestamp, setFxTimestamp] = useState<string | null>(null);
  const hasAutoFetchedFx = useRef(false);

  // Check if any direct holdings are currently entered in AUD
  const hasAudHoldings = useMemo(
    () => portfolioState.directHoldings.some((h) => h.currency === 'AUD'),
    [portfolioState.directHoldings]
  );

  const fetchFxRate = async () => {
    setIsFetchingFx(true);
    try {
      const result = await fetchLiveAudNzdRate();
      if (result && result.rate > 0) {
        setFxTimestamp(result.timestamp);
        onUpdateState({ ...portfolioState, audNzdRate: result.rate });
      }
    } catch {
      // Fallback silently to existing rate
    } finally {
      setIsFetchingFx(false);
    }
  };

  // Automatically fetch live FX rate if AUD holdings exist and we haven't fetched yet
  useEffect(() => {
    if (hasAudHoldings && !hasAutoFetchedFx.current) {
      hasAutoFetchedFx.current = true;
      fetchFxRate();
    }
  }, [hasAudHoldings]);

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

  const handleCurrencyChange = (isin: string, currency: 'NZD' | 'AUD') => {
    const updated = portfolioState.directHoldings.map((h) =>
      h.isin === isin ? { ...h, currency } : h
    );
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
      updated[existingIndex] = {
        ...updated[existingIndex],
        currency: newShareCurrency,
        value: updated[existingIndex].value + val,
      };
    } else {
      updated.push({
        ...selectedEquity,
        currency: newShareCurrency,
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
        {/* Only display exchange rate panel if user has holdings entered in AUD */}
        {hasAudHoldings && (
          <div className="bg-slate-900/90 border border-indigo-900/40 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-base">💱</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-200">AUD / NZD Exchange Rate</span>
                  {fxTimestamp && (
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/40 rounded px-1.5 py-0.5">
                      ● Live ({fxTimestamp})
                    </span>
                  )}
                  {isFetchingFx && (
                    <span className="text-[10px] text-indigo-400 animate-pulse">
                      Updating...
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">
                  Applied automatically to direct shares held in AUD
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchFxRate}
                disabled={isFetchingFx}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded text-[11px] font-medium border border-slate-700 transition-colors flex items-center gap-1"
                title="Fetch current rate from live exchange API"
              >
                <span className={isFetchingFx ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
                <span>Live Rate</span>
              </button>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">1 AUD =</span>
                <input
                  type="number"
                  min="0.01"
                  value={portfolioState.audNzdRate}
                  step="0.001"
                  onChange={(e) => {
                    const nextRate = parseFloat(e.target.value);
                    if (Number.isFinite(nextRate) && nextRate > 0) {
                      onUpdateState({ ...portfolioState, audNzdRate: nextRate });
                    }
                  }}
                  className="w-20 bg-slate-950 border border-indigo-500/50 rounded px-2 py-1 text-right text-xs text-indigo-300 font-mono focus:outline-none focus:border-indigo-400"
                />
                <span className="text-xs text-indigo-300 font-mono">NZD</span>
              </div>
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
                    {isAud ? (
                      <span className="ml-1 text-amber-400/90">
                        ({dh.value.toFixed(2)} AUD → ${formatNZD(convertedNZD, 2)} NZD)
                      </span>
                    ) : (
                      <span className="ml-1 text-slate-400">
                        (NZD)
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <BucketSelect
                    instrumentKey={`direct:${dh.isin}`}
                    buckets={portfolioState.buckets}
                    bucketAssignments={portfolioState.bucketAssignments}
                    onAssign={onAssignBucket}
                  />

                  {/* Currency selector dropdown */}
                  <select
                    value={dh.currency || 'NZD'}
                    onChange={(e) => handleCurrencyChange(dh.isin, e.target.value as 'NZD' | 'AUD')}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                    title="Select currency for this holding"
                  >
                    <option value="NZD">NZD</option>
                    <option value="AUD">AUD</option>
                  </select>

                  <div className="w-32 sm:w-40 relative">
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
                <>
                  <select
                    value={newShareCurrency}
                    onChange={(e) => setNewShareCurrency(e.target.value as 'NZD' | 'AUD')}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500"
                    title="Select currency for new holding"
                  >
                    <option value="NZD">NZD</option>
                    <option value="AUD">AUD</option>
                  </select>
                  <div className="w-32 sm:w-40 relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                      {newShareCurrency === 'AUD' ? 'A$' : '$'}
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={newShareValue}
                      onChange={(e) => setNewShareValue(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-right text-xs sm:text-sm text-white font-mono"
                    />
                  </div>
                </>
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
                      setNewShareCurrency(item.exchange === 'ASX' ? 'AUD' : 'NZD');
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
