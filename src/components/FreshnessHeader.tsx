import React from 'react';
import { dispatchToggleAllPanels } from './CollapsiblePanel';
import { FreshnessEnvelope, UserPortfolioState } from '../types/portfolio';

const ExpandAllIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m7 6 5 5 5-5" />
    <path d="m7 13 5 5 5-5" />
  </svg>
);

const CollapseAllIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m17 18-5-5-5 5" />
    <path d="m17 11-5-5-5 5" />
  </svg>
);
import {
  LoadSource,
  isSamplePortfolio,
} from '../storage/localStorage';

interface FreshnessHeaderProps {
  envelope: FreshnessEnvelope;
  portfolioState: UserPortfolioState;
  onOpenUnresolvedModal: () => void;
  unresolvedCount: number;
  loadSource?: LoadSource;
  recoveredNotice?: string | null;
}

export const FreshnessHeader: React.FC<FreshnessHeaderProps> = ({
  envelope,
  portfolioState,
  onOpenUnresolvedModal,
  unresolvedCount,
  loadSource = 'v2',
  recoveredNotice = null,
}) => {
  const isCustomPortfolio = loadSource !== 'default' && !isSamplePortfolio(portfolioState);

  return (
    <header className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 md:p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-2xl">🥝</span>
          <h1 className="text-xl font-bold tracking-tight text-white">Kiwi Portfolio X-Ray</h1>
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
        {(isCustomPortfolio || recoveredNotice) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 pt-0.5">
            {isCustomPortfolio && (
              <span
                title="Auto-saves to portfolio_backup.json at repo root (and browser localStorage)."
                className="inline-flex items-center gap-1.5"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Auto-saved to repo &amp; browser</span>
              </span>
            )}
            {recoveredNotice && (
              <span className="text-amber-300 bg-amber-950/50 border border-amber-700/50 px-2 py-0.5 rounded">
                {recoveredNotice}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-start md:items-end gap-2.5">
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
        </div>

        {/* Expand / Collapse All Panel Controls (Bottom-Right Corner) */}
        <div
          className="flex items-center gap-1 bg-slate-950/80 border border-slate-800 rounded-lg p-0.5 shadow-sm"
          title="Toggle all collapsible panels"
        >
          <button
            type="button"
            onClick={() => dispatchToggleAllPanels(true)}
            title="Expand All Panels"
            aria-label="Expand All Panels"
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <ExpandAllIcon className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-3 bg-slate-800" />
          <button
            type="button"
            onClick={() => dispatchToggleAllPanels(false)}
            title="Collapse All Panels"
            aria-label="Collapse All Panels"
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <CollapseAllIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

