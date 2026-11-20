import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BucketRebalancer } from './components/BucketRebalancer';
import { FreshnessHeader } from './components/FreshnessHeader';
import { HoldingsTable } from './components/HoldingsTable';
import { LiquidityCard } from './components/LiquidityCard';
import { PortfolioInputTable } from './components/PortfolioInputTable';
import { RetirementCashflowPanel } from './components/RetirementCashflowPanel';
import { IndexReplicatorPanel } from './components/IndexReplicatorPanel';
import { StackedBarChart } from './components/StackedBarChart';
import { computeFreshnessEnvelope } from './engine/freshness';
import { calculateRetirementCashflow } from './engine/income';
import { calculatePortfolioLookthrough } from './engine/lookthrough';
import {
  LoadSource,
  autoSavePortfolioToDisk,
  isEmptyPortfolio,
  isSamplePortfolio,
  loadFromIndexedDBBackup,
  loadPortfolioFromDisk,
  loadPortfolioStateWithMeta,
  savePortfolioState,
} from './storage/localStorage';
import { Constituent, DirectEquityCatalogItem, FundMetadata, UserPortfolioState } from './types/portfolio';

export const App: React.FC = () => {
  const initialLoad = useMemo(() => loadPortfolioStateWithMeta(), []);
  const [portfolioState, setPortfolioState] = useState<UserPortfolioState>(() => initialLoad.state);
  const [loadSource, setLoadSource] = useState<LoadSource>(() => initialLoad.source);
  const [recoveredNotice, setRecoveredNotice] = useState<string | null>(() => initialLoad.recoveredNotice);
  const hasUserEditedRef = useRef(false);
  const latestStateRef = useRef(portfolioState);
  latestStateRef.current = portfolioState;

  const [fundsRegistry, setFundsRegistry] = useState<FundMetadata[]>([]);
  const [constituentsMap, setConstituentsMap] = useState<Record<string, Constituent[]>>({});
  const [directCatalog, setDirectCatalog] = useState<DirectEquityCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataLoadError, setDataLoadError] = useState<string | null>(null);

  // Restore from backup sources (IndexedDB or disk backup) if localStorage was default on boot
  useEffect(() => {
    if (initialLoad.source !== 'default') return;
    let cancelled = false;

    async function restoreBackupSources() {
      const [idbState, diskState] = await Promise.all([
        loadFromIndexedDBBackup().catch(() => null),
        loadPortfolioFromDisk().catch(() => null),
      ]);

      if (cancelled || hasUserEditedRef.current) return;

      const candidates: { state: UserPortfolioState; source: LoadSource; notice: string }[] = [];
      if (diskState && !isEmptyPortfolio(diskState) && !isSamplePortfolio(diskState)) {
        candidates.push({
          state: diskState,
          source: 'v2',
          notice: 'Loaded portfolio from local backup (backups/portfolio_backup.json).',
        });
      }
      if (idbState && !isEmptyPortfolio(idbState) && !isSamplePortfolio(idbState)) {
        candidates.push({
          state: idbState,
          source: 'indexeddb',
          notice: 'Restored saved portfolio from browser backup.',
        });
      }

      if (candidates.length === 0) return;

      // Select candidate with the newest timestamp
      candidates.sort((a, b) => {
        const timeA = new Date(a.state.timestamp || 0).getTime() || 0;
        const timeB = new Date(b.state.timestamp || 0).getTime() || 0;
        return timeB - timeA;
      });

      const best = candidates[0];
      setPortfolioState(best.state);
      setLoadSource(best.source);
      setRecoveredNotice(best.notice);
      savePortfolioState(best.state);
    }

    void restoreBackupSources();
    return () => {
      cancelled = true;
    };
  }, [initialLoad.source]);

  // Flush latest edited/saved state on tab close or reload
  useEffect(() => {
    const flushState = () => {
      if (hasUserEditedRef.current || loadSource !== 'default') {
        savePortfolioState(latestStateRef.current);
      }
    };
    window.addEventListener('pagehide', flushState);
    return () => window.removeEventListener('pagehide', flushState);
  }, [loadSource]);

  // Load static public data assets
  useEffect(() => {
    async function fetchJson<T>(url: string): Promise<T> {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} loading ${url}`);
      }
      return res.json() as Promise<T>;
    }

    async function loadData() {
      try {
        const basePath = import.meta.env.BASE_URL || '/';
        const [fundsRes, constRes, directRes] = await Promise.all([
          fetchJson<FundMetadata[]>(`${basePath}data/funds_registry.json`),
          fetchJson<Record<string, Constituent[]>>(`${basePath}data/constituents.json`),
          fetchJson<DirectEquityCatalogItem[]>(`${basePath}data/direct_equities.json`),
        ]);

        const listedEtfs: DirectEquityCatalogItem[] = fundsRes
          .filter(
            (f) =>
              f.provider.toLowerCase() === 'smartshares' ||
              f.provider.toLowerCase() === 'betashares'
          )
          .map((f) => {
            const isBetaShares = f.provider.toLowerCase() === 'betashares';
            return {
              isin: f.code,
              ticker: isBetaShares ? `${f.code}.AX` : `${f.code}.NZ`,
              name: f.name,
              exchange: (isBetaShares ? 'ASX' : 'NZX') as 'ASX' | 'NZX',
              country: isBetaShares ? 'Australia' : 'New Zealand',
              sector: f.asset_class === 'fixed_interest' ? 'Fixed Income' : 'Broad Index ETF',
              isEtf: true,
              fundCode: f.code,
            };
          });

        const existingTickers = new Set(directRes.map((d) => d.ticker.toUpperCase()));
        const mergedCatalog = [
          ...directRes,
          ...listedEtfs.filter((e) => !existingTickers.has(e.ticker.toUpperCase())),
        ];

        setFundsRegistry(fundsRes);
        setConstituentsMap(constRes);
        setDirectCatalog(mergedCatalog);
        setDataLoadError(null);

        // Reconcile any saved direct holdings whose legacy ISIN differs from compiled canonical ISIN/SEDOL
        if (mergedCatalog.length > 0) {
          const byTickerKey = new Map<string, DirectEquityCatalogItem>();
          for (const item of mergedCatalog) {
            byTickerKey.set(`${item.exchange}:${item.ticker.toUpperCase()}`, item);
          }
          setPortfolioState((prev) => {
            let changed = false;
            const nextAssignments = { ...prev.bucketAssignments };
            const reconciled = prev.directHoldings.map((dh) => {
              // Reconcile BetaShares ASIA if previously saved as ASIA.NZ / NZX
              if (
                dh.ticker.toUpperCase() === 'ASIA.NZ' ||
                (dh.fundCode === 'ASIA' && dh.exchange === 'NZX') ||
                (dh.ticker.toUpperCase() === 'ASIA' && dh.exchange === 'NZX')
              ) {
                changed = true;
                const oldBucketKey = `direct:${dh.isin}`;
                const newBucketKey = `direct:ASIA`;
                if (nextAssignments[oldBucketKey] && !nextAssignments[newBucketKey]) {
                  nextAssignments[newBucketKey] = nextAssignments[oldBucketKey];
                }
                return {
                  ...dh,
                  isin: 'ASIA',
                  ticker: 'ASIA.AX',
                  exchange: 'ASX' as const,
                  country: 'Australia',
                  currency: 'AUD' as const,
                  isEtf: true,
                  fundCode: 'ASIA',
                };
              }

              const match = byTickerKey.get(`${dh.exchange}:${dh.ticker.toUpperCase()}`);
              if (match && match.isin && match.isin !== dh.isin) {
                changed = true;
                const oldBucketKey = `direct:${dh.isin}`;
                const newBucketKey = `direct:${match.isin}`;
                if (nextAssignments[oldBucketKey] && !nextAssignments[newBucketKey]) {
                  nextAssignments[newBucketKey] = nextAssignments[oldBucketKey];
                  delete nextAssignments[oldBucketKey];
                }
                return {
                  ...dh,
                  isin: match.isin,
                  issuer_key: dh.issuer_key || match.issuer_key,
                  issuer_name: dh.issuer_name || match.issuer_name,
                };
              }
              return dh;
            });
            if (!changed) return prev;
            const nextState = { ...prev, directHoldings: reconciled, bucketAssignments: nextAssignments };
            if (hasUserEditedRef.current || loadSource !== 'default') {
              savePortfolioState(nextState);
            }
            return nextState;
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('Failed to load static datasets:', err);
        setDataLoadError(
          `Failed to load compiled fund datasets (${msg}). Look-through constituents may be incomplete until reloaded.`
        );
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist state changes to LocalStorage + IndexedDB mirror + linked backup file
  const handleUpdateState = (action: UserPortfolioState | ((prev: UserPortfolioState) => UserPortfolioState)) => {
    hasUserEditedRef.current = true;
    setPortfolioState((prev) => {
      const next = typeof action === 'function' ? action(prev) : action;
      const stamped: UserPortfolioState = {
        ...next,
        version: 2,
        timestamp: new Date().toISOString(),
      };
      setLoadSource('v2');
      setRecoveredNotice(null);
      savePortfolioState(stamped);

      // Trailing debounce autoSavePortfolioToDisk to prevent burst HTTP POST calls during typing
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        void autoSavePortfolioToDisk(stamped);
      }, 500);

      return stamped;
    });
  };

  // Merge static registry with user custom/KiwiSaver funds
  const mergedFundsRegistry = useMemo(() => {
    const custom = portfolioState.customFunds || [];
    if (custom.length === 0) return fundsRegistry;
    const existing = new Set(fundsRegistry.map((f) => f.code.toUpperCase()));
    return [...fundsRegistry, ...custom.filter((c) => !existing.has(c.code.toUpperCase()))];
  }, [fundsRegistry, portfolioState.customFunds]);

  // Perform core look-through calculations
  const calculationResult = useMemo(() => {
    return calculatePortfolioLookthrough({
      fundBalances: portfolioState.fundBalances,
      directHoldings: portfolioState.directHoldings,
      fixedInterest: portfolioState.fixedInterest || portfolioState.cashDeposits,
      audNzdRate: portfolioState.audNzdRate,
      fundsRegistry: mergedFundsRegistry,
      constituentsMap,
    });
  }, [portfolioState, mergedFundsRegistry, constituentsMap]);

  // Compute 12-month forward retirement cashflow and net drawdown
  const cashflowResult = useMemo(() => {
    return calculateRetirementCashflow({
      portfolioState,
      fundsRegistry: mergedFundsRegistry,
    });
  }, [portfolioState, mergedFundsRegistry]);

  const [activeWithdrawal, setActiveWithdrawal] = useState<number | undefined>(undefined);

  const handleApplyDrawdownToRebalancer = (amount: number) => {
    setActiveWithdrawal(amount);
    const el = document.getElementById('bucket-rebalancer');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Compute portfolio-level freshness envelope
  const freshnessEnvelope = useMemo(() => {
    const heldCodes = Object.keys(portfolioState.fundBalances).filter(
      (code) => portfolioState.fundBalances[code] > 0
    );
    return computeFreshnessEnvelope(heldCodes, mergedFundsRegistry);
  }, [portfolioState.fundBalances, mergedFundsRegistry]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-2xl animate-spin">🥝</span>
          <span>Loading Kiwi Portfolio X-Ray data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6 font-sans antialiased">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Top Header & Freshness Envelope */}
        <FreshnessHeader
          envelope={freshnessEnvelope}
          recoveredNotice={recoveredNotice}
        />

        {dataLoadError && (
          <div className="bg-rose-950/50 border border-rose-700/60 text-rose-200 rounded-xl px-4 py-3 text-xs flex items-center justify-between gap-3">
            <span>⚠ {dataLoadError}</span>
            <button
              onClick={() => window.location.reload()}
              className="bg-rose-800 hover:bg-rose-700 text-white px-2.5 py-1 rounded-lg font-medium whitespace-nowrap"
            >
              Reload Page
            </button>
          </div>
        )}

        {/* 1. Portfolio Holdings & Inputs */}
        <PortfolioInputTable
          portfolioState={portfolioState}
          fundsRegistry={mergedFundsRegistry}
          directEquitiesCatalog={directCatalog}
          onUpdateState={handleUpdateState}
          totalPortfolioNZD={calculationResult.denominatorD}
        />

        {/* 2. Asset Class / Liquidity Split */}
        <LiquidityCard
          liquidity={calculationResult.liquidity}
          constituentCount={calculationResult.holdings.length}
          bondIssuerCount={calculationResult.bondIssuerHoldings.length}
        />

        {/* 3. Sector & Country Allocation */}
        <StackedBarChart
          sectorBreakdown={calculationResult.sectorBreakdown}
          countryBreakdown={calculationResult.countryBreakdown}
        />

        {/* 4. Look-Through Exposure */}
        <HoldingsTable
          holdings={calculationResult.holdings}
          bondIssuerHoldings={calculationResult.bondIssuerHoldings}
          issuerRollup={calculationResult.issuerRollup}
        />

        {/* 5. Projected Organic Cashflow */}
        <RetirementCashflowPanel
          portfolioState={portfolioState}
          fundsRegistry={mergedFundsRegistry}
          onUpdateState={handleUpdateState}
          onApplyDrawdownToRebalancer={handleApplyDrawdownToRebalancer}
        />

        {/* 6. Bucket Rebalancing */}
        <BucketRebalancer
          portfolioState={portfolioState}
          onUpdateState={handleUpdateState}
          suggestedDrawdownNZD={cashflowResult.netCapitalDrawdownRequiredNZD}
          activeWithdrawal={activeWithdrawal}
        />

        {/* 7. DIY Direct Index Rebalancer */}
        <IndexReplicatorPanel
          portfolioState={portfolioState}
          constituentsMap={constituentsMap}
          lookThroughHoldings={calculationResult.holdings}
          directEquitiesCatalog={directCatalog}
          onUpdateState={handleUpdateState}
        />
      </div>
    </div>
  );
};

export default App;

