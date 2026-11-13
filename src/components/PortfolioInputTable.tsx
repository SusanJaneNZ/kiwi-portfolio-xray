import React, { useRef } from 'react';
import {
  DirectEquityCatalogItem,
  FundMetadata,
  UserPortfolioState,
} from '../types/portfolio';
import { directHoldingValueNZD } from '../utils/format';
import { CollapsiblePanel } from './CollapsiblePanel';
import {
  DEFAULT_PORTFOLIO_STATE,
  createDatedBackupOnDisk,
  exportPortfolioJSON,
  importPortfolioJSON,
} from '../storage/localStorage';
import { FundAllocationsPanel } from './portfolio-inputs/FundAllocationsPanel';
import { DirectSharesPanel } from './portfolio-inputs/DirectSharesPanel';
import { CashDepositsPanel } from './portfolio-inputs/CashDepositsPanel';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasEnteredPortfolio =
    Object.keys(portfolioState.fundBalances).length > 0 ||
    portfolioState.directHoldings.length > 0 ||
    portfolioState.cashDeposits.length > 0 ||
    portfolioState.buckets.length > 0;

  const handleLoadSample = async () => {
    if (
      hasEnteredPortfolio &&
      !window.confirm('Replace your saved portfolio with the sample portfolio?')
    ) {
      return;
    }
    if (hasEnteredPortfolio) {
      await createDatedBackupOnDisk();
    }
    onUpdateState({
      ...DEFAULT_PORTFOLIO_STATE,
      timestamp: new Date().toISOString(),
    });
  };

  const handleClearPortfolio = async () => {
    if (
      hasEnteredPortfolio &&
      !window.confirm('Clear all entered funds, direct shares, and term deposits?')
    ) {
      return;
    }
    if (hasEnteredPortfolio) {
      await createDatedBackupOnDisk();
    }
    onUpdateState({
      ...portfolioState,
      fundBalances: {},
      directHoldings: [],
      cashDeposits: [],
      bucketAssignments: {},
    });
  };

  const handleExportPortfolio = () => {
    const jsonStr = exportPortfolioJSON(portfolioState);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kiwi_portfolio_${new Date().toISOString().split('T')[0]}.json`;
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

  const setBucketForKey = (instrumentKey: string, bucketId: string) => {
    const nextAssignments = { ...portfolioState.bucketAssignments };
    if (!bucketId) {
      delete nextAssignments[instrumentKey];
    } else {
      nextAssignments[instrumentKey] = bucketId;
    }
    onUpdateState({ ...portfolioState, bucketAssignments: nextAssignments });
  };

  const fundSumNZD = Object.values(portfolioState.fundBalances).reduce((acc, v) => acc + v, 0);
  const directSumNZD = portfolioState.directHoldings.reduce(
    (acc, h) => acc + directHoldingValueNZD(h, portfolioState.audNzdRate),
    0
  );
  const depositSumNZD = portfolioState.cashDeposits.reduce((acc, d) => acc + Math.max(0, d.valueNZD), 0);

  return (
    <CollapsiblePanel
      id="portfolio-inputs-group"
      defaultOpen={false}
      title={
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-white">Portfolio</span>
          <span className="text-xs font-mono font-normal bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
            ${totalPortfolioNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NZD
          </span>
        </div>
      }
      subtitle="Manage your index/KiwiSaver fund allocations, direct NZX/ASX shares, and bank term deposits."
      headerRight={
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleExportPortfolio}
            title="Export entered portfolio inputs as a JSON backup file"
            className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            Export Portfolio
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Import a previously saved JSON portfolio backup file"
            className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            Import Portfolio
          </button>
          <button
            onClick={handleClearPortfolio}
            title="Clear all entered fund balances, direct shares, and term deposits"
            className="text-xs bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            Clear Portfolio
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".json"
            className="hidden"
          />
        </div>
      }
      className="md:p-5"
    >
      <div className="space-y-4 pt-1">
        {totalPortfolioNZD === 0 && (
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <span>Portfolio is empty. Enter your holdings below, import a backup, or load sample data to test.</span>
            <button
              onClick={handleLoadSample}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline underline-offset-2 whitespace-nowrap"
            >
              Load Sample Portfolio
            </button>
          </div>
        )}
        <FundAllocationsPanel
          portfolioState={portfolioState}
          fundsRegistry={fundsRegistry}
          totalPortfolioNZD={totalPortfolioNZD}
          fundSumNZD={fundSumNZD}
          onAssignBucket={setBucketForKey}
          onUpdateState={onUpdateState}
        />

        <DirectSharesPanel
          portfolioState={portfolioState}
          directEquitiesCatalog={directEquitiesCatalog}
          totalPortfolioNZD={totalPortfolioNZD}
          directSumNZD={directSumNZD}
          onAssignBucket={setBucketForKey}
          onUpdateState={onUpdateState}
        />

        <CashDepositsPanel
          portfolioState={portfolioState}
          totalPortfolioNZD={totalPortfolioNZD}
          depositSumNZD={depositSumNZD}
          onAssignBucket={setBucketForKey}
          onUpdateState={onUpdateState}
        />
      </div>
    </CollapsiblePanel>
  );
};
