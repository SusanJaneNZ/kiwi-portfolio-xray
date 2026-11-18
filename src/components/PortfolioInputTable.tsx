import React, { useRef, useState } from 'react';
import {
  DEFAULT_STARTER_BUCKETS,
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
  exportPortfolioToDisk,
  fetchBackupsList,
  importPortfolioJSON,
  loadPortfolioFromDisk,
  DiskBackupInfo,
} from '../storage/localStorage';
import { FundAllocationsPanel } from './portfolio-inputs/FundAllocationsPanel';
import { DirectSharesPanel } from './portfolio-inputs/DirectSharesPanel';
import { FixedInterestPanel } from './portfolio-inputs/FixedInterestPanel';

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
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [availableBackups, setAvailableBackups] = useState<DiskBackupInfo[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fiList = portfolioState.fixedInterest || portfolioState.cashDeposits || [];
  const hasEnteredPortfolio =
    Object.keys(portfolioState.fundBalances).length > 0 ||
    portfolioState.directHoldings.length > 0 ||
    fiList.length > 0 ||
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
      fixedInterest: [],
      cashDeposits: [],
      bucketAssignments: {},
    });
  };

  const handleExportPortfolio = async () => {
    // 1. Export locally to backups/ folder under repo root
    const diskResult = await exportPortfolioToDisk(portfolioState);

    // 2. Download copy in browser
    const jsonStr = exportPortfolioJSON(portfolioState);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = diskResult.file || `kiwi_portfolio_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    const destMsg = diskResult.path || 'backups/';
    setNotice(`Exported to ${destMsg} and downloaded.`);
    setTimeout(() => setNotice(null), 4500);
  };

  const handleOpenImportModal = async () => {
    setIsImportModalOpen(true);
    setIsLoadingBackups(true);
    try {
      const list = await fetchBackupsList();
      setAvailableBackups(list);
    } finally {
      setIsLoadingBackups(false);
    }
  };

  const handleImportFromDisk = async (filename: string) => {
    try {
      const loaded = await loadPortfolioFromDisk(filename);
      if (!loaded) {
        alert(`Failed to load backup: ${filename}`);
        return;
      }
      onUpdateState(loaded);
      setIsImportModalOpen(false);
      setNotice(`Imported portfolio from backups/${filename}`);
      setTimeout(() => setNotice(null), 4500);
    } catch (err) {
      alert(`Failed to load backup: ${err}`);
    }
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
        setIsImportModalOpen(false);
        setNotice(`Imported portfolio from ${file.name}`);
        setTimeout(() => setNotice(null), 4500);
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
      if (instrumentKey.startsWith('fi:')) {
        delete nextAssignments[`td:${instrumentKey.slice(3)}`];
      }
    } else {
      nextAssignments[instrumentKey] = bucketId;
      if (instrumentKey.startsWith('fi:')) {
        delete nextAssignments[`td:${instrumentKey.slice(3)}`];
      }
    }
    const nextBuckets = portfolioState.buckets.length > 0 ? portfolioState.buckets : DEFAULT_STARTER_BUCKETS;
    onUpdateState({ ...portfolioState, buckets: nextBuckets, bucketAssignments: nextAssignments });
  };

  const managedFundSumNZD = Object.entries(portfolioState.fundBalances).reduce(
    (acc, [, val]) => acc + Math.max(0, val),
    0
  );

  const directSumNZD = portfolioState.directHoldings.reduce(
    (acc, h) => acc + directHoldingValueNZD(h, portfolioState.audNzdRate),
    0
  );
  const depositSumNZD = fiList.reduce((acc, d) => acc + Math.max(0, d.valueNZD), 0);

  return (
    <>
      <CollapsiblePanel
        id="portfolio-inputs-group"
        defaultOpen={false}
        title={
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-sm font-semibold text-white">Portfolio</span>
            <span className="text-xs font-mono font-normal bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
              ${totalPortfolioNZD.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} NZD
            </span>
            <span
              title="Continuous background persistence to local backups/ folder (backups/portfolio_backup.json in .gitignore) and browser storage."
              className="inline-flex items-center gap-1.5 text-[11px] font-normal text-emerald-400 bg-emerald-950/50 border border-emerald-800/40 px-2 py-0.5 rounded-full"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Portfolio auto-saved to <code className="font-mono text-emerald-300">backups/portfolio_backup.json</code></span>
            </span>
            {notice && (
              <span className="inline-flex items-center gap-1 text-[11px] text-cyan-300 bg-cyan-950/60 border border-cyan-800/50 px-2.5 py-0.5 rounded-full">
                ✓ {notice}
              </span>
            )}
          </div>
        }
        headerRight={
          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleExportPortfolio}
              title="Export entered portfolio inputs to local backups/ folder and download JSON backup file"
              className="text-xs bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-800 px-3 py-1.5 rounded-lg transition-colors"
            >
              Export Portfolio
            </button>
            <button
              onClick={handleOpenImportModal}
              title="Import portfolio defaults from local backups/ folder, or choose file from device"
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
          <DirectSharesPanel
            portfolioState={portfolioState}
            directEquitiesCatalog={directEquitiesCatalog}
            totalPortfolioNZD={totalPortfolioNZD}
            directSumNZD={directSumNZD}
            onAssignBucket={setBucketForKey}
            onUpdateState={onUpdateState}
          />

          <FundAllocationsPanel
            portfolioState={portfolioState}
            fundsRegistry={fundsRegistry}
            totalPortfolioNZD={totalPortfolioNZD}
            fundSumNZD={managedFundSumNZD}
            onAssignBucket={setBucketForKey}
            onUpdateState={onUpdateState}
          />

          <FixedInterestPanel
            portfolioState={portfolioState}
            totalPortfolioNZD={totalPortfolioNZD}
            fixedInterestSumNZD={depositSumNZD}
            onAssignBucket={setBucketForKey}
            onUpdateState={onUpdateState}
          />
        </div>
      </CollapsiblePanel>

      {/* Import Portfolio Modal defaulting to local backups/ directory */}
      {isImportModalOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setIsImportModalOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-semibold text-white">Import Portfolio</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Defaults from local <code className="font-mono text-emerald-400">backups/</code> folder under repo root.
                </p>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                <span>Local Backups (backups/)</span>
                <button
                  onClick={handleOpenImportModal}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-normal normal-case"
                >
                  Refresh
                </button>
              </div>

              {isLoadingBackups ? (
                <div className="p-4 text-center text-xs text-slate-400">Scanning backups/ directory...</div>
              ) : availableBackups.length === 0 ? (
                <div className="p-3 bg-slate-950/60 border border-slate-800/80 rounded-xl text-xs text-slate-400">
                  No backup files found in <code className="font-mono text-slate-300">backups/</code> yet. You can export one or browse from your device below.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {availableBackups.map((b) => (
                    <div
                      key={b.filename}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-slate-200 truncate">{b.filename}</span>
                          {b.isCurrent && (
                            <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 px-1.5 py-0.2 rounded font-medium">
                              Active Auto-Save
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {new Date(b.modifiedAt).toLocaleString('en-NZ', { dateStyle: 'short', timeStyle: 'short' })} • {(b.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <button
                        onClick={() => handleImportFromDisk(b.filename)}
                        className="px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 hover:text-emerald-200 border border-emerald-500/40 rounded-lg text-xs font-medium transition-colors shrink-0"
                      >
                        Load
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Or Choose from Device
              </div>
              <p className="text-xs text-slate-400">
                Select any custom JSON portfolio backup file stored elsewhere on your device.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-colors flex items-center justify-center gap-2"
              >
                <span>📁 Browse .json File...</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
