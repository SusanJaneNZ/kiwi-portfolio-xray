import React, { useState } from 'react';
import { DirectEquityCatalogItem, FundMetadata, UserPortfolioState } from '../types/portfolio';

interface PortfolioInputTableProps {
  portfolioState: UserPortfolioState;
  fundsRegistry: FundMetadata[];
  directEquitiesCatalog: DirectEquityCatalogItem[];
  onUpdateState: (state: UserPortfolioState) => void;
  totalPortfolioNZD: number;
}

export const PortfolioInputTable: React.FC<PortfolioInputTableProps> = ({
  portfolioState,
  fundsRegistry,
  directEquitiesCatalog,
  onUpdateState,
  totalPortfolioNZD,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEquity, setSelectedEquity] = useState<DirectEquityCatalogItem | null>(null);
  const [newShareValue, setNewShareValue] = useState<string>('1000');

  // Check if any ASX holdings are present
  const hasASXHoldings = portfolioState.directHoldings.some((h) => h.exchange === 'ASX');

  // Handle fund balance change
  const handleFundChange = (code: string, value: string) => {
    const num = parseFloat(value) || 0;
    const newBalances = { ...portfolioState.fundBalances };
    if (num <= 0) {
      delete newBalances[code];
    } else {
      newBalances[code] = num;
    }
    onUpdateState({ ...portfolioState, fundBalances: newBalances });
  };

  // Handle direct holding value change
  const handleDirectHoldingChange = (isin: string, value: string) => {
    const num = parseFloat(value) || 0;
    const updated = portfolioState.directHoldings
      .map((h) => (h.isin === isin ? { ...h, value: num } : h))
      .filter((h) => h.value > 0);
    onUpdateState({ ...portfolioState, directHoldings: updated });
  };

  // Handle removing a direct holding
  const handleRemoveDirect = (isin: string) => {
    const updated = portfolioState.directHoldings.filter((h) => h.isin !== isin);
    onUpdateState({ ...portfolioState, directHoldings: updated });
  };

  // Handle adding direct holding
  const handleAddDirect = () => {
    if (!selectedEquity) return;
    const val = parseFloat(newShareValue) || 1000;
    const existingIndex = portfolioState.directHoldings.findIndex((h) => h.isin === selectedEquity.isin);
    let updated = [...portfolioState.directHoldings];
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

  // Autocomplete filtering
  const filteredCatalog = searchQuery.trim()
    ? directEquitiesCatalog
        .filter(
          (eq) =>
            eq.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            eq.ticker.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .slice(0, 6)
    : [];

  const fundSumNZD = Object.values(portfolioState.fundBalances).reduce((acc, v) => acc + v, 0);
  const directSumNZD = portfolioState.directHoldings.reduce(
    (acc, h) => acc + (h.currency === 'AUD' ? h.value * portfolioState.audNzdRate : h.value),
    0
  );

  return (
    <div className="space-y-4">
      {/* 1. Fund Allocations Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            1. Fund Allocations (NZD)
          </h2>
          <span className="text-xs text-sky-400 font-mono">
            {totalPortfolioNZD > 0 ? ((fundSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
          </span>
        </div>

        <div className="space-y-2 text-xs">
          {fundsRegistry.map((fund) => {
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
                    {fund.provider} · As Of {fund.effective_date}
                  </div>
                </div>
                <div className="w-28 relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                  <input
                    type="number"
                    value={balance > 0 ? balance : ''}
                    placeholder="0"
                    onChange={(e) => handleFundChange(fund.code, e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2 py-1 text-right text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Direct Shares Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            2. Direct Shares (NZX / ASX)
          </h2>
          <span className="text-xs text-emerald-400 font-mono">
            {totalPortfolioNZD > 0 ? ((directSumNZD / totalPortfolioNZD) * 100).toFixed(1) : 0}% of portfolio
          </span>
        </div>

        {/* Dynamic AUD/NZD Exchange Rate Banner */}
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
                value={portfolioState.audNzdRate}
                step="0.005"
                onChange={(e) =>
                  onUpdateState({
                    ...portfolioState,
                    audNzdRate: parseFloat(e.target.value) || 1.10,
                  })
                }
                className="w-20 bg-slate-950 border border-amber-500/50 rounded px-2 py-1 text-right text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-400"
              />
              <span className="text-xs text-amber-300 font-mono">NZD</span>
            </div>
          </div>
        )}

        <div className="space-y-2 text-xs">
          {portfolioState.directHoldings.map((dh) => {
            const isAud = dh.currency === 'AUD';
            const convertedNZD = isAud ? dh.value * portfolioState.audNzdRate : dh.value;

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
                    {isAud && ` (${dh.value.toFixed(2)} AUD -> $${convertedNZD.toFixed(2)} NZD)`}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="w-24 relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                      {isAud ? 'A$' : '$'}
                    </span>
                    <input
                      type="number"
                      value={dh.value}
                      onChange={(e) => handleDirectHoldingChange(dh.isin, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-6 pr-2 py-1 text-right text-xs text-white focus:outline-none font-mono"
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

          {/* Autocomplete share adder */}
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
                <div className="w-24 relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                    {selectedEquity.exchange === 'ASX' ? 'A$' : '$'}
                  </span>
                  <input
                    type="number"
                    value={newShareValue}
                    onChange={(e) => setNewShareValue(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-6 pr-2 py-1.5 text-xs text-white"
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

            {/* Dropdown suggestions */}
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
    </div>
  );
};

