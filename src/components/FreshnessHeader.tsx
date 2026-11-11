import React, { useRef } from 'react';
import { dispatchToggleAllPanels } from './CollapsiblePanel';
import { FreshnessEnvelope, UserPortfolioState } from '../types/portfolio';
import {
  DEFAULT_PORTFOLIO_STATE,
  LoadSource,
  exportHoldingsCSV,
  exportPortfolioJSON,
  importPortfolioJSON,
  isFileSyncSupported,
} from '../storage/localStorage';
import { ConsolidatedHolding } from '../types/portfolio';
import type { LinkedFileStatus } from '../App';

interface FreshnessHeaderProps {
  envelope: FreshnessEnvelope;
  portfolioState: UserPortfolioState;
  holdings: ConsolidatedHolding[];
  onUpdateState: (state: UserPortfolioState) => void;
  onOpenUnresolvedModal: () => void;
  unresolvedCount: number;
  loadSource?: LoadSource;
  recoveredNotice?: string | null;
  linkedFileInfo?: LinkedFileStatus | null;
  onLinkNewBackupFile?: () => void;
  onOpenAndLinkBackupFile?: () => void;
  onResumeLinkedFile?: () => void;
  onUnlinkBackupFile?: () => void;
}

export const FreshnessHeader: React.FC<FreshnessHeaderProps> = ({
  envelope,
  portfolioState,
  holdings,
  onUpdateState,
  onOpenUnresolvedModal,
  unresolvedCount,
  loadSource = 'v2',
  recoveredNotice = null,
  linkedFileInfo = null,
  onLinkNewBackupFile,
  onOpenAndLinkBackupFile,
  onResumeLinkedFile,
  onUnlinkBackupFile,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasEnteredPortfolio =
    Object.keys(portfolioState.fundBalances).length > 0 ||
    portfolioState.directHoldings.length > 0 ||
    portfolioState.cashDeposits.length > 0 ||
    portfolioState.buckets.length > 0;

  const handleLoadSample = () => {
    if (
      loadSource !== 'default' &&
      hasEnteredPortfolio &&
      !window.confirm('Replace your saved portfolio with the sample portfolio?')
    ) {
      return;
    }
    onUpdateState({
      ...DEFAULT_PORTFOLIO_STATE,
      timestamp: new Date().toISOString(),
    });
  };

  const handleClearPortfolio = () => {
    if (
      hasEnteredPortfolio &&
      !window.confirm('Clear all entered funds, direct shares, and term deposits?')
    ) {
      return;
    }
    onUpdateState({
      ...portfolioState,
      fundBalances: {},
      directHoldings: [],
      cashDeposits: [],
      bucketAssignments: {},
    });
  };

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
    const inputEl = e.target;
    const file = inputEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const imported = importPortfolioJSON(content);
        onUpdateState(imported);
      } catch (err) {
        alert('Failed to import JSON portfolio file: ' + err);
      } finally {
        inputEl.value = '';
      }
    };
    reader.readAsText(file);
  };

  const originLabel = typeof window !== 'undefined' ? window.location.host || 'local file' : 'browser';
  const savedTimeLabel = (() => {
    const d = new Date(portfolioState.timestamp);
    return Number.isNaN(d.getTime())
      ? ''
      : d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });
  })();

  return (
    <header className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 md:p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5 flex-wrap">
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
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 pt-0.5">
          <span
            title="Browser LocalStorage + IndexedDB are scoped to this exact host/port. Use Export JSON before switching ports or browsers."
            className="inline-flex items-center gap-1.5"
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                loadSource === 'default' ? 'bg-slate-500' : 'bg-emerald-400'
              }`}
            />
            {loadSource === 'default' ? (
              <span>Showing sample portfolio (edit any holding to auto-save in {originLabel})</span>
            ) : (
              <span>
                Auto-saved in browser ({originLabel}){savedTimeLabel ? ` · ${savedTimeLabel}` : ''}
              </span>
            )}
          </span>
          {recoveredNotice && (
            <span className="text-amber-300 bg-amber-950/50 border border-amber-700/50 px-2 py-0.5 rounded">
              {recoveredNotice}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className={`bg-slate-950/80 border rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs ${
            envelope.isAnyStale ? 'border-amber-600/60' : 'border-slate-800'
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                envelope.isAnyStale ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
            ></span>
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                envelope.isAnyStale ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
            ></span>
          </span>
          <span className="text-slate-400">Holdings As Of:</span>
          {envelope.minEffectiveDate === 'N/A' ? (
            <span className="font-medium text-slate-400">No active fund dates</span>
          ) : (
            <>
              <span className="font-medium text-amber-300">
                {envelope.minEffectiveDate} – {envelope.maxEffectiveDate}
              </span>
              <span className="text-[11px] text-slate-500">(Spread: {envelope.spreadDays}d)</span>
            </>
          )}
          {envelope.isAnyStale && (
            <span className="text-[11px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-medium">
              Stale (&gt;90d)
            </span>
          )}
        </div>

        <button
          onClick={() => dispatchToggleAllPanels(true)}
          className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          Expand All
        </button>
        <button
          onClick={() => dispatchToggleAllPanels(false)}
          className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          Collapse All
        </button>
        <button
          onClick={handleLoadSample}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm"
        >
          Load Sample
        </button>
        <button
          onClick={handleClearPortfolio}
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

        {isFileSyncSupported() && !linkedFileInfo && (
          <>
            <button
              onClick={onLinkNewBackupFile}
              title="Create a local JSON file and auto-save every portfolio edit to disk"
              className="text-xs bg-emerald-950/70 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-700/60 px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              Link Backup File
            </button>
            <button
              onClick={onOpenAndLinkBackupFile}
              title="Open an existing JSON backup file and keep auto-saving edits back to it"
              className="text-xs bg-slate-950 hover:bg-slate-800 text-emerald-300 border border-emerald-800/60 px-3 py-1.5 rounded-lg transition-colors"
            >
              Open &amp; Link
            </button>
          </>
        )}

        {linkedFileInfo && linkedFileInfo.status === 'needs_permission' && (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={onResumeLinkedFile}
              title="Click to restore holdings from your linked disk file and resume auto-saving"
              className="text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium px-3 py-1.5 rounded-lg transition-colors shadow-sm"
            >
              Reconnect {linkedFileInfo.name}
            </button>
            <button
              onClick={onUnlinkBackupFile}
              title="Unlink backup file"
              className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-rose-400 border border-slate-800 px-2 py-1.5 rounded-lg transition-colors"
            >
              ✕
            </button>
          </div>
        )}

        {linkedFileInfo && linkedFileInfo.status === 'synced' && (
          <div className="inline-flex items-center gap-1 bg-emerald-950/60 border border-emerald-700/50 rounded-lg px-2.5 py-1 text-xs text-emerald-300">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="font-mono max-w-[160px] truncate" title={`Auto-saving to ${linkedFileInfo.name}`}>
              {linkedFileInfo.name}
            </span>
            <button
              onClick={onUnlinkBackupFile}
              title="Unlink backup file"
              className="ml-1 text-emerald-400/70 hover:text-rose-400 transition-colors"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

