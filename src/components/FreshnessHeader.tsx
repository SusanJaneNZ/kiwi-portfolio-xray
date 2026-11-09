import React, { useRef } from 'react';
import { FreshnessEnvelope, UserPortfolioState } from '../types/portfolio';
import { DEFAULT_PORTFOLIO_STATE, exportHoldingsCSV, exportPortfolioJSON, importPortfolioJSON } from '../storage/localStorage';
import { ConsolidatedHolding } from '../types/portfolio';

interface FreshnessHeaderProps {
  envelope: FreshnessEnvelope;
  portfolioState: UserPortfolioState;
  holdings: ConsolidatedHolding[];
  onUpdateState: (state: UserPortfolioState) => void;
  onOpenUnresolvedModal: () => void;
  unresolvedCount: number;
}

export const FreshnessHeader: React.FC<FreshnessHeaderProps> = ({
  envelope,
  portfolioState,
  holdings,
  onUpdateState,
  onOpenUnresolvedModal,
  unresolvedCount,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportJSON = () => {
    const jsonStr = exportPortfolioJSON(portfolioState);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kiwi_portfolio_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const csvStr = exportHoldingsCSV(holdings);
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lookthrough_holdings_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const imported = importPortfolioJSON(content);
        onUpdateState(imported);
      } catch (err) {
        alert('Failed to import JSON portfolio file: ' + err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <header className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 md:p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🥝</span>
          <h1 className="text-xl font-bold tracking-tight text-white">Kiwi Portfolio X-Ray</h1>
          <span className="text-xs bg-emerald-500/15 text-emerald-400 font-medium px-2.5 py-0.5 rounded-full border border-emerald-500/30">
            Client-Side Look-Through
          </span>
          {unresolvedCount > 0 && (
            <button
              onClick={onOpenUnresolvedModal}
              className="text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-medium px-2.5 py-0.5 rounded-full border border-amber-500/40 transition-colors"
            >
              ⚠ {unresolvedCount} Unresolved
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400">
          Aggregating Smartshares, Kernel, Vanguard, and direct NZX/ASX equities into true underlying company exposures.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          <span className="text-slate-400">Holdings As Of:</span>
          <span className="font-medium text-amber-300">
            {envelope.minEffectiveDate} – {envelope.maxEffectiveDate}
          </span>
          <span className="text-[11px] text-slate-500">(Spread: {envelope.spreadDays}d)</span>
        </div>

        <button
          onClick={() => onUpdateState(DEFAULT_PORTFOLIO_STATE)}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          Load Sample
        </button>
        <button
          onClick={() =>
            onUpdateState({
              ...portfolioState,
              fundBalances: {},
              directHoldings: [],
            })
          }
          className="text-xs bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
        >
          Clear
        </button>
        <button
          onClick={handleExportJSON}
          className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
        >
          Export JSON
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
        >
          Import JSON
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImportFile}
          accept=".json"
          className="hidden"
        />
        <button
          onClick={handleExportCSV}
          className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
        >
          Export CSV
        </button>
      </div>
    </header>
  );
};

