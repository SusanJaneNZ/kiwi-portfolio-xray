import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BucketRebalancer } from './components/BucketRebalancer';
import { FreshnessHeader } from './components/FreshnessHeader';
import { HoldingsTable } from './components/HoldingsTable';
import { LiquidityCard } from './components/LiquidityCard';
import { PortfolioInputTable } from './components/PortfolioInputTable';
import { StackedBarChart } from './components/StackedBarChart';
import { UnresolvedItem, UnresolvedModal } from './components/UnresolvedModal';
import { computeFreshnessEnvelope } from './engine/freshness';
import { calculatePortfolioLookthrough } from './engine/lookthrough';
import {
  LoadSource,
  loadFromIndexedDBBackup,
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
  const [unresolvedEntries, setUnresolvedEntries] = useState<UnresolvedItem[]>([]);
  const [isUnresolvedModalOpen, setIsUnresolvedModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Restore from IndexedDB mirror if localStorage was empty on boot and user hasn't edited yet
  useEffect(() => {
    if (initialLoad.source !== 'default') return;
    let cancelled = false;
    loadFromIndexedDBBackup().then((restored) => {
      if (cancelled || !restored || hasUserEditedRef.current) return;
      setPortfolioState(restored);
      setLoadSource('indexeddb');
      setRecoveredNotice('Restored saved portfolio from browser backup.');
      savePortfolioState(restored);
    });
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
    async function loadData() {
      try {
        const basePath = import.meta.env.BASE_URL || '/';
        const [fundsRes, constRes, directRes, unresRes] = await Promise.all([
          fetch(`${basePath}data/funds_registry.json`).then((r) => r.json()),
          fetch(`${basePath}data/constituents.json`).then((r) => r.json()),
          fetch(`${basePath}data/direct_equities.json`).then((r) => r.json()),
          fetch(`${basePath}data/unresolved_entries.json`).then((r) => r.json()),
        ]);

        setFundsRegistry(fundsRes);
        setConstituentsMap(constRes);
        setDirectCatalog(directRes);
        setUnresolvedEntries(unresRes);
      } catch (err) {
        console.error('Failed to load static datasets, using built-in fallbacks:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Persist state changes to LocalStorage + IndexedDB mirror
  const handleUpdateState = (newState: UserPortfolioState) => {
    hasUserEditedRef.current = true;
    const stamped: UserPortfolioState = {
      ...newState,
      version: 2,
      timestamp: new Date().toISOString(),
    };
    setPortfolioState(stamped);
    setLoadSource('v2');
    setRecoveredNotice(null);
    savePortfolioState(stamped);
  };

  // Perform core look-through calculations
  const calculationResult = useMemo(() => {
    return calculatePortfolioLookthrough({
      fundBalances: portfolioState.fundBalances,
      directHoldings: portfolioState.directHoldings,
      cashDeposits: portfolioState.cashDeposits,
      audNzdRate: portfolioState.audNzdRate,
      fundsRegistry,
      constituentsMap,
    });
  }, [portfolioState, fundsRegistry, constituentsMap]);

  // Compute portfolio-level freshness envelope
  const freshnessEnvelope = useMemo(() => {
    const heldCodes = Object.keys(portfolioState.fundBalances).filter(
      (code) => portfolioState.fundBalances[code] > 0
    );
    return computeFreshnessEnvelope(heldCodes, fundsRegistry);
  }, [portfolioState.fundBalances, fundsRegistry]);

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
          portfolioState={portfolioState}
          holdings={calculationResult.holdings}
          onUpdateState={handleUpdateState}
          onOpenUnresolvedModal={() => setIsUnresolvedModalOpen(true)}
          unresolvedCount={unresolvedEntries.length}
          loadSource={loadSource}
          recoveredNotice={recoveredNotice}
        />

        {/* 1. Asset Class / Liquidity Split */}
        <LiquidityCard
          liquidity={calculationResult.liquidity}
          constituentCount={calculationResult.holdings.length}
          bondIssuerCount={calculationResult.bondIssuerHoldings.length}
        />

        {/* 2. Sector & Country Allocation */}
        <StackedBarChart
          sectorBreakdown={calculationResult.sectorBreakdown}
          countryBreakdown={calculationResult.countryBreakdown}
        />

        {/* 3. Look-Through Exposure */}
        <HoldingsTable
          holdings={calculationResult.holdings}
          bondIssuerHoldings={calculationResult.bondIssuerHoldings}
          issuerRollup={calculationResult.issuerRollup}
        />

        {/* 4. Rebalancing */}
        <BucketRebalancer portfolioState={portfolioState} onUpdateState={handleUpdateState} />

        {/* 5-7. Portfolio Inputs: Fund Allocations, Direct Shares, Term Deposits */}
        <PortfolioInputTable
          portfolioState={portfolioState}
          fundsRegistry={fundsRegistry}
          directEquitiesCatalog={directCatalog}
          onUpdateState={handleUpdateState}
          totalPortfolioNZD={calculationResult.denominatorD}
        />
      </div>

      {/* Unresolved Disclosures Modal */}
      <UnresolvedModal
        isOpen={isUnresolvedModalOpen}
        onClose={() => setIsUnresolvedModalOpen(false)}
        unresolvedEntries={unresolvedEntries}
      />
    </div>
  );
};

export default App;

